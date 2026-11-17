import { GraphQLError } from 'graphql';
import { clearUserCache } from '../../utils/auth';
import { adultDateOfBirth } from '../../utils/age';
import { isValidCpf } from '../../resolvers/Certificate/eligibility';

// REA-63: the admin corrects a user's account data on /admin/usuarios/<id> (admin only —
// resolvers/Admin checks it). Name, e-mail, CPF, date of birth, phone (WhatsApp) and the marketing
// opt-in; nothing else (role: setUserRole; blocked: age review).
//
// The e-mail is the identity of the login by code and the key of the Eventando signups, so changing
// it:
// - is refused when another account already has it (case-insensitive, like the login);
// - moves the signups of the old address to the new one when the admin confirms it, except where
//   the new address already has a signup in the same event (that one stays as it is);
// - ends every session of the account (`sessions_revoked_at`, checked here in utils/auth and in the
//   backend): whoever owns the wrong address may have logged in with a code sent there;
// - clears the auth cache.
// Every correction is written to the backend's `user-change` (who, whom, when, which fields — never
// the values), and the console only gets ids and field names.

const NAME_MAX = 120;
const PHONE_MAX = 30;
// What the backend (users-permissions `email` type) accepts, without anything exotic.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Order of the fields in changedFields (and in the admin's screen).
const FIELDS = ['name', 'email', 'cpf', 'date_of_birth', 'phone', 'marketing_opt_in'];

const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

const isBlank = (value) => value === undefined || value === null;
const cpfDigits = (value) => String(value || '').replace(/\D/g, '');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export const EMAIL_TAKEN = 'Este e-mail já é de outra conta.';
export const CPF_TAKEN = 'Este CPF já é de outra conta.';

/**
 * The fields to write, from the GraphQL input: only the ones sent (null/undefined = unchanged).
 * The CPF and the phone are cleared with an empty value; name, e-mail and date of birth cannot be.
 * Throws BAD_USER_INPUT.
 */
export const normalizeUserInput = (input = {}, now = new Date()) => {
  const patch = {};
  if (!isBlank(input.name)) {
    const name = String(input.name).trim().replace(/\s+/g, ' ');
    if (!name) throw badInput('Informe o nome.');
    if (name.length > NAME_MAX) throw badInput(`O nome pode ter até ${NAME_MAX} caracteres.`);
    patch.name = name;
  }
  if (!isBlank(input.email)) {
    const email = normalizeEmail(input.email);
    if (!EMAIL_PATTERN.test(email) || email.length > 254) throw badInput('Informe um e-mail válido.');
    patch.email = email;
  }
  if (!isBlank(input.cpf)) {
    const digits = cpfDigits(input.cpf);
    if (!digits) patch.cpf = null;
    else if (!isValidCpf(digits)) throw badInput('Informe um CPF válido.');
    else patch.cpf = digits;
  }
  if (!isBlank(input.dateOfBirth)) {
    if (!String(input.dateOfBirth).trim()) throw badInput('Informe a data de nascimento.');
    patch.date_of_birth = adultDateOfBirth(input.dateOfBirth, now);
  }
  if (!isBlank(input.phone)) {
    const phone = String(input.phone).trim();
    if (phone.length > PHONE_MAX) throw badInput('Informe um WhatsApp válido.');
    patch.phone = phone || null;
  }
  if (!isBlank(input.marketingOptIn)) patch.marketing_opt_in = Boolean(input.marketingOptIn);
  return patch;
};

// What the user has today, in the same shape as the patch, to tell what really changes.
const currentValues = (user) => ({
  name: user.name ?? null,
  email: normalizeEmail(user.email) || null,
  cpf: cpfDigits(user.cpf) || null,
  date_of_birth: user.date_of_birth ? String(user.date_of_birth).slice(0, 10) : null,
  phone: user.phone ?? null,
  marketing_opt_in: Boolean(user.marketing_opt_in),
});

const changesOf = (patch, user) => {
  const current = currentValues(user);
  return FIELDS.filter((field) => field in patch && patch[field] !== current[field]);
};

const otherOwner = (owners, userId) => (owners || [])
  .some((owner) => String(owner.id) !== String(userId));

// The event a signup belongs to, however Eventando shaped the relation.
const eventKeyOf = (signup) => {
  const event = signup?.event?.data ?? signup?.event;
  const key = event?.id ?? event?.documentId ?? event?.uuid;
  return key == null ? null : String(key);
};

export const signupIdOf = (signup) => String(signup.documentId || signup.id);

/** The old address's signups split into those that can move and those that stay. */
export const planSignupMove = async (eventando, fromEmail, toEmail) => {
  const [from, to] = await Promise.all([
    eventando.findSignupsByEmail(fromEmail),
    eventando.findSignupsByEmail(toEmail),
  ]);
  const taken = new Set((to || []).map(eventKeyOf).filter(Boolean));
  const move = [];
  const keep = [];
  (from || []).forEach((signup) => {
    const key = eventKeyOf(signup);
    (key && taken.has(key) ? keep : move).push(signup);
  });
  return { move, keep };
};

