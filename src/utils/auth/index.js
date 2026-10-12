import crypto from 'crypto';
import { GraphQLError } from 'graphql';
import jwt from '../jwt';

// Authentication and authorization for resolvers that act with the integration token.
//
// The request user comes only from a token whose signature was verified (utils/jwt).
// Admin: the "admin" role of users-permissions in Strapi; ADMIN_EMAILS is a migration
// fallback while the role is not assigned to everyone who needs it.
// Event organizer: a user listed in `organizers` of one of the event's communities, or admin.

const USER_TTL_MS = 60 * 1000;
const MAX_CACHED_USERS = 1000;

// sha256(token) -> { user, expiresAt }. Keyed by the verified token, never by an id
// read from the token, so a forged token can never pick up somebody else's profile.
const userCache = new Map();

const tokenKey = (token) => crypto.createHash('sha256').update(token).digest('hex');

const pruneExpired = (now) => {
  if (userCache.size < MAX_CACHED_USERS) return;
  userCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) userCache.delete(key);
  });
  // Still full (all fresh): drop the oldest entries.
  while (userCache.size >= MAX_CACHED_USERS) {
    userCache.delete(userCache.keys().next().value);
  }
};

export const clearUserCache = () => userCache.clear();

/**
 * Returns the Strapi user (with `role`) behind a verified token, or null for anything
 * else: no token, bad signature, expired, unknown or blocked user, Strapi unreachable.
 */
export const authenticate = async (authorization, dataSources) => {
  const payload = jwt.verify(authorization);
  if (!payload) return null;

  const key = tokenKey(jwt.stripBearer(authorization));
  const now = Date.now();
  const cached = userCache.get(key);
  if (cached && cached.expiresAt > now) return cached.user;

  let user = null;
  try {
    const response = await dataSources.managerIntegration.findUserWithRole(payload.id);
    user = response?.data || null;
  } catch (err) {
    // Not cached: a Strapi hiccup must not log the user out for a whole minute.
    // eslint-disable-next-line no-console
    console.error('[auth] Falha ao carregar o usuário do token:', err.message);
    return null;
  }

  if (!user || user.blocked || String(user.id) !== String(payload.id)) user = null;

  pruneExpired(now);
  userCache.set(key, { user, expiresAt: now + USER_TTL_MS });
  return user;
};

/**
 * Builds the per-request auth state. A token that does not verify is dropped from the
 * headers too, so no data source forwards it to Strapi (which would answer 401 even
 * on public routes).
 */
export const createAuthContext = async ({ authorization, acceptLanguage, makeDataSources }) => {
  const baseHeaders = { 'accept-language': acceptLanguage };
  const anonymous = () => ({
    user: undefined,
    headers: baseHeaders,
    dataSources: makeDataSources(baseHeaders),
  });

  if (!authorization) return anonymous();

  const headers = { ...baseHeaders, Authorization: authorization };
  const dataSources = makeDataSources(headers);
  const user = await authenticate(authorization, dataSources);
  if (!user) return anonymous();

  return { user, headers, dataSources };
};

const adminEmails = () =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const isAdmin = (user) => {
  if (!user) return false;
  if (user.role?.type === 'admin') return true;
  const email = (user.email || '').trim().toLowerCase();
  return Boolean(email) && adminEmails().includes(email);
};

export const unauthenticatedError = () =>
  new GraphQLError('Não autenticado. Faça login novamente.', {
    extensions: { code: 'UNAUTHENTICATED' },
  });

export const forbiddenError = (message = 'Você não tem permissão para esta operação.') =>
  new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });

export const requireUser = (ctx) => {
  if (!ctx?.user) throw unauthenticatedError();
  return ctx.user;
};

export const requireAdmin = (ctx) => {
  const user = requireUser(ctx);
  if (!isAdmin(user)) throw forbiddenError();
  return user;
};

const idsOf = (users) => (users || []).map((u) => u?.documentId).filter(Boolean);

