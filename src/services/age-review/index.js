import { GraphQLError } from 'graphql';
import { sendEmail } from '../email';
import {
  DOB_REQUEST_SUBJECT, MINOR_BLOCKED_SUBJECT, dateOfBirthRequestTemplate, minorBlockedTemplate,
} from '../email/templates/age-review';
import { addressFor } from '../email-campaign/sender';
import { remainingToday, startOfDaySaoPaulo } from '../email-campaign/quota';
import { normalizeEmail } from '../email-campaign/token';
import { adultCutoff, ageOn, isMinorDate } from '../../utils/age';
import { maskEmail } from '../../utils/mask-email';
import { clearUserCache } from '../../utils/auth';

// REA-36: age review of the Hub admin (/admin/usuarios, admin only).
//
// - Minors (date of birth under 18): the admin deactivates the account (users-permissions
//   `blocked`, which refuses the login and, in the bff, every request of that token within 60 s —
//   the auth cache is cleared at once) and the person gets an e-mail with the reason. Signups
//   already made are kept as they are.
// - No date of birth: the admin sends an e-mail asking for it. The account becomes
//   `dob_requested` with `age_review_requested_at` = when the e-mail went; the backend
//   (config/cron-tasks.ts) blocks it if no date arrives in 7 days, and a valid date sent in the
//   meantime ends the request. Nothing is sent nor blocked without the admin's action.
//
// E-mails share the Mailgun budget of the campaigns (EMAIL_CAMPAIGN_DAILY_LIMIT, 70 a day): each
// one is recorded as an `email-campaign-delivery` (campaign_document_id "age-review-…"), so the
// campaign queue sees it in its daily count and leaves the rest of the 100 a day to transactional
// e-mails. What does not fit today is not sent: the admin sends the rest on the next days.

export const DOB_REQUEST_DAYS = 7;
export const MAX_IDS_PER_REQUEST = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

export const KINDS = Object.freeze({ NO_BIRTH_DATE: 'NO_BIRTH_DATE', MINOR: 'MINOR' });

const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

const frontendUrl = (env) => String(env.FRONTEND_URL || 'https://hubcommunity.io').replace(/\/$/, '');

const ymdSaoPaulo = (date) => new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** "dd/mm/aaaa" in São Paulo. */
export const formatDateBr = (date) => {
  const [y, m, d] = ymdSaoPaulo(date).split('-');
  return `${d}/${m}/${y}`;
};

export const requestDeadline = (requestedAt) =>
  (requestedAt ? new Date(new Date(requestedAt).getTime() + DOB_REQUEST_DAYS * DAY_MS) : null);

export const toAgeReviewUser = (user, now = new Date()) => ({
  id: String(user.id),
  username: user.username ?? null,
  email: user.email ?? null,
  name: user.name ?? null,
  blocked: Boolean(user.blocked),
  createdAt: user.createdAt ?? null,
  dateOfBirth: user.date_of_birth ?? null,
  age: user.date_of_birth ? ageOn(user.date_of_birth, now) : null,
  adultDeclaredAt: user.adult_declaration_at ?? null,
  status: user.age_review_status ?? null,
  requestedAt: user.age_review_requested_at ?? null,
  deadline: requestDeadline(user.age_review_requested_at)?.toISOString() ?? null,
  blockedAt: user.age_review_blocked_at ?? null,
});

export const emailsLeftToday = async (integration, { env, now }) => {
  const sentToday = await integration.countEmailDeliveriesSince(startOfDaySaoPaulo(now));
  return remainingToday({ sentToday, env });
};

const STATUS_FILTERS = new Set(['NONE', 'dob_requested', 'dob_blocked', 'minor_blocked']);

export const listAgeReview = async ({ integration, kind, status, page, pageSize, env, now }) => {
  if (!KINDS[kind]) throw badInput('Lista inválida.');
  if (status && !STATUS_FILTERS.has(status)) throw badInput('Situação inválida.');
  const cutoff = adultCutoff(now);
  const [users, total, left] = await Promise.all([
    integration.adminFindAgeReviewUsers({ kind, cutoff, status, page, pageSize }),
    integration.adminCountAgeReviewUsers({ kind, cutoff, status }),
    emailsLeftToday(integration, { env, now }),
  ]);
  return { items: users.map((u) => toAgeReviewUser(u, now)), total, page, pageSize, emailsLeftToday: left };
};

