import { describe, it, expect, vi } from 'vitest';
import { planCpfRows, applyCpfRow, updateCpfs } from './index';

describe('planCpfRows', () => {
  it('normalises e-mail and CPF and drops exact repeats', () => {
    const { valid, skipped } = planCpfRows([
      { email: ' Ana@X.io ', cpf: '123.456.789-09', name: 'Ana' },
      { email: 'ana@x.io', cpf: '12345678909' },
    ]);
    expect(valid).toEqual([{ email: 'ana@x.io', cpf: '12345678909', name: 'Ana' }]);
    expect(skipped).toEqual([]);
  });

  it('skips invalid rows and e-mails that come with two different CPFs', () => {
    const { valid, skipped } = planCpfRows([
      { email: 'a@x.io', cpf: '1234' },
      { email: '', cpf: '12345678909' },
      { email: 'b@x.io', cpf: '11111111111' },
      { email: 'b@x.io', cpf: '22222222222' },
      { email: 'c@x.io', cpf: '33333333333' },
    ]);
    expect(valid).toEqual([{ email: 'c@x.io', cpf: '33333333333', name: null }]);
    expect(skipped).toEqual([
      { email: 'a@x.io', cpf: '1234', status: 'INVALID' },
      { email: '', cpf: '12345678909', status: 'INVALID' },
      { email: 'b@x.io', cpf: '11111111111 / 22222222222', status: 'CONFLICT' },
    ]);
  });
});

describe('applyCpfRow', () => {
  const ds = (user, { created } = {}) => ({
    managerIntegration: {
      findUserByEmail: vi.fn()
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(created || null),
      updateUser: vi.fn().mockResolvedValue({}),
      accountSetup: vi.fn().mockResolvedValue({ created: true, token: 't' }),
    },
  });
  const row = { email: 'ana@x.io', cpf: '12345678909', name: 'Ana' };

  it('saves the CPF on an account that has none', async () => {
    const d = ds({ id: 1, cpf: null });
    await expect(applyCpfRow(d, row)).resolves.toBe('SAVED');
    expect(d.managerIntegration.updateUser).toHaveBeenCalledWith(1, { cpf: '12345678909' });
  });

  it('leaves an account with the same CPF alone', async () => {
    const d = ds({ id: 1, cpf: '123.456.789-09' });
    await expect(applyCpfRow(d, row)).resolves.toBe('UNCHANGED');
    expect(d.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('never overwrites a different CPF', async () => {
    const d = ds({ id: 1, cpf: '98765432100' });
    await expect(applyCpfRow(d, row)).resolves.toBe('DIFFERENT');
    expect(d.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('creates the account (no e-mail) when there is none, then saves', async () => {
    const d = ds(null, { created: { id: 9, cpf: null } });
    await expect(applyCpfRow(d, row)).resolves.toBe('CREATED');
    expect(d.managerIntegration.accountSetup).toHaveBeenCalledWith({ email: 'ana@x.io', name: 'Ana' });
    expect(d.managerIntegration.updateUser).toHaveBeenCalledWith(9, { cpf: '12345678909' });
  });

  it('reports a failure instead of throwing', async () => {
    const d = ds({ id: 1, cpf: null });
    d.managerIntegration.updateUser.mockRejectedValueOnce(new Error('down'));
    await expect(applyCpfRow(d, row)).resolves.toBe('FAILED');
  });
});

describe('updateCpfs', () => {
  it('returns one item per row, with the counts', async () => {
    const d = {
      managerIntegration: {
        findUserByEmail: vi.fn().mockImplementation(async (email) =>
          (email === 'a@x.io' ? { id: 1, cpf: null } : { id: 2, cpf: '22222222222' })),
        updateUser: vi.fn().mockResolvedValue({}),
        accountSetup: vi.fn(),
      },
    };
    const out = await updateCpfs(d, [
      { email: 'a@x.io', cpf: '11111111111' },
      { email: 'b@x.io', cpf: '22222222222' },
      { email: 'c@x.io', cpf: 'x' },
    ]);
    expect(out.items).toEqual([
      { email: 'a@x.io', cpf: '11111111111', status: 'SAVED', detail: null },
      { email: 'b@x.io', cpf: '22222222222', status: 'UNCHANGED', detail: null },
      { email: 'c@x.io', cpf: 'x', status: 'INVALID', detail: null },
    ]);
    expect(out).toMatchObject({ saved: 1, created: 0, unchanged: 1, different: 0, skipped: 1, failed: 0 });
  });

  it('tells which step failed and why', async () => {
    const d = {
      managerIntegration: {
        findUserByEmail: vi.fn().mockResolvedValue(null),
        accountSetup: vi.fn().mockRejectedValue(new Error('Forbidden')),
        updateUser: vi.fn(),
      },
    };
    const out = await updateCpfs(d, [{ email: 'a@x.io', cpf: '11111111111' }]);
    expect(out.items[0]).toEqual({
      email: 'a@x.io', cpf: '11111111111', status: 'FAILED', detail: 'criar conta: Forbidden',
    });
  });
});
