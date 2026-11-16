// REA-53 — the account a speaker is. Admin only.
//
// A speaker (`api::speaker`) is linked to at most one account (`users_permissions_user`, oneToOne)
// and an account to at most one speaker. Accounts created by login code already get one (the
// speaker of their e-mail, or an empty new one — services/login-code `linkSpeaker`), so linking an
// old speaker usually meets that empty one: when it has no talks, its avatar and biography fill
// what the old speaker lacks and it is deleted (soft delete, `deleted_at`). A speaker of that
// account with talks is never touched: joining two speakers with talks is the migration's job.
//
// Medium term the speaker entity goes away and talks point at accounts; see "Speakers and
// accounts" in CLAUDE.md for the plan. Linking every speaker that can be linked is its first step.
import { GraphQLError } from 'graphql';
import { requireAdmin } from '../../utils/auth';

const badInput = (message, code = 'BAD_USER_INPUT') => new GraphQLError(message, { extensions: { code } });

const talkCount = (speaker) => (speaker?.talks || []).length;
const accountOf = (speaker) => speaker?.users_permissions_user || null;
const accountLabel = (account) => account?.email || account?.name || account?.username || 'outra conta';
const hasBiography = (speaker) => {
  const bio = speaker?.biography;
  return Array.isArray(bio) ? bio.length > 0 : Boolean(bio);
};

/** Lower case, no accents, single spaces: how names and e-mails are compared. */
export const normalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const loadSpeaker = async (ds, speakerId) => {
  const speaker = await ds.findSpeakerWithAccount(speakerId).catch(() => null);
  if (!speaker || speaker.deleted_at) throw badInput('Palestrante não encontrado.', 'NOT_FOUND');
  return speaker;
};

/**
 * Links the speaker to the account (numeric users-permissions id, like setUserRole). Same account
 * again: nothing changes. Refused when the speaker is already some other account's, or when the
 * account is already a speaker with talks. Answers the speaker and the names of the empty speakers
 * of that account that were joined into it.
 */
export const linkSpeakerAccount = async (ctx, { speakerId, userId }) => {
  requireAdmin(ctx);
  const ds = ctx.dataSources.managerIntegration;
  const speaker = await loadSpeaker(ds, speakerId);
  const user = await ds.adminFindUser(userId).catch(() => null);
  if (!user?.documentId) throw badInput('Conta não encontrada.', 'NOT_FOUND');

  const current = accountOf(speaker);
  if (current?.documentId === user.documentId) return { speaker, joined: [] };
  if (current) {
    throw badInput(`Este palestrante já está vinculado a ${accountLabel(current)}. Desvincule antes de trocar.`, 'SPEAKER_LINKED');
  }

  const others = (await ds.findSpeakersOfAccount(user.documentId))
    .filter((other) => other.documentId !== speaker.documentId);
  const withTalks = others.find((other) => talkCount(other) > 0);
  if (withTalks) {
    const n = talkCount(withTalks);
    throw badInput(
      `${accountLabel(user)} já é o palestrante "${withTalks.name || 'sem nome'}", com ${n} palestra${n === 1 ? '' : 's'}. `
      + 'Juntar dois palestrantes com palestras ainda não é possível.',
      'ACCOUNT_IS_SPEAKER',
    );
  }

  // What the empty speakers of the account bring: the avatar and biography the person set.
  const fill = {};
  others.forEach((other) => {
    if (!speaker.avatar && !fill.avatar && other.avatar?.id) fill.avatar = other.avatar.id;
    if (!hasBiography(speaker) && !fill.biography && hasBiography(other)) fill.biography = other.biography;
  });
  if (!String(speaker.name || '').trim() && user.name) fill.name = user.name;
  // The e-mail is how the login finds the speaker of an account (login-code `linkSpeaker`).
  if (user.email) fill.email = user.email;

  // Frees the account (oneToOne) before linking it, then deletes the empty ones.
  await Promise.all(others.map((other) => ds.setSpeakerAccount(other.documentId, null)));
  await ds.setSpeakerAccount(speaker.documentId, user.documentId, fill);
  await Promise.all(others.map((other) => ds.deleteSpeakerById(other.documentId)));

  return {
    speaker: await ds.findSpeakerWithAccount(speaker.documentId),
    joined: others.map((other) => other.name || 'sem nome'),
  };
};

