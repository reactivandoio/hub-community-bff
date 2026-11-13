import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  INVITES_PER_DAY,
  acceptInvite,
  acceptPendingInvites,
  communityOrganizers,
  eventManagers,
  hashToken,
  inviteCommunityOrganizer,
  inviteEventManager,
  inviteStatus,
  previewInvite,
  removeCommunityOrganizer,
  removeEventManager,
  revokeInvite,
} from './index';

vi.mock('../email', () => ({ sendEmail: vi.fn() }));

const NOW = new Date('2026-11-13T12:00:00Z');
const LATER = new Date('2026-11-25T12:00:00Z'); // past the 7 days

const ADMIN = { id: 1, documentId: 'u-admin', email: 'root@x.io', name: 'Root', role: { type: 'admin' } };
const ANA = { id: 2, documentId: 'u-ana', email: 'ana@x.io', name: 'Ana', role: { type: 'community-manager' } };
const EVA = { id: 3, documentId: 'u-eva', email: 'eva@x.io', role: { type: 'event-manager' } };
const BIA = { id: 4, documentId: 'u-bia', email: 'Bia@X.io', role: { type: 'authenticated' } };

const COMMUNITY = { documentId: 'c-1', title: 'Comunidade', organizers: [{ documentId: 'u-ana', email: 'ana@x.io', name: 'Ana' }] };
const EVENT = {
  documentId: 'ev-1',
  slug: 'meetup',
  title: 'Meetup',
  communities: [{ documentId: 'c-1', organizers: [{ documentId: 'u-ana' }] }],
  managers: [{ documentId: 'u-eva', email: 'eva@x.io', name: 'Eva' }],
};
const ROLES = [
  { id: 10, type: 'authenticated' },
  { id: 11, type: 'event-manager' },
  { id: 12, type: 'community-manager' },
  { id: 13, type: 'admin' },
];

const pending = (overrides = {}) => ({
  documentId: 'inv-1',
  kind: 'event_manager',
  email: 'bia@x.io',
  token_hash: hashToken('tok'),
  expires_at: '2026-11-20T12:00:00Z',
  event: { documentId: 'ev-1', slug: 'meetup', title: 'Meetup' },
  invited_by: { documentId: 'u-ana' },
  invited_by_email: 'ana@x.io',
  ...overrides,
});

const makeCtx = (user, overrides = {}) => {
  const ds = {
    findEventWithOrganizers: vi.fn().mockResolvedValue(EVENT),
    findEventManagers: vi.fn().mockResolvedValue(EVENT),
    findCommunityOrganizers: vi.fn().mockResolvedValue(COMMUNITY),
    findManagementInvites: vi.fn().mockResolvedValue([]),
    findManagementInviteByHash: vi.fn().mockResolvedValue(null),
    findManagementInvite: vi.fn().mockResolvedValue(null),
    createManagementInvite: vi.fn(async (data) => ({ documentId: 'inv-new', createdAt: NOW.toISOString(), ...data })),
    updateManagementInvite: vi.fn().mockResolvedValue({}),
    addCommunityOrganizer: vi.fn().mockResolvedValue({}),
    removeCommunityOrganizer: vi.fn().mockResolvedValue({}),
    addEventManager: vi.fn().mockResolvedValue({}),
    removeEventManager: vi.fn().mockResolvedValue({}),
    adminFindRoles: vi.fn().mockResolvedValue(ROLES),
    adminSetUserRoleId: vi.fn().mockResolvedValue({}),
    adminCreateRoleChange: vi.fn().mockResolvedValue({}),
    adminFindUser: vi.fn(async (id) => [ADMIN, ANA, EVA, BIA].find((u) => String(u.id) === String(id)) || null),
    ...overrides,
  };
  return { user, dataSources: { managerIntegration: ds } };
};
const dsOf = (ctx) => ctx.dataSources.managerIntegration;

const codeOf = async (run) => {
  try {
    await run();
    return null;
  } catch (err) {
    return err.extensions?.code || err.message;
  }
};

const sent = () => vi.fn().mockResolvedValue({ success: true });

beforeEach(() => vi.clearAllMocks());