const loadTarget = async (integration, userId) => {
  const user = await integration.adminFindUserProfile(userId);
  if (!user) throw badInput('Usuário não encontrado.');
  return user;
};

/**
 * Before changing the e-mail: whether it is free, and what would happen to the signups.
 * { available, message, signupsToMove, signupConflicts }
 */
export const checkUserEmail = async ({
  integration, eventando, userId, email,
}) => {
  const { email: wanted } = normalizeUserInput({ email });
  const target = await loadTarget(integration, userId);
  const owners = await integration.adminFindUserIdsByEmail(wanted);
  if (otherOwner(owners, userId)) {
    return {
      available: false, message: EMAIL_TAKEN, signupsToMove: 0, signupConflicts: 0,
    };
  }
  const current = normalizeEmail(target.email);
  if (!current || current === wanted) {
    return {
      available: true, message: null, signupsToMove: 0, signupConflicts: 0,
    };
  }
  const { move, keep } = await planSignupMove(eventando, current, wanted);
  return {
    available: true, message: null, signupsToMove: move.length, signupConflicts: keep.length,
  };
};

const summary = ({ changedFields, signupsMoved, signupsKept, signupsFailed }) => {
  if (changedFields.length === 0) return 'Nada para alterar.';
  const parts = ['Dados atualizados.'];
  if (changedFields.includes('email')) {
    parts.push('As sessões abertas da conta foram encerradas.');
    if (signupsMoved) parts.push(`${signupsMoved} inscrição(ões) passaram para o novo e-mail.`);
    if (signupsKept) parts.push(`${signupsKept} inscrição(ões) ficaram no e-mail antigo.`);
    if (signupsFailed) parts.push(`${signupsFailed} inscrição(ões) não puderam ser movidas; tente de novo ou corrija no credenciamento.`);
  }
  return parts.join(' ');
};

/**
 * Applies the correction. Resolves { changedFields, signupsMoved, signupsKept, signupsFailed,
 * sessionsRevoked, recorded, message }.
 */
export const updateUserData = async ({
  integration, eventando, actor, userId, input, moveSignups = true, now = new Date(),
  clearCache = clearUserCache,
}) => {
  const patch = normalizeUserInput(input, now);
  const target = await loadTarget(integration, userId);
  const changedFields = changesOf(patch, target);
  const result = {
    changedFields,
    signupsMoved: 0,
    signupsKept: 0,
    signupsFailed: 0,
    sessionsRevoked: false,
    recorded: false,
  };
  if (changedFields.length === 0) return { ...result, message: summary(result) };

  const emailChanged = changedFields.includes('email');
  if (emailChanged && otherOwner(await integration.adminFindUserIdsByEmail(patch.email), userId)) {
    throw badInput(EMAIL_TAKEN);
  }
  if (changedFields.includes('cpf') && patch.cpf
    && otherOwner(await integration.adminFindUserIdsByCpf(patch.cpf), userId)) {
    throw badInput(CPF_TAKEN);
  }

  // Planned before the write: afterwards the old address has no account to compare with.
  const oldEmail = normalizeEmail(target.email);
  const plan = emailChanged && oldEmail
    ? await planSignupMove(eventando, oldEmail, patch.email)
    : { move: [], keep: [] };

  const data = Object.fromEntries(changedFields.map((field) => [field, patch[field]]));
  if (emailChanged) data.sessions_revoked_at = now.toISOString();
  await integration.adminUpdateUserFields(userId, data);
  result.sessionsRevoked = emailChanged;
  clearCache();

  if (emailChanged) {
    const toMove = moveSignups ? plan.move : [];
    result.signupsKept = plan.keep.length + (moveSignups ? 0 : plan.move.length);
    // One at a time, so Eventando is not flooded; a refusal does not stop the others.
    await toMove.reduce((previous, signup) => previous.then(async () => {
      try {
        await eventando.updateSignup(signupIdOf(signup), { email: patch.email });
        result.signupsMoved += 1;
      } catch (err) {
        result.signupsFailed += 1;
        // eslint-disable-next-line no-console
        console.error(`[admin] user ${userId}: signup ${signupIdOf(signup)} not moved: ${err.message}`);
      }
    }), Promise.resolve());
  }

  try {
    await integration.adminCreateUserChange({
      actor: actor.documentId,
      target: target.documentId,
      fields: changedFields,
      signups_moved: result.signupsMoved,
      sessions_revoked: result.sessionsRevoked,
    });
    result.recorded = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[admin] user ${userId}: the correction was applied but not recorded: ${err.message}`);
  }

  // eslint-disable-next-line no-console
  console.info(`[admin] user ${userId} corrected by ${actor.id}: ${changedFields.join(', ')}`
    + `${emailChanged ? ` (signups moved ${result.signupsMoved}, kept ${result.signupsKept}, failed ${result.signupsFailed}; sessions ended)` : ''}`);

  const message = summary(result) + (result.recorded ? '' : ' Atenção: o registro da alteração falhou.');
  return { ...result, message };
};
