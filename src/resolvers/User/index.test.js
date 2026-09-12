import { describe, it, expect, vi } from 'vitest';
import User from './index';

const ctx = () => {
  const updateUser = vi.fn(async (id, data) => ({ data: { id, ...data } }));
  return {
    user: { id: 9, documentId: 'u9' },
    dataSources: {
      managerAuthenticated: { updateUser },
      managerIntegration: { findSpeakers: vi.fn(), updateSpeaker: vi.fn() },
    },
  };
};

describe('updateProfile', () => {
  it('stores the CPF as digits only and the date of birth', async () => {
    const c = ctx();
    await User.Mutation.updateProfile(null, { input: { cpf: '529.982.247-25', date_of_birth: '1990-05-17' } }, c);
    expect(c.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, {
      cpf: '52998224725',
      date_of_birth: '1990-05-17',
    });
  });

  it('rejects an invalid CPF without touching the user', async () => {
    const c = ctx();
    await expect(
      User.Mutation.updateProfile(null, { input: { cpf: '111.111.111-11' } }, c),
    ).rejects.toThrow(/CPF inválido/);
    expect(c.dataSources.managerAuthenticated.updateUser).not.toHaveBeenCalled();
  });

  it('rejects a malformed date of birth', async () => {
    const c = ctx();
    await expect(
      User.Mutation.updateProfile(null, { input: { date_of_birth: '17/05/1990' } }, c),
    ).rejects.toThrow(/Data de nascimento inválida/);
    expect(c.dataSources.managerAuthenticated.updateUser).not.toHaveBeenCalled();
  });

  it('leaves CPF and date of birth alone when they are not in the input', async () => {
    const c = ctx();
    await User.Mutation.updateProfile(null, { input: { name: 'Ana' } }, c);
    expect(c.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, { name: 'Ana' });
  });
});

describe('me', () => {
  it('returns the authenticated user fresh from Strapi (not the per-process cache)', async () => {
    const fetchMe = vi.fn().mockResolvedValue({ data: { id: 9, name: 'Ana', cpf: '52998224725' } });
    const out = await User.Query.me(null, {}, {
      user: { id: 9, name: 'stale' },
      dataSources: { managerAuthenticated: { fetchMe } },
    });
    expect(out).toEqual({ id: 9, name: 'Ana', cpf: '52998224725' });
    expect(fetchMe).toHaveBeenCalledTimes(1);
  });

  it('returns null when not authenticated', async () => {
    const fetchMe = vi.fn();
    const context = { user: undefined, dataSources: { managerAuthenticated: { fetchMe } } };
    expect(await User.Query.me(null, {}, context)).toBeNull();
    expect(fetchMe).not.toHaveBeenCalled();
  });
});
