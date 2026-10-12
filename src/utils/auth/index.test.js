import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jsonwebtoken from 'jsonwebtoken';
import {
  authenticate,
  clearUserCache,
  createAuthContext,
  isAdmin,
  isEventOrganizer,
  requireAdmin,
  requireAuthorOrAdmin,
  requireCommunitiesOrganizer,
  requireEventOrganizer,
  requireOrganizerOfNewCommunities,
  requireTalkOrganizer,
  requireUser,
} from './index';

const SECRET = 'test-secret';
const sign = (payload, secret = SECRET) => `Bearer ${jsonwebtoken.sign(payload, secret, { expiresIn: '1h' })}`;

const ANA = { id: 1, documentId: 'u-ana', email: 'ana@x.io', role: { type: 'authenticated' } };
const BIA = { id: 2, documentId: 'u-bia', email: 'bia@x.io', role: { type: 'authenticated' } };
const ADMIN = { id: 3, documentId: 'u-admin', email: 'root@x.io', role: { type: 'admin' } };

const EVENT = {
  documentId: 'ev-1',
  slug: 'meetup',
  communities: [{ documentId: 'c-1', organizers: [{ documentId: 'u-ana' }] }],
};

const makeDataSources = ({ user = ANA, event = EVENT, community = null, talk = null } = {}) => ({
  managerIntegration: {
    findUserWithRole: vi.fn().mockResolvedValue({ data: user }),
    findEventWithOrganizers: vi.fn().mockResolvedValue(event),
    findCommunityWithOrganizers: vi.fn().mockResolvedValue(community),
    findTalkWithEvent: vi.fn().mockResolvedValue(talk),
  },
});

const ctxOf = (user, dataSources = makeDataSources()) => ({ user, dataSources });

const expectCode = async (promiseOrFn, code) => {
  const run = typeof promiseOrFn === 'function' ? promiseOrFn : () => promiseOrFn;
  let error;
  try {
    await run();
  } catch (err) {
    error = err;
  }
  expect(error, `expected ${code}`).toBeDefined();
  expect(error.extensions?.code).toBe(code);
};

let previousSecret;
let previousAdmins;
beforeEach(() => {
  previousSecret = process.env.JWT_SECRET;
  previousAdmins = process.env.ADMIN_EMAILS;
  process.env.JWT_SECRET = SECRET;
  delete process.env.ADMIN_EMAILS;
  clearUserCache();
});
afterEach(() => {
  process.env.JWT_SECRET = previousSecret;
  process.env.ADMIN_EMAILS = previousAdmins;
  vi.useRealTimers();
});

describe('authenticate', () => {
  it('loads the user (with role) of a verified token', async () => {
    const dataSources = makeDataSources();
    expect(await authenticate(sign({ id: 1 }), dataSources)).toEqual(ANA);
    expect(dataSources.managerIntegration.findUserWithRole).toHaveBeenCalledWith(1);
  });

  it('never looks a user up for a forged token', async () => {
    const dataSources = makeDataSources();
    expect(await authenticate(sign({ id: 1 }, 'forged'), dataSources)).toBeNull();
    expect(dataSources.managerIntegration.findUserWithRole).not.toHaveBeenCalled();
  });

  it('caches by token for 60 s, then asks again', async () => {
    vi.useFakeTimers();
    const dataSources = makeDataSources();
    const token = sign({ id: 1 });
    await authenticate(token, dataSources);
    await authenticate(token, dataSources);
    expect(dataSources.managerIntegration.findUserWithRole).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61 * 1000);
    await authenticate(token, dataSources);
    expect(dataSources.managerIntegration.findUserWithRole).toHaveBeenCalledTimes(2);
  });

  it('does not share the cache between two tokens of the same id', async () => {
    const dataSources = makeDataSources();
    await authenticate(sign({ id: 1, n: 1 }), dataSources);
    await authenticate(sign({ id: 1, n: 2 }), dataSources);
    expect(dataSources.managerIntegration.findUserWithRole).toHaveBeenCalledTimes(2);
  });

  it('is anonymous for a blocked user, or when the id does not match', async () => {
    expect(await authenticate(sign({ id: 1 }), makeDataSources({ user: { ...ANA, blocked: true } }))).toBeNull();
    expect(await authenticate(sign({ id: 99 }), makeDataSources())).toBeNull();
  });

  it('is anonymous (and not cached) when Strapi fails', async () => {
    const dataSources = makeDataSources();
    dataSources.managerIntegration.findUserWithRole
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({ data: ANA });
    const token = sign({ id: 1 });
    expect(await authenticate(token, dataSources)).toBeNull();
    expect(await authenticate(token, dataSources)).toEqual(ANA);
  });
});

describe('createAuthContext', () => {
  it('drops an invalid token from the headers the data sources get', async () => {
    const dataSources = makeDataSources();
    const makeDataSources_ = vi.fn(() => dataSources);
    const ctx = await createAuthContext({
      authorization: sign({ id: 1 }, 'forged'),
      acceptLanguage: 'pt-br',
      makeDataSources: makeDataSources_,
    });
    expect(ctx.user).toBeUndefined();
    expect(makeDataSources_).toHaveBeenLastCalledWith({ 'accept-language': 'pt-br' });
  });

  it('keeps the token for a valid user', async () => {
    const dataSources = makeDataSources();
    const authorization = sign({ id: 1 });
    const ctx = await createAuthContext({
      authorization,
      acceptLanguage: 'pt-br',
      makeDataSources: () => dataSources,
    });
    expect(ctx.user).toEqual(ANA);
    expect(ctx.headers.Authorization).toBe(authorization);
  });
});