describe('who may invite and remove', () => {
  it('only the admin invites and removes organizers of a community', async () => {
    for (const user of [ANA, EVA, BIA]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await codeOf(() => inviteCommunityOrganizer(makeCtx(user), { communityId: 'c-1', email: 'x@x.io', send: sent() })))
        .toBe('FORBIDDEN');
      // eslint-disable-next-line no-await-in-loop
      expect(await codeOf(() => removeCommunityOrganizer(makeCtx(user), { communityId: 'c-1', userId: 'u-ana' })))
        .toBe('FORBIDDEN');
    }
    expect(await codeOf(() => inviteCommunityOrganizer(makeCtx(undefined), { communityId: 'c-1', email: 'x@x.io' })))
      .toBe('UNAUTHENTICATED');
  });

  it("the admin and the organizers of the event's community invite managers; a manager does not", async () => {
    expect(await codeOf(() => inviteEventManager(makeCtx(ADMIN), { eventId: 'meetup', email: 'x@x.io', send: sent(), now: NOW }))).toBeNull();
    expect(await codeOf(() => inviteEventManager(makeCtx(ANA), { eventId: 'meetup', email: 'x@x.io', send: sent(), now: NOW }))).toBeNull();
    expect(await codeOf(() => inviteEventManager(makeCtx(EVA), { eventId: 'meetup', email: 'x@x.io', send: sent() }))).toBe('FORBIDDEN');
    expect(await codeOf(() => removeEventManager(makeCtx(EVA), { eventId: 'meetup', userId: 'u-eva' }))).toBe('FORBIDDEN');
    expect(await codeOf(() => inviteEventManager(makeCtx(BIA), { eventId: 'meetup', email: 'x@x.io', send: sent() }))).toBe('FORBIDDEN');
  });
});

describe('invite', () => {
  it('stores only the hash of the token, expires in 7 days and e-mails the link (transactional)', async () => {
    const send = sent();
    const ctx = makeCtx(ANA);
    const out = await inviteEventManager(ctx, { eventId: 'meetup', email: '  New@X.io ', send, now: NOW });
    const data = dsOf(ctx).createManagementInvite.mock.calls[0][0];
    expect(data).toMatchObject({
      kind: 'event_manager',
      email: 'new@x.io',
      event: 'ev-1',
      invited_by: 'u-ana',
      invited_by_email: 'ana@x.io',
      expires_at: '2026-11-20T12:00:00.000Z',
    });
    expect(data.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(data).not.toHaveProperty('token');
    const email = send.mock.calls[0][0];
    expect(email).toMatchObject({ kind: 'management-invite', to: 'new@x.io', subject: 'Convite para gerir Meetup no Hub Community' });
    const token = /\/convite\?t=([\w-]+)/.exec(email.html)[1];
    expect(hashToken(token)).toBe(data.token_hash);
    expect(out).toMatchObject({ id: 'inv-new', email: 'new@x.io', status: 'pending' });
  });

  it('revokes the previous pending invite to the same e-mail and place', async () => {
    const ctx = makeCtx(ADMIN, {
      findManagementInvites: vi.fn()
        .mockResolvedValueOnce([]) // daily limit
        .mockResolvedValueOnce([{ documentId: 'inv-old' }]),
    });
    await inviteCommunityOrganizer(ctx, { communityId: 'c-1', email: 'new@x.io', send: sent(), now: NOW });
    expect(dsOf(ctx).updateManagementInvite).toHaveBeenCalledWith('inv-old', { revoked_at: NOW.toISOString() });
  });

  it('refuses someone who is already organizer / manager, and a bad e-mail', async () => {
    expect(await codeOf(() => inviteCommunityOrganizer(makeCtx(ADMIN), { communityId: 'c-1', email: 'ANA@x.io', send: sent() }))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => inviteEventManager(makeCtx(ADMIN), { eventId: 'meetup', email: 'eva@x.io', send: sent() }))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => inviteEventManager(makeCtx(ADMIN), { eventId: 'meetup', email: 'not-an-email', send: sent() }))).toBe('BAD_USER_INPUT');
  });

  it(`stops at ${INVITES_PER_DAY} invites a day per person (every one is an e-mail)`, async () => {
    const ctx = makeCtx(ANA, {
      findManagementInvites: vi.fn().mockResolvedValue(Array.from({ length: INVITES_PER_DAY }, (_, i) => ({ documentId: `i${i}` }))),
    });
    expect(await codeOf(() => inviteEventManager(ctx, { eventId: 'meetup', email: 'x@x.io', send: sent(), now: NOW }))).toBe('FORBIDDEN');
    expect(dsOf(ctx).createManagementInvite).not.toHaveBeenCalled();
  });

  it('cancels the invite when the e-mail is not sent', async () => {
    const ctx = makeCtx(ANA);
    const send = vi.fn().mockResolvedValue({ success: false, error: 'quota' });
    expect(await codeOf(() => inviteEventManager(ctx, { eventId: 'meetup', email: 'x@x.io', send, now: NOW }))).toBe('INVITE_NOT_SENT');
    expect(dsOf(ctx).updateManagementInvite).toHaveBeenCalledWith('inv-new', { revoked_at: NOW.toISOString() });
  });
});

