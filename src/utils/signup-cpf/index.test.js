import { describe, it, expect, vi } from 'vitest';
import { withCpf, saveMissingCpf, saveMissingProfile } from './index';

describe('withCpf', () => {
  const signups = [
    { name: 'Ana', email: 'Ana@X.io' },
    { name: 'Bia', email: 'bia@x.io' },
    { name: 'Caio', email: 'caio@x.io' },
    { name: 'Sem email', email: null },
  ];

  it('takes the CPF from the account, then from the Startup Weekend form, by e-mail', () => {
    const result = withCpf(
      signups,
      [{ email: 'ana@x.io', cpf: '123.456.789-09' }, { email: 'bia@x.io', cpf: null }],
      [{ email: 'BIA@x.io', cpf: '98765432100' }, { email: 'ana@x.io', cpf: '11111111111' }],
    );

    expect(result.map((s) => s.cpf)).toEqual(['12345678909', '98765432100', null, null]);
  });

  it('keeps only the digits and drops values that are not 11 digits', () => {
    const result = withCpf(
      [{ email: 'a@x.io' }, { email: 'b@x.io' }],
      [{ email: 'a@x.io', cpf: '071.234.567-8' }, { email: 'b@x.io', cpf: '071.234.567-89' }],
      [],
    );

    expect(result.map((s) => s.cpf)).toEqual([null, '07123456789']);
  });

  it('never mutates the signups', () => {
    const input = [{ email: 'ana@x.io' }];
    withCpf(input, [{ email: 'ana@x.io', cpf: '12345678909' }], []);
    expect(input[0]).toEqual({ email: 'ana@x.io' });
  });
});

describe('saveMissingCpf', () => {
  const makeDataSources = (user) => ({
    managerIntegration: {
      findUserByEmail: vi.fn().mockResolvedValue(user),
      updateUser: vi.fn().mockResolvedValue({}),
    },
  });

  it('writes the CPF, digits only, on an account that has none', async () => {
    const ds = makeDataSources({ id: 7, email: 'ana@x.io', cpf: null });
    await expect(saveMissingCpf(ds, ' Ana@X.io ', '123.456.789-09')).resolves.toBe('saved');
    expect(ds.managerIntegration.findUserByEmail).toHaveBeenCalledWith('ana@x.io');
    expect(ds.managerIntegration.updateUser).toHaveBeenCalledWith(7, { cpf: '12345678909' });
  });

  it('never overwrites a CPF the account already has', async () => {
    const ds = makeDataSources({ id: 7, email: 'ana@x.io', cpf: '98765432100' });
    await expect(saveMissingCpf(ds, 'ana@x.io', '12345678909')).resolves.toBe('kept');
    expect(ds.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('skips an invalid CPF, a missing e-mail and an e-mail without account', async () => {
    const ds = makeDataSources(null);
    await expect(saveMissingCpf(ds, 'ana@x.io', '1234')).resolves.toBe('invalid');
    await expect(saveMissingCpf(ds, '', '12345678909')).resolves.toBe('invalid');
    await expect(saveMissingCpf(ds, 'ana@x.io', '12345678909')).resolves.toBe('no-account');
    expect(ds.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    const ds = makeDataSources(null);
    ds.managerIntegration.findUserByEmail = vi.fn().mockRejectedValue(new Error('down'));
    await expect(saveMissingCpf(ds, 'ana@x.io', '12345678909')).resolves.toBe('failed');
  });
});

describe('saveMissingProfile', () => {
  const dataSourcesWith = (user) => ({
    managerIntegration: {
      findUserByEmail: vi.fn().mockResolvedValue(user),
      updateUser: vi.fn().mockResolvedValue({}),
    },
  });
  const typed = { cpf: '529.982.247-25', date_of_birth: '1990-04-07', phone: '+55 62 99999-9999', name: 'Ana Souza' };

  it('fills every field a new account lacks, in one update', async () => {
    const dataSources = dataSourcesWith({ id: 3, name: 'Ana Souza', cpf: null, date_of_birth: null, phone: null });
    const out = await saveMissingProfile(dataSources, 'Ana@X.io', typed);
    expect(dataSources.managerIntegration.findUserByEmail).toHaveBeenCalledWith('ana@x.io');
    expect(dataSources.managerIntegration.updateUser).toHaveBeenCalledWith(3, {
      cpf: '52998224725', date_of_birth: '1990-04-07', phone: '+55 62 99999-9999',
    });
    expect(out).toEqual(['cpf', 'date_of_birth', 'phone']);
  });

  it('never overwrites what an existing account already has', async () => {
    const dataSources = dataSourcesWith({ id: 1, name: 'Ana', cpf: '52998224725', date_of_birth: '1985-01-02', phone: '62988887777' });
    const out = await saveMissingProfile(dataSources, 'ana@x.io', typed);
    expect(dataSources.managerIntegration.updateUser).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('writes only the date of birth an existing account is missing', async () => {
    const dataSources = dataSourcesWith({ id: 1, name: 'Ana', cpf: '52998224725', date_of_birth: null, phone: '62988887777' });
    await saveMissingProfile(dataSources, 'ana@x.io', typed);
    expect(dataSources.managerIntegration.updateUser).toHaveBeenCalledWith(1, { date_of_birth: '1990-04-07' });
  });

  it('ignores an invalid date or CPF', async () => {
    const dataSources = dataSourcesWith({ id: 1, name: 'Ana', phone: 'x' });
    await saveMissingProfile(dataSources, 'ana@x.io', { cpf: '123', date_of_birth: '2026-02-31' });
    expect(dataSources.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('reports no-account and never throws', async () => {
    expect(await saveMissingProfile(dataSourcesWith(null), 'ana@x.io', typed)).toBe('no-account');
    const failing = dataSourcesWith(null);
    failing.managerIntegration.findUserByEmail.mockRejectedValue(new Error('down'));
    expect(await saveMissingProfile(failing, 'ana@x.io', typed)).toBe('failed');
  });
});
