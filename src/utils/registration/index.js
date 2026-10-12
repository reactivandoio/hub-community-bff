// REA-22, rule 6 (Pedro: every account with a pending password): the certificate
// only goes out once the registration is finished — the person created the password
// from the e-mail. People without an account (external lists, request forms) are
// not affected. "Pending" is password_pending on the account, read through the
// manager's integration-only /account-status.

import crypto from 'crypto';
import { createRateLimiter } from '../rate-limit';
import { maskEmail } from '../mask-email';
import { sendCompleteRegistration } from '../../services/email/complete-registration';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const cpfDigits = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
};

// One "Conclua seu cadastro" reminder per account every 15 minutes.
const defaultReminders = createRateLimiter({ limit: 1, windowMs: 15 * 60 * 1000 });

/**
 * The account behind the CPF (else the e-mail) when its registration is not finished,
 * or null. A failed lookup lets the certificate through (logged): the rule must not
 * stop every certificate while the manager is down or not yet deployed.
 */
export const pendingAccount = async (dataSources, { cpf, email } = {}) => {
  const integration = dataSources.managerIntegration;
  try {
    const digits = cpfDigits(cpf);
    let account = digits ? await integration.findUserByCpf(digits) : null;
    if (!account && normalizeEmail(email).includes('@')) account = await integration.findUserByEmail(normalizeEmail(email));
    if (!account?.email) return null;
    const statuses = await integration.accountStatus([normalizeEmail(account.email)]);
    const status = (statuses || []).find((s) => normalizeEmail(s.email) === normalizeEmail(account.email));
    return status?.pending ? account : null;
  } catch (err) {
    console.error('[registration] status lookup failed (certificate allowed):', err.message);
    return null;
  }
};

/**
 * Sends the set-password link again (rate limited) and resolves the message to show.
 * Never throws.
 */
export const remindRegistration = async (dataSources, account, eventTitle, { reminders = defaultReminders } = {}) => {
  const email = normalizeEmail(account.email);
  const masked = maskEmail(email);
  if (reminders.hit(crypto.createHash('sha256').update(email).digest('hex'))) {
    try {
      const { token } = (await dataSources.managerIntegration.accountSetup({ email })) || {};
      if (token) {
        sendCompleteRegistration({ email, name: account.name || account.username, eventTitle, token })
          .catch((err) => console.error('[registration] reminder failed:', err.message));
      }
    } catch (err) {
      console.error('[registration] account setup failed:', err.message);
    }
  }
  return `Para receber o certificado, conclua seu cadastro: enviamos para ${masked} o link para criar sua senha.`;
};

export const PENDING_ADMIN_SUFFIX = 'cadastro pendente (a pessoa ainda não criou a senha; enviamos o link de novo)';