export const ageReviewSummary = async ({ integration, env, now }) => {
  const cutoff = adultCutoff(now);
  const countOf = (kind, status) => integration.adminCountAgeReviewUsers({ kind, cutoff, status });
  const [noBirthDate, notRequested, requested, minors, minorsBlocked, left] = await Promise.all([
    countOf(KINDS.NO_BIRTH_DATE),
    countOf(KINDS.NO_BIRTH_DATE, 'NONE'),
    countOf(KINDS.NO_BIRTH_DATE, 'dob_requested'),
    countOf(KINDS.MINOR),
    countOf(KINDS.MINOR, 'minor_blocked'),
    emailsLeftToday(integration, { env, now }),
  ]);
  return { noBirthDate, notRequested, requested, minors, minorsBlocked, emailsLeftToday: left };
};

/** Records the e-mail (shared daily budget, once per key) and sends it. */
const deliverOnce = async ({ integration, key, campaign, email, subject, html, env, now, send }) => {
  let delivery;
  try {
    delivery = await integration.createEmailDelivery({ key, campaign_document_id: campaign, email, status: 'sending' });
  } catch (err) {
    if (/unique/i.test(err.message || '')) return 'duplicate';
    throw err;
  }
  const address = addressFor({ email, subject }, env);
  const result = await send({ to: address.to, subject: address.subject, html });
  const ok = Boolean(result?.success);
  try {
    await integration.updateEmailDelivery(delivery.documentId, {
      status: ok ? 'sent' : 'failed', error: ok ? null : String(result?.error || 'erro'), sent_at: now.toISOString(),
    });
  } catch (err) {
    console.error(`[age-review] could not record delivery ${delivery.documentId}: ${err.message}`);
  }
  return ok ? 'sent' : 'failed';
};

const idsArg = (userIds) => {
  const ids = [...new Set((userIds || []).map((id) => String(id ?? '').trim()))];
  if (ids.length === 0) throw badInput('Selecione ao menos um usuário.');
  if (ids.some((id) => !/^\d+$/.test(id))) throw badInput('Usuário inválido.');
  if (ids.length > MAX_IDS_PER_REQUEST) throw badInput(`Selecione no máximo ${MAX_IDS_PER_REQUEST} usuários por vez.`);
  return ids;
};

/** Where the person updates the date: the complete-profile page, or the set-password link first. */
const actionLinkFor = async (integration, user, env) => {
  const email = normalizeEmail(user.email);
  try {
    const [status] = await integration.accountStatus([email]);
    if (status?.pending) {
      const setup = await integration.accountSetup({ email, name: user.name || undefined });
      if (setup?.token) {
        return { url: `${frontendUrl(env)}/criar-senha?code=${encodeURIComponent(setup.token)}`, needsPassword: true };
      }
    }
  } catch (err) {
    console.error(`[age-review] account status of ${maskEmail(email)} failed: ${err.message}`);
  }
  return { url: `${frontendUrl(env)}/completar-cadastro`, needsPassword: false };
};

const MESSAGES = {
  sent: 'E-mail enviado.',
  quota: 'A cota de e-mails de hoje acabou. Envie amanhã.',
  'not-found': 'Usuário não encontrado.',
  blocked: 'A conta já está desativada.',
  'has-birth-date': 'A conta já tem data de nascimento.',
  'already-requested': 'O pedido já foi enviado para esta conta.',
  failed: 'O envio do e-mail falhou.',
};

/**
 * Sends the date-of-birth request to each user (at most 50), up to what is left of today's
 * e-mail budget. Each result says what happened; nothing is blocked here.
 */
