import { describe, it, expect, vi } from 'vitest';
import Admin from './index';

const ADMIN = { id: 1, documentId: 'u-root', email: 'root@x.io', role: { type: 'admin' } };
const MANAGER = { id: 2, documentId: 'u-ana', email: 'ana@x.io', role: { type: 'community-manager' } };
const MEMBER = { id: 3, documentId: 'u-bia', email: 'bia@x.io', role: { type: 'authenticated' } };

const ROLES = [
  { id: 10, type: 'public' },
  { id: 11, type: 'authenticated' },
  { id: 12, type: 'community-manager' },
  { id: 13, type: 'admin' },
];

const withRole = (user, type) => ({ ...user, role: { id: ROLES.find((r) => r.type === type).id, type } });

const makeDs = (overrides = {}) => ({
  managerIntegration: {
    adminFindUsers: vi.fn().mockResolvedValue([withRole(MEMBER, 'authenticated')]),
    adminCountUsers: vi.fn().mockResolvedValue(41),
    adminCountActiveAdmins: vi.fn().mockResolvedValue(2),
    adminFindUser: vi.fn(async (id) => ({ '1': withRole(ADMIN, 'admin'), '2': withRole(MANAGER, 'community-manager'), '3': withRole(MEMBER, 'authenticated') }[id] || null)),
    adminFindRoles: vi.fn().mockResolvedValue(ROLES),
    adminSetUserRoleId: vi.fn().mockResolvedValue({ data: {} }),
    adminCreateRoleChange: vi.fn().mockResolvedValue({ data: {} }),
    adminFindRoleChanges: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    adminFindOrganizedCommunities: vi.fn().mockResolvedValue([{ documentId: 'c-1', title: 'Comunidade', slug: 'comunidade' }]),
    ...overrides,
  },
});

const codeOf = async (run) => {
  try {
    await run();
    return null;
  } catch (err) {
    return err.extensions?.code || err.message;
  }
};

const { Query, Mutation } = Admin;
const setRole = (ctx, userId, roleType) => Mutation.setUserRole(null, { userId, roleType }, ctx);

describe('adminAccess', () => {
  it('is null for an anonymous request', async () => {
    expect(await Query.adminAccess(null, {}, { dataSources: makeDs() })).toBeNull();
  });

  it('tells a community-manager which communities it manages', async () => {
    const access = await Query.adminAccess(null, {}, { user: MANAGER, dataSources: makeDs() });
    expect(access).toEqual({
      role: 'community-manager',
      isAdmin: false,
      isCommunityManager: true,
      canAccessAdmin: true,
      communities: [{ id: 'c-1', title: 'Comunidade', slug: 'comunidade' }],
    });
  });

  it('keeps a plain user out', async () => {
    const dataSources = makeDs();
    const access = await Query.adminAccess(null, {}, { user: MEMBER, dataSources });
    expect(access.canAccessAdmin).toBe(false);
    expect(dataSources.managerIntegration.adminFindOrganizedCommunities).not.toHaveBeenCalled();
  });
});

describe('adminUsers', () => {
  it('clamps the page size and trims the search', async () => {
    const dataSources = makeDs();
    const out = await Query.adminUsers(null, { search: '  ana ', page: 2, pageSize: 500 }, { user: ADMIN, dataSources });
    expect(dataSources.managerIntegration.adminFindUsers)
      .toHaveBeenCalledWith({ search: 'ana', roleType: null, page: 2, pageSize: 50 });
    expect(out.total).toBe(41);
    expect(out.items[0]).toMatchObject({ id: '3', email: 'bia@x.io', role: { type: 'authenticated', name: 'Usuário' } });
  });

  it('refuses an unknown role filter', async () => {
    expect(await codeOf(() => Query.adminUsers(null, { role: 'public' }, { user: ADMIN, dataSources: makeDs() })))
      .toBe('BAD_USER_INPUT');
  });

  it('is admin only', async () => {
    expect(await codeOf(() => Query.adminUsers(null, {}, { user: MANAGER, dataSources: makeDs() }))).toBe('FORBIDDEN');
  });
});

describe('setUserRole', () => {
  it('changes the role and records who did it', async () => {
    const dataSources = makeDs();
    const out = await setRole({ user: ADMIN, dataSources }, '3', 'community-manager');
    const ds = dataSources.managerIntegration;
    expect(ds.adminSetUserRoleId).toHaveBeenCalledWith('3', 12);
    expect(ds.adminCreateRoleChange).toHaveBeenCalledWith({
      actor: 'u-root',
      actor_email: 'root@x.io',
      target: 'u-bia',
      target_email: 'bia@x.io',
      from_role: 'authenticated',
      to_role: 'community-manager',
    });
    expect(out.id).toBe('3');
  });

  it('validates the input on the server', async () => {
    const ctx = { user: ADMIN, dataSources: makeDs() };
    expect(await codeOf(() => setRole(ctx, '3', 'public'))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => setRole(ctx, '3', 'superuser'))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => setRole(ctx, 'u-bia', 'admin'))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => setRole(ctx, '99', 'admin'))).toBe('BAD_USER_INPUT');
  });

  it('refuses an admin taking away their own admin role', async () => {
    const dataSources = makeDs();
    expect(await codeOf(() => setRole({ user: ADMIN, dataSources }, '1', 'authenticated'))).toBe('FORBIDDEN');
    expect(dataSources.managerIntegration.adminSetUserRoleId).not.toHaveBeenCalled();
  });

  it('never leaves the system without an active admin', async () => {
    const other = { id: 5, documentId: 'u-other', email: 'o@x.io', role: { type: 'admin' } };
    const dataSources = makeDs({
      adminCountActiveAdmins: vi.fn().mockResolvedValue(1),
      adminFindUser: vi.fn().mockResolvedValue(withRole({ ...ADMIN, id: 9, documentId: 'u-9' }, 'admin')),
    });
    expect(await codeOf(() => setRole({ user: other, dataSources }, '9', 'authenticated'))).toBe('FORBIDDEN');
    expect(dataSources.managerIntegration.adminSetUserRoleId).not.toHaveBeenCalled();
  });

  it('puts the role back when the change cannot be recorded', async () => {
    const dataSources = makeDs({ adminCreateRoleChange: vi.fn().mockRejectedValue(new Error('down')) });
    const err = await codeOf(() => setRole({ user: ADMIN, dataSources }, '3', 'admin'));
    expect(err).toMatch(/Nada foi alterado/);
    expect(dataSources.managerIntegration.adminSetUserRoleId.mock.calls).toEqual([['3', 13], ['3', 11]]);
  });

  it('runs changes one at a time, so two demotions cannot remove the last two admins', async () => {
    let admins = 2;
    const users = {
      1: withRole(ADMIN, 'admin'),
      5: withRole({ id: 5, documentId: 'u-5', email: 'e@x.io' }, 'admin'),
    };
    const dataSources = makeDs({
      adminCountActiveAdmins: vi.fn(async () => admins),
      adminFindUser: vi.fn(async (id) => users[id]),
      adminSetUserRoleId: vi.fn(async (id, roleId) => {
        await new Promise((r) => { setTimeout(r, 5); });
        if (roleId !== 13) admins -= 1;
        users[id] = { ...users[id], role: { id: roleId, type: ROLES.find((r) => r.id === roleId).type } };
      }),
    });
    const fifth = { ...users[5] };
    const results = await Promise.allSettled([
      setRole({ user: ADMIN, dataSources }, '5', 'authenticated'),
      setRole({ user: fifth, dataSources }, '1', 'authenticated'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(admins).toBe(1);
  });
});
