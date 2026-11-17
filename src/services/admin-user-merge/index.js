import { GraphQLError } from 'graphql';
import { clearUserCache } from '../../utils/auth';
import { planSignupMove, signupIdOf } from '../admin-user-edit';

// REA-96: joining two accounts of the same person (admin only — resolvers/Admin checks it).
//
// The backend (api::user-merge) does the Hub side in one transaction: every link moves to the account
// that stays, the dropped account is anonymized and blocked (its sessions end) — never deleted. Here:
// - the groups of accounts sharing a CPF, with the signups each e-mail has in Eventando and a
//   suggestion of which account stays (more links; tie: the latest login; still tied: the admin
//   decides);
// - the preview the admin confirms (what moves, why it cannot be joined);
// - after the backend's merge, the Eventando signups of the old e-mail move to the e-mail that stays
//   (except where it already has a signup in the same event: that one stays, with its payment), the
//   auth cache is cleared and the merge is recorded in user-change (counts and field names only).
// Nothing is joined without the admin's click: there is no automatic merge.

const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

const ADMIN = 'admin';
const MANAGERS = new Set(['community-manager', 'event-manager']);

const linksTotal = (links) => (links || [])
  .filter((link) => link.counts !== false)
  .reduce((sum, link) => sum + (Number(link.count) || 0), 0);

const certificatesOf = (user) => {
  const byAccount = (user.links || [])
    .find((link) => link.key === 'api::certificate.certificate.users_permissions_user')?.count || 0;
  // Certificates are issued to the account and to the e-mail; most are both, so the larger count.
  return Math.max(byAccount, Number(user.emailRows?.certificates) || 0);
};

/** One account of a group, as the admin's screen shows it. */
export const toMergeUser = (user, signups = 0) => ({
  id: String(user.id),
  name: user.name ?? null,
  email: user.email ?? null,
  created_at: user.createdAt ?? null,
  last_login_at: user.lastLoginAt ?? null,
  blocked: Boolean(user.blocked),
  role: user.role ?? null,
  isAdmin: user.role === ADMIN,
  isManager: MANAGERS.has(user.role),
  signups,
  certificates: certificatesOf(user),
  links: linksTotal(user.links) + signups,
  linkDetails: (user.links || []).map((link) => ({ label: link.label, count: Number(link.count) || 0 })),
});

const time = (value) => (value ? new Date(value).getTime() || 0 : 0);

/**
 * Which account of a group should stay: the one with more links; on a tie, the latest login; still
 * tied, none (the admin decides). { userId, reason } or null.
 */
export const suggestKeep = (users) => {
  if (!users || users.length < 2) return null;
  const byLinks = [...users].sort((a, b) => b.links - a.links);
  if (byLinks[0].links > byLinks[1].links) {
    return { userId: byLinks[0].id, reason: 'Tem mais vínculos.' };
  }
  const tied = byLinks.filter((user) => user.links === byLinks[0].links);
  const byLogin = [...tied].sort((a, b) => time(b.last_login_at) - time(a.last_login_at));
  if (time(byLogin[0].last_login_at) > time(byLogin[1].last_login_at)) {
    return { userId: byLogin[0].id, reason: 'Mesmos vínculos; entrou por último.' };
  }
  return null;
};

