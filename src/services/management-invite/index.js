// REA-48 — invites to organize a community (admin only) or manage an event (its owners).
//
// The invite is a link with a random token; only its sha256 is stored. It expires in
// INVITE_TTL_DAYS and is used once. It is accepted:
//   - on the login by code (REA-26) of its e-mail: every pending invite of that e-mail becomes
//     access, since the code proves the e-mail is theirs; or
//   - by its link, already logged in with the same e-mail.
// Accepting links the person (`community.organizers` / `event.managers`) and raises their role to
// community-manager / event-manager when it is lower — never lowers it. Removing someone never
// changes their role: the admin sees the mismatch in /admin/usuarios and decides.
import crypto from 'crypto';
import { GraphQLError } from 'graphql';
import {
  ROLES,
  clearUserCache,
  forbiddenError,
  isEventOrganizer,
  requireAdmin,
  requireEventOwner,
  requireUser,
  roleOf,
  roleRank,
} from '../../utils/auth';
import { maskEmail } from '../../utils/mask-email';
import { sendEmail } from '../email';
import { managementInviteTemplate } from '../email/templates/management-invite';

export const INVITE_TTL_DAYS = 7;
/** Invites one person may send in 24 h: every one is an e-mail on the Mailgun plan. */
export const INVITES_PER_DAY = 30;

export const KINDS = Object.freeze({
  COMMUNITY: 'community_organizer',
  EVENT: 'event_manager',
});

