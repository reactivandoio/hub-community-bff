import { acceptPendingInvites } from '../management-invite';
import { GraphQLError } from 'graphql';
import crypto from 'crypto';
import { sendEmail } from '../email';
import { LOGIN_CODE_SUBJECT, loginCodeTemplate } from '../email/templates/login-code';
import { createRateLimiter } from '../../utils/rate-limit';
import { maskEmail } from '../../utils/mask-email';

// REA-26: the only login of the Hub. The person types the e-mail, gets a 6-digit code and types it
// back; a new e-mail gets its account when the code is confirmed (the CompleteProfileModal of the
// frontend then asks for name, CPF, date of birth, WhatsApp and the 18+ declaration).
//
// The code itself lives in hub-community-backend (api::login-code: hash, 10 min, 5 tries, one a
// minute and 10 a day per e-mail); this service e-mails it and limits attempts per IP.
//
// Mailgun: the code is a transactional e-mail, so it is never held back by the campaigns' share
// (services/email-campaign/quota) — they leave EMAIL_DAILY_RESERVE to it. If Mailgun itself refuses
// (plan limit reached, outage), the person reads that the code could not be sent and to try again in
// a minute, and the log has "[login-code] envio recusado" with Mailgun's message.

export const CODE_MINUTES = 10;
export const RESEND_SECONDS = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const defaultLimits = () => ({
  request: createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 }),
  verify: createRateLimiter({ limit: 30, windowMs: 10 * 60 * 1000 }),
});
const limits = defaultLimits();

const fail = (message, code, extensions = {}) => new GraphQLError(message, { extensions: { code, ...extensions } });

const ipKey = (ip) => crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');

export const normalizeLoginEmail = (value) => {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw fail('Informe um e-mail válido.', 'BAD_USER_INPUT');
  return email;
};

const TOO_MANY = 'Muitas tentativas. Espere alguns minutos e tente de novo.';

/** Sends a login code. Resolves { sent: true, resendIn } — the same whether the account exists or not. */
export const requestLoginCode = async ({ dataSources, email: rawEmail, clientIp, limiters = limits, send = sendEmail }) => {
  const email = normalizeLoginEmail(rawEmail);
  if (!limiters.request.hit(ipKey(clientIp))) throw fail(TOO_MANY, 'RATE_LIMITED');

  const result = await dataSources.managerIntegration.requestLoginCode(email);

  if (result?.status === 'cooldown') {
    const seconds = Number(result.retryAfter) || RESEND_SECONDS;
    throw fail(`Enviamos um código há pouco. Peça outro em ${seconds} segundos.`, 'LOGIN_CODE_COOLDOWN', { retryAfter: seconds });
  }
  if (result?.status === 'limit') {
    throw fail('Você pediu muitos códigos hoje. Use o último que recebeu ou tente de novo amanhã.', 'LOGIN_CODE_LIMIT');
  }
  // Blocked account (REA-36): nothing is sent, and the answer does not tell it apart.
  if (result?.status === 'blocked') return { sent: true, resendIn: RESEND_SECONDS };
  if (result?.status !== 'sent' || !result.code) {
    throw new Error(`login-code request: unexpected answer ${result?.status}`);
  }

  const delivery = await send({
    kind: 'login-code',
    to: email,
    subject: LOGIN_CODE_SUBJECT(result.code),
    html: loginCodeTemplate({ code: result.code, minutes: CODE_MINUTES }),
  });
  if (!delivery?.success) {
    console.error(`[login-code] envio recusado para ${maskEmail(email)}: ${delivery?.error || 'erro'}`);
    throw fail(
      `Não conseguimos enviar o código agora. Tente de novo em ${RESEND_SECONDS} segundos; se continuar, fale com o suporte.`,
      'LOGIN_CODE_NOT_SENT',
      { retryAfter: RESEND_SECONDS },
    );
  }
  return { sent: true, resendIn: RESEND_SECONDS };
};

/** Best effort, like the old signUp: the new account takes over the speaker of its e-mail, or gets one. */
export const linkSpeaker = async (dataSources, user) => {
  if (!user?.documentId || !user.email) return;
  const integration = dataSources.managerIntegration;
  try {
    const found = await integration.findSpeakers({ filters: { email: user.email } });
    const [speaker] = found?.data || [];
    const link = { users_permissions_user: { set: [user.documentId] } };
    if (speaker) await integration.updateSpeaker(speaker.documentId, link);
    else await integration.createSpeaker({ email: user.email, ...(user.name ? { name: user.name } : {}), ...link });
  } catch (err) {
    console.error(`[login-code] speaker of ${maskEmail(user.email)} not linked: ${err.message}`);
  }
};

/** Checks the code. Resolves the user with its session `token` (same shape the old signIn had). */
export const verifyLoginCode = async ({ dataSources, email: rawEmail, code, clientIp, limiters = limits }) => {
  const email = normalizeLoginEmail(rawEmail);
  if (!limiters.verify.hit(ipKey(clientIp))) throw fail(TOO_MANY, 'RATE_LIMITED');

  const result = await dataSources.managerIntegration.verifyLoginCode(email, String(code ?? ''));

  switch (result?.status) {
    case 'ok':
      if (result.created) await linkSpeaker(dataSources, result.user);
      // REA-48: pending invites of this e-mail become access now (never fails the login).
      await acceptPendingInvites(dataSources, result.user);
      return { ...result.user, token: result.jwt };
    case 'invalid':
      if (!result.attemptsLeft) {
        throw fail('Código incorreto. Este código não vale mais: peça um novo.', 'LOGIN_CODE_EXPIRED');
      }
      throw fail(
        `Código incorreto. Você tem mais ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'tentativa' : 'tentativas'}.`,
        'LOGIN_CODE_INVALID',
        { attemptsLeft: result.attemptsLeft },
      );
    case 'expired':
      throw fail('Este código expirou ou já foi usado. Peça um novo.', 'LOGIN_CODE_EXPIRED');
    case 'blocked':
      throw fail('Esta conta está desativada. Se acha que é um engano, fale com o suporte.', 'ACCOUNT_BLOCKED');
    default:
      throw new Error(`login-code verify: unexpected answer ${result?.status}`);
  }
};