describe('accept by the link', () => {
  const withInvite = (user, invite) => makeCtx(user, { findManagementInviteByHash: vi.fn().mockResolvedValue(invite) });

  it('makes the person a manager and raises their role to event-manager', async () => {
    const ctx = withInvite(BIA, pending());
    const out = await acceptInvite(ctx, { token: 'tok', now: NOW });
    expect(dsOf(ctx).findManagementInviteByHash).toHaveBeenCalledWith(hashToken('tok'));
    expect(dsOf(ctx).addEventManager).toHaveBeenCalledWith('ev-1', 'u-bia');
    expect(dsOf(ctx).updateManagementInvite).toHaveBeenCalledWith('inv-1', { accepted_at: NOW.toISOString(), accepted_by: 'u-bia' });
    expect(dsOf(ctx).adminSetUserRoleId).toHaveBeenCalledWith('4', 11);
    expect(dsOf(ctx).adminCreateRoleChange).toHaveBeenCalledWith(expect.objectContaining({
      target: 'u-bia', from_role: 'authenticated', to_role: 'event-manager', actor: 'u-ana',
    }));
    expect(out).toMatchObject({ kind: 'event_manager', role: 'event-manager', eventId: 'ev-1', eventSlug: 'meetup' });
  });

  it('never lowers a role: a community-manager stays one', async () => {
    const ctx = withInvite(ANA, pending({ email: 'ana@x.io' }));
    const out = await acceptInvite(ctx, { token: 'tok', now: NOW });
    expect(dsOf(ctx).addEventManager).toHaveBeenCalledWith('ev-1', 'u-ana');
    expect(dsOf(ctx).adminSetUserRoleId).not.toHaveBeenCalled();
    expect(out.role).toBe('community-manager');
  });

  it('a community invite makes the person organizer and community-manager', async () => {
    const ctx = withInvite(EVA, pending({ kind: 'community_organizer', email: 'eva@x.io', event: null, community: { documentId: 'c-1', title: 'Comunidade' } }));
    await acceptInvite(ctx, { token: 'tok', now: NOW });
    expect(dsOf(ctx).addCommunityOrganizer).toHaveBeenCalledWith('c-1', 'u-eva');
    expect(dsOf(ctx).adminSetUserRoleId).toHaveBeenCalledWith('3', 12);
  });

  it('works only for the invited e-mail', async () => {
    const ctx = withInvite(EVA, pending());
    expect(await codeOf(() => acceptInvite(ctx, { token: 'tok', now: NOW }))).toBe('FORBIDDEN');
    expect(dsOf(ctx).addEventManager).not.toHaveBeenCalled();
  });

  it('is used once, expires and can be revoked', async () => {
    expect(await codeOf(() => acceptInvite(withInvite(BIA, pending()), { token: 'tok', now: LATER }))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => acceptInvite(withInvite(BIA, pending({ revoked_at: NOW.toISOString() })), { token: 'tok', now: NOW }))).toBe('BAD_USER_INPUT');
    const used = pending({ accepted_at: NOW.toISOString(), accepted_by: { documentId: 'u-other' } });
    expect(await codeOf(() => acceptInvite(withInvite(BIA, used), { token: 'tok', now: NOW }))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => acceptInvite(withInvite(BIA, null), { token: 'nope', now: NOW }))).toBe('BAD_USER_INPUT');
  });

  it('answers again, without granting twice, to whoever already accepted it (e.g. on the login)', async () => {
    const ctx = withInvite(BIA, pending({ accepted_at: NOW.toISOString(), accepted_by: { documentId: 'u-bia' } }));
    const out = await acceptInvite(ctx, { token: 'tok', now: NOW });
    expect(out).toMatchObject({ eventId: 'ev-1' });
    expect(dsOf(ctx).addEventManager).not.toHaveBeenCalled();
  });

  it('needs a login', async () => {
    expect(await codeOf(() => acceptInvite(withInvite(undefined, pending()), { token: 'tok' }))).toBe('UNAUTHENTICATED');
  });
});

describe('accept on the login by code (REA-26)', () => {
  it('turns every pending invite of the e-mail into access, raising the role once', async () => {
    const invites = [
      pending({ documentId: 'inv-a' }),
      pending({ documentId: 'inv-b', kind: 'community_organizer', event: null, community: { documentId: 'c-1' } }),
    ];
    const ctx = makeCtx(undefined, { findManagementInvites: vi.fn().mockResolvedValue(invites) });
    const accepted = await acceptPendingInvites(ctx.dataSources, { id: 4, documentId: 'u-bia', email: 'Bia@X.io' }, NOW);
    expect(accepted).toBe(2);
    const filters = dsOf(ctx).findManagementInvites.mock.calls[0][0];
    expect(filters).toMatchObject({ email: { eq: 'bia@x.io' }, accepted_at: { null: true }, revoked_at: { null: true }, expires_at: { gt: NOW.toISOString() } });
    expect(dsOf(ctx).addEventManager).toHaveBeenCalledWith('ev-1', 'u-bia');
    expect(dsOf(ctx).addCommunityOrganizer).toHaveBeenCalledWith('c-1', 'u-bia');
    // authenticated → event-manager, then event-manager → community-manager.
    expect(dsOf(ctx).adminSetUserRoleId.mock.calls).toEqual([['4', 11], ['4', 12]]);
  });

  it('does nothing without pending invites, and never fails the login', async () => {
    const none = makeCtx(undefined);
    expect(await acceptPendingInvites(none.dataSources, { id: 4, documentId: 'u-bia', email: 'bia@x.io' }, NOW)).toBe(0);
    expect(dsOf(none).adminFindUser).not.toHaveBeenCalled();
    const broken = makeCtx(undefined, { findManagementInvites: vi.fn().mockRejectedValue(new Error('down')) });
    expect(await acceptPendingInvites(broken.dataSources, { id: 4, email: 'bia@x.io' }, NOW)).toBe(0);
  });
});