export const organizerIdsOfEvent = (event) =>
  new Set((event?.communities || []).flatMap((community) => idsOf(community?.organizers)));

// Per-request memo, so a resolver that checks the same event twice asks Strapi once.
const memo = (ctx, key, load) => {
  if (!ctx.authzCache) ctx.authzCache = new Map();
  if (!ctx.authzCache.has(key)) {
    ctx.authzCache.set(key, load().catch((err) => {
      ctx.authzCache.delete(key);
      throw err;
    }));
  }
  return ctx.authzCache.get(key);
};

const loadEvent = (ctx, eventIdOrSlug) =>
  memo(ctx, `event:${eventIdOrSlug}`, () =>
    ctx.dataSources.managerIntegration.findEventWithOrganizers(String(eventIdOrSlug)));

const loadCommunity = (ctx, communityId) =>
  memo(ctx, `community:${communityId}`, () =>
    ctx.dataSources.managerIntegration.findCommunityWithOrganizers(String(communityId)));

/** Non-throwing check: admin, or organizer of one of the event's communities. */
export const isEventOrganizer = async (ctx, eventIdOrSlug) => {
  const user = ctx?.user;
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (!eventIdOrSlug) return false;
  const event = await loadEvent(ctx, eventIdOrSlug);
  return Boolean(event) && organizerIdsOfEvent(event).has(user.documentId);
};

export const requireEventOrganizer = async (ctx, eventIdOrSlug) => {
  requireUser(ctx);
  if (!(await isEventOrganizer(ctx, eventIdOrSlug))) {
    throw forbiddenError('Apenas organizadores do evento podem fazer esta operação.');
  }
};

export const requireCommunityOrganizer = async (ctx, communityId) => {
  const user = requireUser(ctx);
  if (isAdmin(user)) return;
  const community = communityId ? await loadCommunity(ctx, communityId) : null;
  if (!community || !idsOf(community.organizers).includes(user.documentId)) {
    throw forbiddenError('Apenas organizadores da comunidade podem fazer esta operação.');
  }
};

/** Organizer of every community in the list (at least one), or admin. */
export const requireCommunitiesOrganizer = async (ctx, communityIds) => {
  const user = requireUser(ctx);
  if (isAdmin(user)) return;
  const ids = (communityIds || []).filter(Boolean);
  if (ids.length === 0) {
    throw forbiddenError('Informe uma comunidade que você organiza.');
  }
  await Promise.all(ids.map((id) => requireCommunityOrganizer(ctx, id)));
};

/** Organizer of the event the talk belongs to, or admin. */
export const requireTalkOrganizer = async (ctx, talkId) => {
  if (isAdmin(requireUser(ctx))) return;
  const talk = talkId
    ? await memo(ctx, `talk:${talkId}`, () =>
      ctx.dataSources.managerIntegration.findTalkWithEvent(String(talkId)))
    : null;
  await requireEventOrganizer(ctx, talk?.event?.documentId);
};

/**
 * Linking an event to communities: an organizer of the event may keep the communities
 * it already has, but only adds the ones they organize too. Call after
 * requireEventOrganizer.
 */
export const requireOrganizerOfNewCommunities = async (ctx, eventIdOrSlug, communityIds) => {
  if (isAdmin(requireUser(ctx)) || !Array.isArray(communityIds)) return;
  const event = await loadEvent(ctx, eventIdOrSlug);
  const current = new Set((event?.communities || []).map((c) => c?.documentId).filter(Boolean));
  const added = communityIds.filter((id) => id && !current.has(id));
  if (added.length > 0) await requireCommunitiesOrganizer(ctx, added);
};

/** The author of a record (by user documentId), or admin. */
export const requireAuthorOrAdmin = (ctx, authorDocumentId) => {
  const user = requireUser(ctx);
  if (isAdmin(user)) return;
  if (!authorDocumentId || authorDocumentId !== user.documentId) {
    throw forbiddenError('Apenas o autor pode fazer esta operação.');
  }
};
