import { describe, it, expect, vi, afterEach } from 'vitest';
import { isAdmin, requireAdmin } from './index';

afterEach(() => { delete process.env.ADMIN_EMAILS; });

const ctxWith = (user, roleUser) => ({
  user,
  dataSources: { managerIntegration: { findUserWithRole: vi.fn().mockResolvedValue({ data: roleUser }) } },
});

describe('requireAdmin', () => {
  it('sem usuário: UNAUTHENTICATED', async () => {
    await expect(requireAdmin({ user: undefined })).rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
  });
  it('role admin lida com o token de integração', async () => {
    const ctx = ctxWith({ id: 1, email: 'a@x.io' }, { id: 1, role: { type: 'admin' } });
    await expect(requireAdmin(ctx)).resolves.toMatchObject({ id: 1 });
    expect(ctx.dataSources.managerIntegration.findUserWithRole).toHaveBeenCalledWith(1);
  });
  it('usuário comum: FORBIDDEN', async () => {
    const ctx = ctxWith({ id: 2, email: 'b@x.io' }, { id: 2, role: { type: 'authenticated' } });
    await expect(requireAdmin(ctx)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });
  it('usuário bloqueado não vale como admin', async () => {
    const ctx = ctxWith({ id: 3 }, { id: 3, blocked: true, role: { type: 'admin' } });
    await expect(requireAdmin(ctx)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });
  it('e-mail em ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = 'x@y.io, Admin@Hub.io';
    expect(isAdmin({ email: 'admin@hub.io ' })).toBe(true);
    await expect(requireAdmin(ctxWith({ id: 4, email: 'admin@hub.io' }))).resolves.toBeTruthy();
  });
  it('falha ao ler o papel: FORBIDDEN, sem derrubar', async () => {
    const ctx = { user: { id: 5 }, dataSources: { managerIntegration: { findUserWithRole: vi.fn().mockRejectedValue(new Error('x')) } } };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(requireAdmin(ctx)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    spy.mockRestore();
  });
});
