// REA-22, rule 6 (Pedro): the certificate only goes out once the registration is
// finished — for every account, old ones included. Finished = the password was
// created (password_pending, read through the manager's integration-only
// /account-status) AND the profile has CPF, date of birth and WhatsApp.
// People without an account (external lists, request forms) are not affected.

import crypto from 'crypto';
import { GraphQLError } from 'graphql';
import { createRateLimiter } from '../rate-limit';
import { maskEmail } from '../mask-email';
import { sendCompleteRegistration } from '../../services/email/complete-registration';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const cpfDigits = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
};

export const REGISTRATION_INCOMPLETE = 'REGISTRATION_INCOMPLETE';

// Profile data the certificate needs, in the order they are reported.
export const REQUIRED_PROFILE = Object.freeze([
  { field: 'cpf', label: 'CPF', present: (account) => Boolean(cpfDigits(account.cpf)) },
  { field: 'date_of_birth', label: 'data de nascimento', present: (account) => Boolean(String(account.date_of_birth || '').trim()) },
  { field: 'phone', label: 'WhatsApp', present: (account) => String(account.phone || '').replace(/\D/g, '').length >= 8 },
]);

export const missingProfile = (account) =>
  REQUIRED_PROFILE.filter((item) => !item.present(account || {})).map((item) => item.field);

const labelsOf = (fields) => {
  const labels = REQUIRED_PROFILE.filter((item) => fields.includes(item.field)).map((item) => item.label);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
};
const ALL_LABELS = labelsOf(REQUIRED_PROFILE.map((item) => item.field));

// One "Conclua seu cadastro" reminder per account every 15 minutes.
const defaultReminders = createRateLimiter({ limit: 1, windowMs: 15 * 60 * 1000 });

/**
 * What the account behind the CPF (else the e-mail) still lacks before a certificate:
 * { account, passwordPending, missing } — or null when nothing is missing or there is
 * no account. A failed lookup lets the certificate through (logged): the rule must not
 * stop every certificate while the manager is down or not yet deployed.
 */
export const registrationGap = async (dataSources, { cpf, email } = {}) => {
  const integration = dataSources.managerIntegration;
  try {
    const digits = cpfDigits(cpf);
    let account = digits ? await integration.findUserByCpf(digits) : null;
    if (!account && normalizeEmail(email).includes('@')) account = await integration.findUserByEmail(normalizeEmail(email));
    if (!account?.email) return null;
    const statuses = await integration.accountStatus([normalizeEmail(account.email)]);
    const status = (statuses || []).find((s) => normalizeEmail(s.email) === normalizeEmail(account.email));
    const passwordPending = Boolean(status?.pending);
    const missing = missingProfile(account);
    if (!passwordPending && missing.length === 0) return null;
    return { account, passwordPending, missing };
  } catch (err) {
    console.error('[registration] status lookup failed (certificate allowed):', err.message);
    return null;
  }
};

/** Sends the set-password link again (rate limited). Never throws. */
export const remindPassword = async (dataSources, account, eventTitle, { reminders = defaultReminders } = {}) => {
  const email = normalizeEmail(account.email);
  if (!reminders.hit(crypto.createHash('sha256').update(email).digest('hex'))) return;
  try {
    const { token } = (await dataSources.managerIntegration.accountSetup({ email })) || {};
    if (token) {
      sendCompleteRegistration({ email, name: account.name || account.username, eventTitle, token })
        .catch((err) => console.error('[registration] reminder failed:', err.message));
    }
  } catch (err) {
    console.error('[registration] account setup failed:', err.message);
  }
};

/**
 * The message for the certificate pages. What exactly is missing is only told to the
 * account's own signed-in owner; anyone else (who typed a CPF) reads the requirements
 * and the masked e-mail, never what that account lacks.
 */
export const incompleteMessage = ({ account, passwordPending, missing }, { isOwner }) => {
  const masked = maskEmail(account.email);
  if (passwordPending) {
    const link = `Para receber o certificado, conclua seu cadastro: enviamos para ${masked} o link para criar sua senha.`;
    if (isOwner) return missing.length ? `${link} Depois, preencha ${labelsOf(missing)} no seu perfil.` : link;
    return `${link} Depois, entre e confira se ${ALL_LABELS} estão no seu perfil.`;
  }
  return isOwner
    ? `Para receber o certificado, complete seu cadastro: falta ${labelsOf(missing)} no seu perfil.`
    : `Para receber o certificado, conclua seu cadastro: entre na conta ${masked} e preencha ${ALL_LABELS} no perfil.`;
};

/**
 * Throws the certificate-page error when the registration is not finished; sends the
 * set-password link again when that is what is missing. `viewer` is ctx.user.
 */
export const assertRegistrationComplete = async (dataSources, { cpf, email, viewer, eventTitle }) => {
  const gap = await registrationGap(dataSources, { cpf, email });
  if (!gap) return;
  if (gap.passwordPending) await remindPassword(dataSources, gap.account, eventTitle);
  const isOwner = Boolean(viewer?.email) && normalizeEmail(viewer.email) === normalizeEmail(gap.account.email);
  throw new GraphQLError(incompleteMessage(gap, { isOwner }), {
    extensions: {
      code: REGISTRATION_INCOMPLETE,
      password_pending: gap.passwordPending,
      missing: isOwner ? gap.missing : null,
    },
  });
};

/** One line of the admin's issue result (organizers may see what is missing). */
export const adminIncompleteReason = ({ passwordPending, missing }) => {
  const parts = [];
  if (passwordPending) parts.push('senha não criada (enviamos o link de novo)');
  if (missing.length) parts.push(`falta ${labelsOf(missing)}`);
  return `cadastro incompleto: ${parts.join('; ')}`;
};