describe('lists, removal, revoking, preview', () => {
  it('lists the managers to the managers too, but only owners manage them (and see invites)', async () => {
    const asEva = makeCtx(EVA);
    const outEva = await eventManagers(asEva, { eventId: 'meetup', now: NOW });
    expect(outEva).toMatchObject({ canManage: false, invites: [], managers: [{ id: 'u-eva', email: 'eva@x.io' }] });
    const asAna = makeCtx(ANA, { findManagementInvites: vi.fn().mockResolvedValue([pending()]) });
    const outAna = await eventManagers(asAna, { eventId: 'meetup', now: NOW });
    expect(outAna.canManage).toBe(true);
    expect(outAna.invites).toEqual([expect.objectContaining({ id: 'inv-1', email: 'bia@x.io', status: 'pending' })]);
    expect(await codeOf(() => eventManagers(makeCtx(BIA), { eventId: 'meetup' }))).toBe('FORBIDDEN');
  });

  it('lists the organizers of a community to the admin', async () => {
    const out = await communityOrganizers(makeCtx(ADMIN), { communityId: 'c-1', now: NOW });
    expect(out.organizers).toEqual([{ id: 'u-ana', name: 'Ana', email: 'ana@x.io' }]);
  });

  it('removes a manager / organizer without touching their role', async () => {
    const ctx = makeCtx(ANA);
    expect(await removeEventManager(ctx, { eventId: 'meetup', userId: 'u-eva' })).toBe(true);
    expect(dsOf(ctx).removeEventManager).toHaveBeenCalledWith('ev-1', 'u-eva');
    expect(dsOf(ctx).adminSetUserRoleId).not.toHaveBeenCalled();
    const admin = makeCtx(ADMIN);
    await removeCommunityOrganizer(admin, { communityId: 'c-1', userId: 'u-ana' });
    expect(dsOf(admin).removeCommunityOrganizer).toHaveBeenCalledWith('c-1', 'u-ana');
    expect(await codeOf(() => removeEventManager(makeCtx(ANA), { eventId: 'meetup', userId: 'u-nobody' }))).toBe('BAD_USER_INPUT');
  });

  it('revokes an invite: event invites by the owners, community invites by the admin', async () => {
    const eventInvite = pending();
    const ctx = makeCtx(ANA, { findManagementInvite: vi.fn().mockResolvedValue(eventInvite) });
    expect(await revokeInvite(ctx, { id: 'inv-1', now: NOW })).toBe(true);
    expect(dsOf(ctx).updateManagementInvite).toHaveBeenCalledWith('inv-1', { revoked_at: NOW.toISOString() });
    const communityInvite = pending({ kind: 'community_organizer', event: null, community: { documentId: 'c-1' } });
    expect(await codeOf(() => revokeInvite(makeCtx(ANA, { findManagementInvite: vi.fn().mockResolvedValue(communityInvite) }), { id: 'inv-1' })))
      .toBe('FORBIDDEN');
  });

  it('previews an invite with the e-mail masked, null for an unknown link', async () => {
    const ctx = makeCtx(undefined, { findManagementInviteByHash: vi.fn().mockResolvedValue(pending({ email: 'maria.silva@gmail.com' })) });
    expect(await previewInvite(ctx.dataSources, { token: 'tok', now: NOW })).toMatchObject({
      kind: 'event_manager', status: 'pending', maskedEmail: 'mari****@***ail.com', eventTitle: 'Meetup',
    });
    expect(await previewInvite(makeCtx(undefined).dataSources, { token: 'x' })).toBeNull();
  });

  it('tells the status of an invite', () => {
    expect(inviteStatus(pending(), NOW)).toBe('pending');
    expect(inviteStatus(pending(), LATER)).toBe('expired');
    expect(inviteStatus(pending({ accepted_at: 'x' }), NOW)).toBe('accepted');
    expect(inviteStatus(pending({ revoked_at: 'x' }), NOW)).toBe('revoked');
  });
});
