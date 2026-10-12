import { GraphQLError } from 'graphql';
import {
  ROLES,
  canAccessAdmin,
  forbiddenError,
  isAdmin,
  isCommunityManager,
  requireAdmin,
  roleOf,
} from '../../utils/auth';

// Users and roles of the Hub admin (REA-10). Everything but adminAccess is admin only and
// runs with the integration token after requireAdmin.

// Order shown in the admin screen; also the only types setUserRole accepts.
export const ASSIGNABLE_ROLES = [
  { type: ROLES.AUTHENTICATED, name: 'Usuário' },
  { type: ROLES.COMMUNITY_MANAGER, name: 'Community Manager' },
  { type: ROLES.ADMIN, name: 'Admin' },
];
const ROLE_NAMES = new Map(ASSIGNABLE_ROLES.map((role) => [role.type, role.name]));

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_SEARCH = 100;

const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

const pageArgs = ({ page, pageSize }) => {
  const p = Number.isInteger(page) && page > 0 ? page : 1;
  const size = Number.isInteger(pageSize) && pageSize > 0
    ? Math.min(pageSize, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  return { page: p, pageSize: size };
};

const userIdArg = (value) => {
  const id = String(value ?? '').trim();
  if (!/^\d+$/.test(id)) throw badInput('Usuário inválido.');
  return id;
};

const roleTypeArg = (value) => {
  if (!ROLE_NAMES.has(value)) throw badInput('Role inválida.');
  return value;
};

const toCommunity = (community) => ({
  id: community.documentId,
  title: community.title ?? null,
  slug: community.slug ?? null,
});

const toUser = (user) => ({
  id: String(user.id),
  documentId: user.documentId ?? null,
  username: user.username ?? null,
  email: user.email ?? null,
  name: user.name ?? null,
  blocked: Boolean(user.blocked),
  role: user.role?.type
    ? { type: user.role.type, name: ROLE_NAMES.get(user.role.type) || user.role.name || user.role.type }
    : null,
  communities: (user.communities || []).filter((c) => c?.documentId).map(toCommunity),
});

const toRoleChange = (change) => ({
  id: String(change.documentId || change.id),
  actorId: change.actor?.id != null ? String(change.actor.id) : null,
  actorEmail: change.actor_email ?? null,
  targetId: change.target?.id != null ? String(change.target.id) : null,
  targetEmail: change.target_email ?? null,
  fromRole: change.from_role ?? null,
  toRole: change.to_role,
  createdAt: change.createdAt ?? null,
});

// Role changes run one at a time in this process, so two admins demoting each other at the
// same moment cannot both pass the "at least one admin" check. (The bff runs as one process.)
let roleChangeQueue = Promise.resolve();
const serialized = (task) => {
  const run = roleChangeQueue.then(task, task);
  roleChangeQueue = run.catch(() => {});
  return run;
};

const setUserRole = async (ctx, userId, roleType) => {
  const actor = ctx.user;
  const ds = ctx.dataSources.managerIntegration;

  if (String(actor.id) === userId && roleType !== ROLES.ADMIN) {
    throw forbiddenError('Você não pode tirar o seu próprio acesso de admin. Peça a outro admin.');
  }

  const target = await ds.adminFindUser(userId);
  if (!target) throw badInput('Usuário não encontrado.');
  const fromRole = target.role?.type || null;
  if (fromRole === roleType) return toUser(target);

  if (fromRole === ROLES.ADMIN && !target.blocked) {
    const admins = await ds.adminCountActiveAdmins();
    if (admins <= 1) {
      throw forbiddenError('O sistema precisa de pelo menos um admin ativo. Promova outra pessoa antes.');
    }
  }

  const roles = await ds.adminFindRoles();
  const role = roles.find((r) => r.type === roleType);
  if (!role) throw new Error(`A role "${roleType}" não existe no Strapi do Hub.`);
  const previousRoleId = target.role?.id ?? roles.find((r) => r.type === fromRole)?.id ?? null;

  await ds.adminSetUserRoleId(userId, role.id);

  // The change only stands once it is recorded: if the record fails, the role goes back.
  try {
    await ds.adminCreateRoleChange({
      actor: actor.documentId,
      actor_email: actor.email || null,
      target: target.documentId,
      target_email: target.email || null,
      from_role: fromRole,
      to_role: roleType,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[admin] Falha ao registrar a troca de role; desfazendo:', err.message);
    if (previousRoleId != null) await ds.adminSetUserRoleId(userId, previousRoleId);
    throw new Error('Não foi possível registrar a troca de role. Nada foi alterado.');
  }

  // eslint-disable-next-line no-console
  console.info(`[admin] role do usuário ${userId}: ${fromRole} -> ${roleType} (por ${actor.id})`);

  const updated = await ds.adminFindUser(userId);
  return toUser(updated || { ...target, role: { type: roleType } });
};

const Admin = {
  Query: {
    adminAccess: async (_, __, ctx) => {
      const { user } = ctx;
      if (!user) return null;
      const manager = isCommunityManager(user);
      const communities = manager
        ? await ctx.dataSources.managerIntegration.adminFindOrganizedCommunities(user.id)
        : [];
      return {
        role: roleOf(user),
        isAdmin: isAdmin(user),
        isCommunityManager: manager,
        canAccessAdmin: canAccessAdmin(user),
        communities: communities.filter((c) => c?.documentId).map(toCommunity),
      };
    },

    adminUsers: async (_, args, ctx) => {
      requireAdmin(ctx);
      const search = typeof args.search === 'string' ? args.search.trim().slice(0, MAX_SEARCH) : '';
      const roleType = args.role ? roleTypeArg(args.role) : null;
      const { page, pageSize } = pageArgs(args);
      const ds = ctx.dataSources.managerIntegration;
      const [users, total] = await Promise.all([
        ds.adminFindUsers({ search, roleType, page, pageSize }),
        ds.adminCountUsers({ search, roleType }),
      ]);
      return { items: users.map(toUser), total, page, pageSize };
    },

    adminRoles: (_, __, ctx) => {
      requireAdmin(ctx);
      return ASSIGNABLE_ROLES;
    },

    roleChanges: async (_, args, ctx) => {
      requireAdmin(ctx);
      const targetId = args.userId != null ? userIdArg(args.userId) : null;
      const { page, pageSize } = pageArgs(args);
      const { data, total } = await ctx.dataSources.managerIntegration
        .adminFindRoleChanges({ targetId, page, pageSize });
      return { items: data.map(toRoleChange), total, page, pageSize };
    },
  },

  Mutation: {
    setUserRole: async (_, args, ctx) => {
      requireAdmin(ctx);
      const userId = userIdArg(args.userId);
      const roleType = roleTypeArg(args.roleType);
      return serialized(() => setUserRole(ctx, userId, roleType));
    },
  },
};

export default Admin;