const ROLE_OF_KIND = {
  [KINDS.COMMUNITY]: ROLES.COMMUNITY_MANAGER,
  [KINDS.EVENT]: ROLES.EVENT_MANAGER,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

export const normalizeInviteEmail = (value) => {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw badInput('Informe um e-mail válido.');
  return email;
};

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export const newToken = () => {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
};

const frontendUrl = () => (process.env.FRONTEND_URL || 'https://hubcommunity.io').replace(/\/$/, '');
export const inviteUrl = (token) => `${frontendUrl()}/convite?t=${encodeURIComponent(token)}`;

const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** pending | accepted | revoked | expired */
export const inviteStatus = (invite, now = new Date()) => {
  if (invite?.revoked_at) return 'revoked';
  if (invite?.accepted_at) return 'accepted';
  if (!invite?.expires_at || new Date(invite.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'pending';
};

const pendingFilters = (now) => ({
  accepted_at: { null: true },
  revoked_at: { null: true },
  expires_at: { gt: now.toISOString() },
});

export const toInvite = (invite, now = new Date()) => ({
  id: invite.documentId,
  kind: invite.kind,
  email: invite.email,
  status: inviteStatus(invite, now),
  expiresAt: invite.expires_at,
  invitedByEmail: invite.invited_by_email ?? null,
  createdAt: invite.createdAt ?? null,
});

const toPerson = (user) => ({
  id: user.documentId,
  name: user.name || user.username || null,
  email: user.email || null,
});

// ─── Who may ────────────────────────────────────────────────────────────────────────────────

const loadEventManagers = async (ds, eventId) => {
  const event = await ds.findEventManagers(String(eventId));
  if (!event?.documentId) throw badInput('Evento não encontrado.');
  return event;
};

const loadCommunityOrganizers = async (ds, communityId) => {
  const community = await ds.findCommunityOrganizers(String(communityId));
  if (!community?.documentId) throw badInput('Comunidade não encontrada.');
  return community;
};

// ─── Invite ─────────────────────────────────────────────────────────────────────────────────

const checkDailyLimit = async (ds, actor, now) => {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await ds.findManagementInvites({
    invited_by: { documentId: { eq: actor.documentId } },
    createdAt: { gte: since },
  });
  if (recent.length >= INVITES_PER_DAY) {
    throw forbiddenError(`Você já enviou ${INVITES_PER_DAY} convites nas últimas 24 horas. Tente de novo amanhã.`);
  }
};

/**
 * Creates the invite and e-mails it. A newer invite to the same e-mail and place revokes the
 * previous ones, so only the last link works. If the e-mail cannot be sent, the invite is revoked.
 */
const createAndSend = async ({ ctx, kind, email, target, targetTitle, now, send }) => {
  const ds = ctx.dataSources.managerIntegration;
  const actor = ctx.user;
  await checkDailyLimit(ds, actor, now);

  const relation = kind === KINDS.COMMUNITY ? 'community' : 'event';
  const previous = await ds.findManagementInvites({
    kind: { eq: kind },
    email: { eq: email },
    [relation]: { documentId: { eq: target } },
    ...pendingFilters(now),
  });
  await Promise.all(previous.map((invite) =>
    ds.updateManagementInvite(invite.documentId, { revoked_at: now.toISOString() })));

  const { token, tokenHash } = newToken();
  const invite = await ds.createManagementInvite({
    kind,
    email,
    token_hash: tokenHash,
    expires_at: new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    [relation]: target,
    invited_by: actor.documentId,
    invited_by_email: actor.email || null,
  });
  if (!invite?.documentId) throw new Error('Não foi possível criar o convite.');

  const result = await send({
    kind: 'management-invite',
    to: email,
    subject: kind === KINDS.COMMUNITY
      ? `Convite para organizar ${targetTitle} no Hub Community`
      : `Convite para gerir ${targetTitle} no Hub Community`,
    html: managementInviteTemplate({
      kind,
      targetTitle,
      inviterName: actor.name || actor.username || actor.email,
      url: inviteUrl(token),
      days: INVITE_TTL_DAYS,
    }),
  });
  if (!result?.success) {
    await ds.updateManagementInvite(invite.documentId, { revoked_at: now.toISOString() });
    throw new GraphQLError('Não foi possível enviar o e-mail do convite. Tente de novo em alguns minutos.', {
      extensions: { code: 'INVITE_NOT_SENT' },
    });
  }
  return toInvite(invite, now);
};

export const inviteCommunityOrganizer = async (ctx, { communityId, email: rawEmail, now = new Date(), send = sendEmail }) => {
  requireAdmin(ctx);
  const email = normalizeInviteEmail(rawEmail);
  const ds = ctx.dataSources.managerIntegration;
  const community = await loadCommunityOrganizers(ds, communityId);
  if ((community.organizers || []).some((user) => sameEmail(user.email, email))) {
    throw badInput('Esta pessoa já organiza a comunidade.');
  }
  return createAndSend({
    ctx, kind: KINDS.COMMUNITY, email, target: community.documentId, targetTitle: community.title || 'a comunidade', now, send,
  });
};

export const inviteEventManager = async (ctx, { eventId, email: rawEmail, now = new Date(), send = sendEmail }) => {
  await requireEventOwner(ctx, eventId);
  const email = normalizeInviteEmail(rawEmail);
  const ds = ctx.dataSources.managerIntegration;
  const event = await loadEventManagers(ds, eventId);
  if ((event.managers || []).some((user) => sameEmail(user.email, email))) {
    throw badInput('Esta pessoa já gere o evento.');
  }
  return createAndSend({
    ctx, kind: KINDS.EVENT, email, target: event.documentId, targetTitle: event.title || 'o evento', now, send,
  });
};

// ─── Accept ─────────────────────────────────────────────────────────────────────────────────

/** Links the person and raises the role when lower. Marks the invite used. */
const grant = async (ds, invite, user, now) => {
  if (invite.kind === KINDS.COMMUNITY) {
    await ds.addCommunityOrganizer(invite.community.documentId, user.documentId);
  } else {
    await ds.addEventManager(invite.event.documentId, user.documentId);
  }
  await ds.updateManagementInvite(invite.documentId, {
    accepted_at: now.toISOString(),
    accepted_by: user.documentId,
  });

  const target = ROLE_OF_KIND[invite.kind];
  const from = roleOf(user) || ROLES.AUTHENTICATED;
  let role = from;
  if (roleRank(from) < roleRank(target)) {
    const roles = await ds.adminFindRoles();
    const roleId = roles.find((r) => r.type === target)?.id;
    if (roleId != null) {
      await ds.adminSetUserRoleId(String(user.id), roleId);
      role = target;
      try {
        await ds.adminCreateRoleChange({
          actor: invite.invited_by?.documentId || null,
          actor_email: invite.invited_by_email ? `convite de ${invite.invited_by_email}` : 'convite',
          target: user.documentId,
          target_email: user.email || null,
          from_role: from,
          to_role: target,
        });
      } catch (err) {
        // The access is the invite's; a missing audit row must not undo it.
        console.error(`[invite] role change of ${maskEmail(user.email)} not recorded: ${err.message}`);
      }
      clearUserCache();
    } else {
      console.error(`[invite] role "${target}" does not exist in the Hub Strapi`);
    }
  }
  return { invite, role };
};

const toAcceptance = ({ invite, role }) => ({
  kind: invite.kind,
  role,
  communityId: invite.community?.documentId ?? null,
  communityTitle: invite.community?.title ?? null,
  eventId: invite.event?.documentId ?? null,
  eventSlug: invite.event?.slug ?? null,
  eventTitle: invite.event?.title ?? null,
});

/**
 * REA-26 login: the code proved the e-mail is theirs, so every pending invite of that e-mail
 * becomes access. Never throws (the login goes on); returns how many were accepted.
 */
export const acceptPendingInvites = async (dataSources, user, now = new Date()) => {
  if (!user?.email || user?.id == null) return 0;
  const ds = dataSources.managerIntegration;
  try {
    const invites = await ds.findManagementInvites({
      email: { eq: String(user.email).trim().toLowerCase() },
      ...pendingFilters(now),
    });
    if (invites.length === 0) return 0;
    // The login answers the user without the role, which decides whether an invite raises it.
    let current = (await ds.adminFindUser(String(user.id))) || user;
    let accepted = 0;
    // One at a time: each may raise the role the next one compares with.
    // eslint-disable-next-line no-restricted-syntax
    for (const invite of invites) {
      if (!invite.community?.documentId && !invite.event?.documentId) continue; // eslint-disable-line no-continue
      // eslint-disable-next-line no-await-in-loop
      const { role } = await grant(ds, invite, current, now);
      current = { ...current, role: { ...(current.role || {}), type: role } };
      accepted += 1;
    }
    if (accepted) console.info(`[invite] ${accepted} convite(s) aceito(s) no login de ${maskEmail(user.email)}`);
    return accepted;
  } catch (err) {
    console.error(`[invite] pending invites of ${maskEmail(user.email)} not accepted: ${err.message}`);
    return 0;
  }
};

/** By the link, logged in. The invite is for one e-mail: another account cannot use it. */
export const acceptInvite = async (ctx, { token, now = new Date() }) => {
  const user = requireUser(ctx);
  const ds = ctx.dataSources.managerIntegration;
  const invite = token ? await ds.findManagementInviteByHash(hashToken(token)) : null;
  if (!invite) throw badInput('Convite não encontrado. Confira o link do e-mail.');
  const status = inviteStatus(invite, now);
  if (status === 'accepted') {
    // Already accepted by this same person (e.g. on the login a moment ago): show where it leads.
    if (invite.accepted_by?.documentId === user.documentId) return toAcceptance({ invite, role: roleOf(user) });
    throw badInput('Este convite já foi usado.');
  }
  if (status === 'revoked') throw badInput('Este convite foi cancelado. Peça um novo a quem convidou você.');
  if (status === 'expired') throw badInput('Este convite expirou. Peça um novo a quem convidou você.');
  if (!sameEmail(invite.email, user.email)) {
    throw forbiddenError(`Este convite foi enviado para ${maskEmail(invite.email)}. Saia e entre com esse e-mail.`);
  }
  return toAcceptance(await grant(ds, invite, user, now));
};

/** Public preview for the /convite page: where it leads and the masked e-mail. */
export const previewInvite = async (dataSources, { token, now = new Date() }) => {
  const invite = token
    ? await dataSources.managerIntegration.findManagementInviteByHash(hashToken(token))
    : null;
  if (!invite) return null;
  return {
    kind: invite.kind,
    status: inviteStatus(invite, now),
    maskedEmail: maskEmail(invite.email),
    communityTitle: invite.community?.title ?? null,
    eventTitle: invite.event?.title ?? null,
    expiresAt: invite.expires_at,
  };
};

// ─── Lists, removal, revoking ───────────────────────────────────────────────────────────────

export const communityOrganizers = async (ctx, { communityId, now = new Date() }) => {
  requireAdmin(ctx);
  const ds = ctx.dataSources.managerIntegration;
  const community = await loadCommunityOrganizers(ds, communityId);
  const invites = await ds.findManagementInvites({
    kind: { eq: KINDS.COMMUNITY },
    community: { documentId: { eq: community.documentId } },
    ...pendingFilters(now),
  });
  return {
    organizers: (community.organizers || []).map(toPerson),
    invites: invites.map((invite) => toInvite(invite, now)),
  };
};

export const eventManagers = async (ctx, { eventId, now = new Date() }) => {
  requireUser(ctx);
  if (!(await isEventOrganizer(ctx, eventId))) {
    throw forbiddenError('Apenas organizadores do evento podem fazer esta operação.');
  }
  const ds = ctx.dataSources.managerIntegration;
  const event = await loadEventManagers(ds, eventId);
  let canManage = true;
  try {
    await requireEventOwner(ctx, eventId);
  } catch {
    canManage = false;
  }
  const invites = canManage
    ? await ds.findManagementInvites({
      kind: { eq: KINDS.EVENT },
      event: { documentId: { eq: event.documentId } },
      ...pendingFilters(now),
    })
    : [];
  return {
    managers: (event.managers || []).map(toPerson),
    invites: invites.map((invite) => toInvite(invite, now)),
    canManage,
  };
};

export const removeCommunityOrganizer = async (ctx, { communityId, userId }) => {
  requireAdmin(ctx);
  const ds = ctx.dataSources.managerIntegration;
  const community = await loadCommunityOrganizers(ds, communityId);
  if (!(community.organizers || []).some((user) => user.documentId === userId)) {
    throw badInput('Esta pessoa não organiza a comunidade.');
  }
  await ds.removeCommunityOrganizer(community.documentId, userId);
  clearUserCache();
  return true;
};

export const removeEventManager = async (ctx, { eventId, userId }) => {
  await requireEventOwner(ctx, eventId);
  const ds = ctx.dataSources.managerIntegration;
  const event = await loadEventManagers(ds, eventId);
  if (!(event.managers || []).some((user) => user.documentId === userId)) {
    throw badInput('Esta pessoa não gere o evento.');
  }
  await ds.removeEventManager(event.documentId, userId);
  clearUserCache();
  return true;
};

export const revokeInvite = async (ctx, { id, now = new Date() }) => {
  requireUser(ctx);
  const ds = ctx.dataSources.managerIntegration;
  const invite = id ? await ds.findManagementInvite(String(id)) : null;
  if (!invite) throw badInput('Convite não encontrado.');
  if (invite.kind === KINDS.COMMUNITY) requireAdmin(ctx);
  else await requireEventOwner(ctx, invite.event?.documentId);
  if (inviteStatus(invite, now) !== 'pending') return true;
  await ds.updateManagementInvite(invite.documentId, { revoked_at: now.toISOString() });
  return true;
};
