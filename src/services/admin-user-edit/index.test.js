import { describe, it, expect, vi } from 'vitest';
import { checkUserEmail, normalizeUserInput, updateUserData } from './index';

// REA-63: the admin corrects a user's account data on /admin/usuarios/<id>.

const NOW = new Date('2026-11-16T12:00:00.000Z');
const ACTOR = { id: 1, documentId: 'u-root', email: 'root@x.io', role: { type: 'admin' } };

const TARGET = {
  id: 620,
  documentId: 'u-620',
  username: 'joao',
  email: 'joao@errado.com',
  name: 'João',
  phone: '62 99999-0000',
  cpf: '52998224725',
  date_of_birth: '1990-05-01',
  marketing_opt_in: false,
  role: { type: 'authenticated' },
};

const signup = (id, eventId, email) => ({ id, documentId: `s-${id}`, email, event: { id: eventId } });

const makeDeps = ({
  target = TARGET,
  emailOwners = [],
  cpfOwners = [],
  oldSignups = [signup(1, 10, TARGET.email), signup(2, 11, TARGET.email)],
  newSignups = [],
} = {}) => {
  const integration = {
    adminFindUserProfile: vi.fn().mockResolvedValue(target),
    adminFindUserIdsByEmail: vi.fn().mockResolvedValue(emailOwners),
    adminFindUserIdsByCpf: vi.fn().mockResolvedValue(cpfOwners),
    adminUpdateUserFields: vi.fn().mockResolvedValue({ data: {} }),
    adminCreateUserChange: vi.fn().mockResolvedValue({ data: {} }),
  };
  const eventando = {
    findSignupsByEmail: vi.fn(async (email) => (email === TARGET.email ? oldSignups : newSignups)),
    updateSignup: vi.fn().mockResolvedValue({ data: {} }),
  };
  return { integration, eventando };
};

const codeOf = async (run) => {
  try {
    await run();
    return null;
  } catch (err) {
    return err.extensions?.code || err.message;
  }
};

describe('normalizeUserInput', () => {
  it('keeps only what was sent, trimmed, with the e-mail in lower case and the CPF in digits', () => {
    expect(normalizeUserInput({
      name: '  João Silva ', email: ' Joao@Certo.COM ', cpf: '529.982.247-25', dateOfBirth: '1990-05-01',
      phone: ' 62 98888-0000 ', marketingOptIn: true,
    }, NOW)).toEqual({
      name: 'João Silva',
      email: 'joao@certo.com',
      cpf: '52998224725',
      date_of_birth: '1990-05-01',
      phone: '62 98888-0000',
      marketing_opt_in: true,
    });
    expect(normalizeUserInput({ name: 'Ana' }, NOW)).toEqual({ name: 'Ana' });
  });

  it('clears the CPF and the phone with an empty value', () => {
    expect(normalizeUserInput({ cpf: '', phone: '  ' }, NOW)).toEqual({ cpf: null, phone: null });
  });

  it('refuses an empty name, a bad e-mail, an invalid CPF and someone under 18', async () => {
    expect(await codeOf(() => normalizeUserInput({ name: '  ' }, NOW))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => normalizeUserInput({ email: 'joao@' }, NOW))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => normalizeUserInput({ cpf: '111.111.111-11' }, NOW))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => normalizeUserInput({ dateOfBirth: '2010-01-01' }, NOW))).toBe('BAD_USER_INPUT');
    expect(await codeOf(() => normalizeUserInput({ dateOfBirth: '' }, NOW))).toBe('BAD_USER_INPUT');
  });
});

describe('checkUserEmail', () => {
  it('says how many signups would move and which stay (same event under the new e-mail)', async () => {
    const deps = makeDeps({ newSignups: [signup(9, 11, 'joao@certo.com')] });
    expect(await checkUserEmail({ ...deps, userId: '620', email: 'Joao@Certo.com' })).toEqual({
      available: true, message: null, signupsToMove: 1, signupConflicts: 1,
    });
  });

  it('refuses an e-mail of another account', async () => {
    const deps = makeDeps({ emailOwners: [{ id: 77 }] });
    const out = await checkUserEmail({ ...deps, userId: '620', email: 'outro@x.io' });
    expect(out).toMatchObject({ available: false, message: 'Este e-mail já é de outra conta.' });
    expect(deps.eventando.findSignupsByEmail).not.toHaveBeenCalled();
  });

  it('is available for the account own e-mail (nothing to move)', async () => {
    const deps = makeDeps({ emailOwners: [{ id: 620 }] });
    expect(await checkUserEmail({ ...deps, userId: '620', email: TARGET.email }))
      .toEqual({ available: true, message: null, signupsToMove: 0, signupConflicts: 0 });
  });
});

