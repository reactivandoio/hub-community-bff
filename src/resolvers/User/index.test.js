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
    await User.Mutation.updateProfile(null, { input: { cpf: '529.982.247-25', date_of_birth: '1990-05-17', adult_declaration: true } }, c);
    expect(c.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, {
      cpf: '52998224725',
      date_of_birth: '1990-05-17',
      adult_declaration: true,
    });
  });

  it('REA-36: refuses a date of birth under 18', async () => {
    const c = ctx();
    await expect(
      User.Mutation.updateProfile(null, { input: { date_of_birth: '2015-01-01', adult_declaration: true } }, c),
    ).rejects.toThrow('É preciso ter 18 anos ou mais.');
    expect(c.dataSources.managerAuthenticated.updateUser).not.toHaveBeenCalled();
  });

  it('REA-36: asks for the 18+ declaration with the date when the account never declared it', async () => {
    const c = ctx();
    await expect(
      User.Mutation.updateProfile(null, { input: { date_of_birth: '1990-05-17' } }, c),
    ).rejects.toThrow('Confirme que você tem 18 anos ou mais.');
    const declared = { ...ctx(), user: { id: 9, documentId: 'u9', adult_declaration: true } };
    await User.Mutation.updateProfile(null, { input: { date_of_birth: '1990-05-17' } }, declared);
    expect(declared.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, { date_of_birth: '1990-05-17' });
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
    ).rejects.toThrow(/Informe uma data de nascimento válida/);
    expect(c.dataSources.managerAuthenticated.updateUser).not.toHaveBeenCalled();
  });

  it('leaves CPF and date of birth alone when they are not in the input', async () => {
    const c = ctx();
    await User.Mutation.updateProfile(null, { input: { name: 'Ana' } }, c);
    expect(c.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, { name: 'Ana' });
  });

  it('REA-29/REA-26: records the "quero receber novidades" tick and ignores false', async () => {
    const c = ctx();
    await User.Mutation.updateProfile(null, { input: { phone: '+55 62 99999-0000', marketing_opt_in: true } }, c);
    expect(c.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, {
      phone: '+55 62 99999-0000', marketing_opt_in: true,
    });
    const off = ctx();
    await User.Mutation.updateProfile(null, { input: { phone: '+55 62 99999-0000', marketing_opt_in: false } }, off);
    expect(off.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, { phone: '+55 62 99999-0000' });
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