/** Unlinks the account. The speaker and its talks stay; the account keeps no speaker. */
export const unlinkSpeakerAccount = async (ctx, { speakerId }) => {
  requireAdmin(ctx);
  const ds = ctx.dataSources.managerIntegration;
  const speaker = await loadSpeaker(ds, speakerId);
  if (!accountOf(speaker)) return speaker;
  await ds.setSpeakerAccount(speaker.documentId, null);
  return ds.findSpeakerWithAccount(speaker.documentId);
};

export const MAX_SUGGESTIONS = 100;

/**
 * The counts for the migration and the suggested links: each speaker without an account whose
 * e-mail is an account's e-mail, or (when it has no e-mail match) whose name is the name of
 * exactly one account. Accounts that are already a speaker with talks, blocked accounts and names
 * shared by two speakers are left out. Nothing is linked: the admin confirms each one.
 */
export const speakerAccountReview = async (ctx) => {
  requireAdmin(ctx);
  const ds = ctx.dataSources.managerIntegration;
  const [speakers, accounts] = await Promise.all([
    ds.findAllSpeakersForReview(),
    ds.findAllAccountsForReview(),
  ]);

  const linked = speakers.filter((s) => accountOf(s));
  const unlinked = speakers.filter((s) => !accountOf(s));

  // Accounts a link would be refused for: already a speaker with talks.
  const busy = new Set(linked.filter((s) => talkCount(s) > 0).map((s) => accountOf(s).documentId));
  const usable = accounts.filter((a) => a?.documentId && !a.blocked && !busy.has(a.documentId));

  const byEmail = new Map();
  const byName = new Map();
  usable.forEach((account) => {
    if (account.email) byEmail.set(normalize(account.email), account);
    const name = normalize(account.name);
    if (name) byName.set(name, [...(byName.get(name) || []), account]);
  });
  const speakerNames = new Map();
  unlinked.forEach((s) => {
    const name = normalize(s.name);
    if (name) speakerNames.set(name, (speakerNames.get(name) || 0) + 1);
  });

  const suggestions = [];
  unlinked.forEach((s) => {
    const email = byEmail.get(normalize(s.email));
    if (s.email && email) {
      suggestions.push({ speaker: s, account: email, reason: 'EMAIL' });
      return;
    }
    const name = normalize(s.name);
    const sameName = byName.get(name) || [];
    if (name && sameName.length === 1 && speakerNames.get(name) === 1) {
      suggestions.push({ speaker: s, account: sameName[0], reason: 'NAME' });
    }
  });
  // An account suggested for two speakers is ambiguous: neither is suggested.
  const perAccount = new Map();
  suggestions.forEach(({ account }) => perAccount.set(account.documentId, (perAccount.get(account.documentId) || 0) + 1));
  const unique = suggestions.filter(({ account }) => perAccount.get(account.documentId) === 1);
  // E-mail matches first, then the speakers with more talks.
  const rank = (s) => (s.reason === 'EMAIL' ? 0 : 1);
  unique.sort((a, b) => rank(a) - rank(b) || talkCount(b.speaker) - talkCount(a.speaker));

  return {
    total: speakers.length,
    withAccount: linked.length,
    withoutAccount: unlinked.length,
    withoutAccountWithTalks: unlinked.filter((s) => talkCount(s) > 0).length,
    suggestions: unique.slice(0, MAX_SUGGESTIONS).map(({ speaker, account, reason }) => ({
      reason,
      speakerId: speaker.documentId,
      speakerName: speaker.name || null,
      talks: talkCount(speaker),
      account: {
        id: String(account.id),
        documentId: account.documentId,
        name: account.name || null,
        email: account.email || null,
      },
    })),
  };
};