export const requestDateOfBirth = async ({
  integration, userIds, actor, env = process.env, now = new Date(), send = sendEmail,
}) => {
  const ids = idsArg(userIds);
  let left = await emailsLeftToday(integration, { env, now });
  const deadline = formatDateBr(requestDeadline(now));
  const results = [];
  for (const id of ids) {
    let outcome;
    if (left <= 0) {
      outcome = 'quota';
    } else {
      // eslint-disable-next-line no-await-in-loop
      const user = await integration.adminFindAgeReviewUser(id);
      if (!user) outcome = 'not-found';
      else if (user.blocked) outcome = 'blocked';
      else if (user.date_of_birth) outcome = 'has-birth-date';
      else if (user.age_review_status === 'dob_requested') outcome = 'already-requested';
      else {
        // eslint-disable-next-line no-await-in-loop
        const link = await actionLinkFor(integration, user, env);
        // eslint-disable-next-line no-await-in-loop
        outcome = await deliverOnce({
          integration,
          key: `age-review:dob:${id}:${ymdSaoPaulo(now)}`,
          campaign: 'age-review-dob',
          email: normalizeEmail(user.email),
          subject: DOB_REQUEST_SUBJECT,
          html: dateOfBirthRequestTemplate({
            userName: user.name || user.username, deadline, actionUrl: link.url, needsPassword: link.needsPassword,
          }),
          env,
          now,
          send,
        });
        if (outcome === 'duplicate') outcome = 'already-requested';
        if (outcome === 'sent' || outcome === 'failed') left -= 1;
        if (outcome === 'sent') {
          // The 7 days count from this e-mail.
          // eslint-disable-next-line no-await-in-loop
          await integration.adminUpdateUserFields(id, {
            age_review_status: 'dob_requested', age_review_requested_at: now.toISOString(),
          });
        }
      }
    }
    results.push({ userId: id, outcome, message: MESSAGES[outcome] });
  }
  const count = (o) => results.filter((r) => r.outcome === o).length;
  console.info(`[age-review] date-of-birth request by ${actor?.id}: ${count('sent')} sent, ${count('failed')} failed, ${count('quota')} left for another day`);
  return {
    sent: count('sent'),
    failed: count('failed'),
    skipped: results.length - count('sent') - count('failed'),
    emailsLeftToday: left,
    results,
  };
};

/**
 * Deactivates the account of a minor and e-mails the reason. On an account already deactivated
 * for this reason it only sends the e-mail again (once a day), for when it failed or did not fit.
 */
export const blockMinor = async ({
  integration, userId, actor, env = process.env, now = new Date(), send = sendEmail,
}) => {
  const id = idsArg([userId])[0];
  if (actor && String(actor.id) === id) throw badInput('Você não pode desativar a sua própria conta.');
  const user = await integration.adminFindAgeReviewUser(id);
  if (!user) throw badInput('Usuário não encontrado.');
  if (!isMinorDate(user.date_of_birth, now)) throw badInput('A data de nascimento desta conta não é de menor de 18 anos.');
  if (user.blocked && user.age_review_status !== 'minor_blocked') throw badInput('A conta já está desativada por outro motivo.');

  let current = user;
  if (!user.blocked) {
    const data = { blocked: true, age_review_status: 'minor_blocked', age_review_blocked_at: now.toISOString() };
    await integration.adminUpdateUserFields(id, data);
    clearUserCache();
    current = { ...user, ...data };
    console.info(`[age-review] account ${id} deactivated (minor) by ${actor?.id}`);
  }

  let left = await emailsLeftToday(integration, { env, now });
  let emailOutcome = 'quota';
  if (left > 0) {
    emailOutcome = await deliverOnce({
      integration,
      key: `age-review:minor:${id}:${ymdSaoPaulo(now)}`,
      campaign: 'age-review-minor',
      email: normalizeEmail(user.email),
      subject: MINOR_BLOCKED_SUBJECT,
      html: minorBlockedTemplate({ userName: user.name || user.username }),
      env,
      now,
      send,
    });
    if (emailOutcome === 'sent' || emailOutcome === 'failed') left -= 1;
  }
  const emailMessage = {
    sent: 'E-mail com o motivo enviado.',
    failed: 'O envio do e-mail falhou; tente reenviar.',
    quota: 'O e-mail não foi enviado: a cota de hoje acabou. Reenvie amanhã.',
    duplicate: 'O e-mail já foi enviado hoje.',
  }[emailOutcome];
  return {
    user: toAgeReviewUser(current, now),
    emailSent: emailOutcome === 'sent',
    message: `${user.blocked ? 'A conta já estava desativada.' : 'Conta desativada.'} ${emailMessage}`,
    emailsLeftToday: left,
  };
};