describe('updateUserData', () => {
  const clear = vi.fn();
  const run = (deps, input, moveSignups = true) => updateUserData({
    ...deps, actor: ACTOR, userId: '620', input, moveSignups, now: NOW, clearCache: clear,
  });

  it('changes the e-mail, ends the sessions, moves the signups and records it without values', async () => {
    const deps = makeDeps({ newSignups: [signup(9, 11, 'joao@certo.com')] });
    const out = await run(deps, { email: 'joao@certo.com', name: 'João' });

    expect(deps.integration.adminUpdateUserFields).toHaveBeenCalledWith('620', {
      email: 'joao@certo.com',
      sessions_revoked_at: NOW.toISOString(),
    });
    expect(deps.eventando.updateSignup.mock.calls).toEqual([['s-1', { email: 'joao@certo.com' }]]);
    expect(out).toMatchObject({
      changedFields: ['email'], signupsMoved: 1, signupsKept: 1, signupsFailed: 0, sessionsRevoked: true,
    });
    expect(deps.integration.adminCreateUserChange).toHaveBeenCalledWith({
      actor: 'u-root', target: 'u-620', fields: ['email'], signups_moved: 1, sessions_revoked: true,
    });
    expect(clear).toHaveBeenCalled();
  });

  it('leaves the signups where they are when asked to', async () => {
    const deps = makeDeps();
    const out = await run(deps, { email: 'joao@certo.com' }, false);
    expect(deps.eventando.updateSignup).not.toHaveBeenCalled();
    expect(out).toMatchObject({ signupsMoved: 0, signupsKept: 2 });
  });

  it('counts a signup Eventando refused and keeps going', async () => {
    const deps = makeDeps();
    deps.eventando.updateSignup.mockRejectedValueOnce(new Error('down'));
    const out = await run(deps, { email: 'joao@certo.com' });
    expect(out).toMatchObject({ signupsMoved: 1, signupsFailed: 1 });
  });

  it('refuses an e-mail or a CPF of another account, before writing anything', async () => {
    let deps = makeDeps({ emailOwners: [{ id: 77 }] });
    expect(await codeOf(() => run(deps, { email: 'outro@x.io' }))).toBe('BAD_USER_INPUT');
    expect(deps.integration.adminUpdateUserFields).not.toHaveBeenCalled();

    deps = makeDeps({ cpfOwners: [{ id: 77 }] });
    expect(await codeOf(() => run(deps, { cpf: '39053344705' }))).toBe('BAD_USER_INPUT');
    expect(deps.integration.adminUpdateUserFields).not.toHaveBeenCalled();
  });

  it('changes the other fields without ending sessions nor touching signups', async () => {
    const deps = makeDeps({ cpfOwners: [{ id: 620 }] });
    const out = await run(deps, {
      cpf: '390.533.447-05', dateOfBirth: '1991-02-03', phone: '62 98888-0000', marketingOptIn: true,
    });
    expect(deps.integration.adminUpdateUserFields).toHaveBeenCalledWith('620', {
      cpf: '39053344705', date_of_birth: '1991-02-03', phone: '62 98888-0000', marketing_opt_in: true,
    });
    expect(deps.eventando.findSignupsByEmail).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      changedFields: ['cpf', 'date_of_birth', 'phone', 'marketing_opt_in'], sessionsRevoked: false, signupsMoved: 0,
    });
  });

  it('writes nothing when nothing changed', async () => {
    const deps = makeDeps();
    const out = await run(deps, { name: 'João', email: 'JOAO@errado.com', cpf: '529.982.247-25' });
    expect(out).toMatchObject({ changedFields: [], message: 'Nada para alterar.' });
    expect(deps.integration.adminUpdateUserFields).not.toHaveBeenCalled();
    expect(deps.integration.adminCreateUserChange).not.toHaveBeenCalled();
  });

  it('refuses an unknown user', async () => {
    const deps = makeDeps({ target: null });
    expect(await codeOf(() => run(deps, { name: 'Ana' }))).toBe('BAD_USER_INPUT');
  });

  it('never logs the values', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await run(makeDeps(), { email: 'joao@certo.com', cpf: '390.533.447-05' });
    const logged = info.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/certo|errado|39053344705|390\.533/);
    expect(logged).toMatch(/620/);
    info.mockRestore();
  });
});