const signupCount = async (eventando, email) => {
  if (!email) return 0;
  try {
    return (await eventando.findSignupsByEmail(email)).length;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[admin] duplicate CPFs: signups not read: ${err.message}`);
    return 0;
  }
};

/** Every group of accounts sharing a CPF (never the CPF itself), with a suggestion each. */
export const loadDuplicateGroups = async ({ integration, eventando }) => {
  const { total = 0, groups = [] } = (await integration.adminFindDuplicateCpfGroups()) || {};
  const answer = [];
  // One group at a time: a few Eventando reads per group.
  await groups.reduce((previous, group) => previous.then(async () => {
    const users = await Promise.all((group.users || [])
      .map(async (user) => toMergeUser(user, await signupCount(eventando, user.email))));
    const suggestion = suggestKeep(users);
    answer.push({
      id: users.map((user) => user.id).join('-'),
      users,
      suggestedKeepId: suggestion?.userId ?? null,
      suggestionReason: suggestion?.reason ?? 'Empate: escolha a conta que fica.',
    });
  }), Promise.resolve());
  return { total, groups: answer };
};

const pairArgs = (keepId, dropId) => {
  if (String(keepId) === String(dropId)) throw badInput('Escolha duas contas diferentes.');
  return { keepId: Number(keepId), dropId: Number(dropId) };
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const planSignups = async (eventando, fromEmail, toEmail) => {
  const from = normalizeEmail(fromEmail);
  const to = normalizeEmail(toEmail);
  if (!from || !to || from === to) return { move: [], keep: [] };
  return planSignupMove(eventando, from, to);
};

const describeUser = (user) => (user ? {
  id: String(user.id),
  name: user.name ?? null,
  email: user.email ?? null,
  role: user.role?.type ?? null,
  blocked: Boolean(user.blocked),
} : null);

/** What joining `drop` into `keep` would do. Read only. */
export const previewMerge = async ({
  integration, eventando, actor, keepId, dropId,
}) => {
  const pair = pairArgs(keepId, dropId);
  const preview = await integration.adminPreviewUserMerge({ ...pair, actorId: actor.id });
  const blockers = preview?.blockers || [];
  const plan = blockers.length === 0
    ? await planSignups(eventando, preview.drop?.email, preview.keep?.email)
    : { move: [], keep: [] };
  return {
    keep: describeUser(preview?.keep),
    drop: describeUser(preview?.drop),
    blockers,
    canMerge: blockers.length === 0,
    links: (preview?.links || []).map((link) => ({ label: link.label, count: Number(link.count) || 0 })),
    certificatesByEmail: Number(preview?.emailRows?.certificates) || 0,
    requestsByEmail: Number(preview?.emailRows?.requests) || 0,
    filledFields: preview?.fill || [],
    signupsToMove: plan.move.length,
    signupConflicts: plan.keep.length,
  };
};

const summary = (result) => {
  const parts = ['Contas juntadas. A conta descartada foi desativada e anonimizada, e as sessões dela foram encerradas.'];
  if (result.signupsMoved) parts.push(`${result.signupsMoved} inscrição(ões) passaram para o e-mail da conta que fica.`);
  if (result.signupsKept) parts.push(`${result.signupsKept} inscrição(ões) ficaram no e-mail antigo (a conta que fica já está inscrita no mesmo evento).`);
  if (result.signupsFailed) parts.push(`${result.signupsFailed} inscrição(ões) não puderam ser movidas; corrija no credenciamento.`);
  if (!result.recorded) parts.push('Atenção: o registro da junção falhou.');
  return parts.join(' ');
};

/**
 * Joins `drop` into `keep`. Resolves { keepUserId, linksMoved, signupsMoved, signupsKept,
 * signupsFailed, filledFields, recorded, message }.
 */
export const mergeAccounts = async ({
  integration, eventando, actor, keepId, dropId, clearCache = clearUserCache,
}) => {
  const pair = pairArgs(keepId, dropId);
  if (String(actor.id) === String(pair.dropId)) {
    throw badInput('Você não pode descartar a sua própria conta. Peça a outro admin.');
  }
  const preview = await integration.adminPreviewUserMerge({ ...pair, actorId: actor.id });
  if (preview?.blockers?.length) throw badInput(preview.blockers.join(' '));

  // Planned before the merge: afterwards the old e-mail belongs to no account.
  const plan = await planSignups(eventando, preview.drop?.email, preview.keep?.email);

  let merged;
  try {
    merged = await integration.adminMergeUsers({ ...pair, actorId: actor.id });
  } catch (err) {
    if (err.status === 400) throw badInput(err.message);
    throw err;
  }
  clearCache();

  const result = {
    keepUserId: String(pair.keepId),
    linksMoved: (merged.links || []).map((link) => ({ label: link.label, count: Number(link.moved) || 0 })),
    certificatesByEmail: Number(merged.emailRows?.certificates) || 0,
    requestsByEmail: Number(merged.emailRows?.requests) || 0,
    filledFields: merged.filled || [],
    signupsMoved: 0,
    signupsKept: plan.keep.length,
    signupsFailed: 0,
    recorded: false,
  };

  const keepEmail = normalizeEmail(merged.keepEmail);
  // One at a time, so Eventando is not flooded; a refusal does not stop the others.
  await plan.move.reduce((previous, signup) => previous.then(async () => {
    try {
      await eventando.updateSignup(signupIdOf(signup), { email: keepEmail });
      result.signupsMoved += 1;
    } catch (err) {
      result.signupsFailed += 1;
      // eslint-disable-next-line no-console
      console.error(`[admin] merge ${pair.dropId} -> ${pair.keepId}: signup ${signupIdOf(signup)} not moved: ${err.message}`);
    }
  }), Promise.resolve());

  try {
    await integration.adminCreateUserChange({
      kind: 'merge',
      actor: actor.documentId,
      target: merged.keepDocumentId,
      source: merged.dropDocumentId,
      fields: result.filledFields,
      signups_moved: result.signupsMoved,
      sessions_revoked: true,
      moved: {
        links: Object.fromEntries((merged.links || []).map((link) => [link.key, Number(link.moved) || 0])),
        certificates_by_email: result.certificatesByEmail,
        requests_by_email: result.requestsByEmail,
        signups_kept: result.signupsKept,
        signups_failed: result.signupsFailed,
      },
    });
    result.recorded = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[admin] merge ${pair.dropId} -> ${pair.keepId}: joined but not recorded: ${err.message}`);
  }

  // eslint-disable-next-line no-console
  console.info(`[admin] user ${pair.dropId} joined into ${pair.keepId} by ${actor.id}`
    + ` (links ${result.linksMoved.reduce((sum, link) => sum + link.count, 0)}, signups moved ${result.signupsMoved},`
    + ` kept ${result.signupsKept}, failed ${result.signupsFailed})`);

  return { ...result, message: summary(result) };
};