describe('isAdmin', () => {
  it('reads the Strapi role', () => {
    expect(isAdmin(ADMIN)).toBe(true);
    expect(isAdmin(ANA)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('falls back to ADMIN_EMAILS (case and spaces ignored)', () => {
    process.env.ADMIN_EMAILS = ' Ana@X.io , other@x.io';
    expect(isAdmin(ANA)).toBe(true);
    expect(isAdmin(BIA)).toBe(false);
  });
});

describe('requireUser / requireAdmin', () => {
  it('UNAUTHENTICATED without a user, FORBIDDEN for a non-admin', async () => {
    await expectCode(() => requireUser({}), 'UNAUTHENTICATED');
    await expectCode(() => requireAdmin({}), 'UNAUTHENTICATED');
    await expectCode(() => requireAdmin(ctxOf(ANA)), 'FORBIDDEN');
    expect(requireAdmin(ctxOf(ADMIN))).toEqual(ADMIN);
  });
});

describe('requireEventOrganizer', () => {
  it('lets an organizer of one of the communities in', async () => {
    await expect(requireEventOrganizer(ctxOf(ANA), 'meetup')).resolves.toBeUndefined();
  });

  it('lets an admin in without looking the event up', async () => {
    const dataSources = makeDataSources();
    await requireEventOrganizer(ctxOf(ADMIN, dataSources), 'meetup');
    expect(dataSources.managerIntegration.findEventWithOrganizers).not.toHaveBeenCalled();
  });

  it('refuses anyone else, an unknown event and a missing id', async () => {
    await expectCode(requireEventOrganizer(ctxOf(BIA), 'meetup'), 'FORBIDDEN');
    await expectCode(requireEventOrganizer(ctxOf(ANA, makeDataSources({ event: null })), 'x'), 'FORBIDDEN');
    await expectCode(requireEventOrganizer(ctxOf(ANA), undefined), 'FORBIDDEN');
    await expectCode(requireEventOrganizer({}, 'meetup'), 'UNAUTHENTICATED');
  });

  it('asks Strapi once per event in a request', async () => {
    const ctx = ctxOf(ANA);
    await isEventOrganizer(ctx, 'meetup');
    await isEventOrganizer(ctx, 'meetup');
    expect(ctx.dataSources.managerIntegration.findEventWithOrganizers).toHaveBeenCalledTimes(1);
  });
});

describe('requireCommunitiesOrganizer', () => {
  const community = { documentId: 'c-1', organizers: [{ documentId: 'u-ana' }] };

  it('needs at least one community for a non-admin', async () => {
    await expectCode(requireCommunitiesOrganizer(ctxOf(ANA), []), 'FORBIDDEN');
    await expect(requireCommunitiesOrganizer(ctxOf(ADMIN), [])).resolves.toBeUndefined();
  });

  it('needs every listed community', async () => {
    const dataSources = makeDataSources({ community });
    await expect(requireCommunitiesOrganizer(ctxOf(ANA, dataSources), ['c-1'])).resolves.toBeUndefined();
    dataSources.managerIntegration.findCommunityWithOrganizers.mockImplementation(async (id) =>
      (id === 'c-1' ? community : { documentId: id, organizers: [] }));
    await expectCode(requireCommunitiesOrganizer(ctxOf(ANA, dataSources), ['c-1', 'c-2']), 'FORBIDDEN');
  });
});

describe('requireOrganizerOfNewCommunities', () => {
  it('lets an organizer keep the communities the event already has', async () => {
    await expect(requireOrganizerOfNewCommunities(ctxOf(ANA), 'meetup', ['c-1'])).resolves.toBeUndefined();
  });

  it('refuses linking a community the user does not organize', async () => {
    const dataSources = makeDataSources({ community: { documentId: 'c-9', organizers: [] } });
    await expectCode(requireOrganizerOfNewCommunities(ctxOf(ANA, dataSources), 'meetup', ['c-1', 'c-9']), 'FORBIDDEN');
  });
});

describe('requireTalkOrganizer', () => {
  it('checks the event of the talk', async () => {
    const dataSources = makeDataSources({ talk: { documentId: 't-1', event: { documentId: 'ev-1' } } });
    await expect(requireTalkOrganizer(ctxOf(ANA, dataSources), 't-1')).resolves.toBeUndefined();
    await expectCode(requireTalkOrganizer(ctxOf(BIA, dataSources), 't-1'), 'FORBIDDEN');
  });
});

describe('requireAuthorOrAdmin', () => {
  it('lets the author and an admin in, nobody else', async () => {
    expect(() => requireAuthorOrAdmin(ctxOf(ANA), 'u-ana')).not.toThrow();
    expect(() => requireAuthorOrAdmin(ctxOf(ADMIN), 'u-ana')).not.toThrow();
    await expectCode(() => requireAuthorOrAdmin(ctxOf(BIA), 'u-ana'), 'FORBIDDEN');
    await expectCode(() => requireAuthorOrAdmin(ctxOf(BIA), undefined), 'FORBIDDEN');
  });
});
