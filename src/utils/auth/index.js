import { GraphQLError } from 'graphql';

// Minimal admin check for the REA-6 operations (coupons and payments), with the same
// names as utils/auth of PR #33 (Fase 1 LGPD), which replaces this file when it lands.
//
// The request user is the one Strapi returned for the request token (/users/me in
// src/index.js). Admin: the "admin" role of users-permissions in the Hub Strapi —
// read with the integration token, since /users/me does not bring the role — or an
// e-mail in ADMIN_EMAILS (comma separated).

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

const loadRole = async (ctx, user) => {
  if (user.role || !user.id || !ctx.dataSources?.managerIntegration?.findUserWithRole) return user;
  if (!ctx.adminUser) {
    ctx.adminUser = ctx.dataSources.managerIntegration
      .findUserWithRole(user.id)
      .then((response) => {
        const found = response?.data;
        return found && String(found.id) === String(user.id) && !found.blocked ? found : user;
      })
      .catch((err) => {
        console.error('[auth] Falha ao carregar o papel do usuário:', err.message);
        return user;
      });
  }
  return ctx.adminUser;
};

export const requireAdmin = async (ctx) => {
  const user = requireUser(ctx);
  if (isAdmin(user)) return user;
  const withRole = await loadRole(ctx, user);
  if (!isAdmin(withRole)) throw forbiddenError();
  return withRole;
};
