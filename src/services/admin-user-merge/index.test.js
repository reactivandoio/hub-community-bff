import { describe, it, expect, vi } from 'vitest';
import {
  loadDuplicateGroups, mergeAccounts, previewMerge, suggestKeep, toMergeUser,
} from './index';

// REA-96: joining two accounts of the same person.

const ACTOR = { id: 1, documentId: 'u-root', email: 'root@x.io', role: { type: 'admin' } };

// As the backend's GET /user-merges/duplicates describes an account.
const backendUser = (id, email, over = {}) => ({
  id,
  documentId: `u-${id}`,
  name: 'Wagdson',
  email,
  createdAt: '2026-11-13T03:31:23.335Z',
  blocked: false,
  role: 'authenticated',
  lastLoginAt: null,
  links: [],
  emailRows: { certificates: 0, requests: 0 },
  ...over,
});

const signup = (id, eventId, email) => ({ id, documentId: `s-${id}`, email, event: { id: eventId } });

describe('toMergeUser', () => {
  it('sums the links that count, plus the signups; certificates by account or by e-mail', () => {
    const user = toMergeUser(backendUser(621, 'w.sd@x.io', {
      role: 'event-manager',
      links: [
        { key: 'api::certificate.certificate.users_permissions_user', label: 'Certificados', count: 2, counts: true },
        { key: 'plugin::users-permissions.user.speaker', label: 'Perfil de palestrante', count: 1, counts: true },
        { key: 'api::analytics-event.analytics-event.users_permissions_user', label: 'Eventos de navegação', count: 40, counts: false },
      ],
      emailRows: { certificates: 3, requests: 0 },
    }), 1);
    expect(user).toMatchObject({
      id: '621', isAdmin: false, isManager: true, signups: 1, certificates: 3, links: 4,
    });
    expect(user.linkDetails).toHaveLength(3);
  });
});

describe('suggestKeep', () => {
  const u = (id, links, lastLogin = null) => ({ id, links, last_login_at: lastLogin });

  it('suggests the account with more links', () => {
    expect(suggestKeep([u('620', 1), u('621', 3)])).toEqual({ userId: '621', reason: 'Tem mais vínculos.' });
  });

  it('on a tie, the latest login', () => {
    expect(suggestKeep([u('620', 1), u('621', 1, '2026-11-16T10:29:32.516Z')]))
      .toEqual({ userId: '621', reason: 'Mesmos vínculos; entrou por último.' });
  });

  it('still tied: none, the admin decides', () => {
    expect(suggestKeep([u('363', 1), u('419', 1)])).toBeNull();
    expect(suggestKeep([u('1', 2, '2026-01-01'), u('2', 2, '2026-01-01'), u('3', 0)])).toBeNull();
    expect(suggestKeep([u('1', 2)])).toBeNull();
  });
});

describe('loadDuplicateGroups', () => {
  it('adds the Eventando signups of each e-mail and the suggestion, never the CPF', async () => {
    const integration = {
      adminFindDuplicateCpfGroups: vi.fn().mockResolvedValue({
        total: 1,
        groups: [{
          ids: [620, 621],
          users: [
            backendUser(620, 'wagdson.ope@x.io'),
            backendUser(621, 'wagdson.sd@x.io', {
              lastLoginAt: '2026-11-16T10:29:32.516Z',
              links: [{ key: 'plugin::users-permissions.user.speaker', label: 'Perfil de palestrante', count: 1, counts: true }],
            }),
          ],
        }],
      }),
    };
    const eventando = {
      findSignupsByEmail: vi.fn(async (email) => (email === 'wagdson.ope@x.io' ? [signup(927, 25, email)] : [])),
    };
    const out = await loadDuplicateGroups({ integration, eventando });
    expect(out.total).toBe(1);
    expect(out.groups[0]).toMatchObject({
      id: '620-621',
      suggestedKeepId: '621',
      suggestionReason: 'Mesmos vínculos; entrou por último.',
    });
    expect(out.groups[0].users.map((user) => [user.id, user.signups, user.links])).toEqual([['620', 1, 1], ['621', 0, 1]]);
    expect(JSON.stringify(out)).not.toMatch(/cpf/i);
  });

  it('counts no signups when Eventando cannot be read, and still lists the group', async () => {
    const integration = {
      adminFindDuplicateCpfGroups: vi.fn().mockResolvedValue({ total: 1, groups: [{ ids: [1, 2], users: [backendUser(1, 'a@x.io'), backendUser(2, 'b@x.io')] }] }),
    };
    const eventando = { findSignupsByEmail: vi.fn().mockRejectedValue(new Error('down')) };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await loadDuplicateGroups({ integration, eventando });
    spy.mockRestore();
    expect(out.groups[0]).toMatchObject({ suggestedKeepId: null, suggestionReason: 'Empate: escolha a conta que fica.' });
  });
});

const PREVIEW = {
  keep: { id: 621, documentId: 'u-621', email: 'wagdson.sd@x.io', name: 'Wagdson', role: { type: 'authenticated' } },
  drop: { id: 620, documentId: 'u-620', email: 'Wagdson.Ope@x.io', name: 'Wagdson', role: { type: 'authenticated' } },
  blockers: [],
  links: [{ key: 'api::certificate.certificate.users_permissions_user', label: 'Certificados', count: 1, counts: true }],
  emailRows: { certificates: 1, requests: 0 },
  fill: ['phone'],
};

const MERGED = {
  keepId: 621,
  dropId: 620,
  keepDocumentId: 'u-621',
  dropDocumentId: 'u-620',
  keepEmail: 'wagdson.sd@x.io',
  dropEmail: 'wagdson.ope@x.io',
  links: [{ key: 'api::certificate.certificate.users_permissions_user', label: 'Certificados', count: 1, moved: 1, kept: 0 }],
  emailRows: { certificates: 1, requests: 0 },
  filled: ['phone'],
};

const mergeDeps = ({ preview = PREVIEW, dropSignups, keepSignups = [] } = {}) => {
  const oldSignups = dropSignups ?? [signup(927, 25, 'wagdson.ope@x.io'), signup(928, 26, 'wagdson.ope@x.io')];
  return {
    integration: {
      adminPreviewUserMerge: vi.fn().mockResolvedValue(preview),
      adminMergeUsers: vi.fn().mockResolvedValue(MERGED),
      adminCreateUserChange: vi.fn().mockResolvedValue({}),
    },
    eventando: {
      findSignupsByEmail: vi.fn(async (email) => (email === 'wagdson.ope@x.io' ? oldSignups : keepSignups)),
      updateSignup: vi.fn().mockResolvedValue({}),
    },
    clearCache: vi.fn(),
  };
};

describe('previewMerge', () => {
  it('adds the Eventando plan to what the backend says moves', async () => {
    const deps = mergeDeps({ keepSignups: [signup(5, 26, 'wagdson.sd@x.io')] });
    const out = await previewMerge({ ...deps, actor: ACTOR, keepId: '621', dropId: '620' });
    expect(deps.integration.adminPreviewUserMerge).toHaveBeenCalledWith({ keepId: 621, dropId: 620, actorId: 1 });
    expect(out).toMatchObject({
      keep: { id: '621', email: 'wagdson.sd@x.io' },
      drop: { id: '620' },
      canMerge: true,
      blockers: [],
      links: [{ label: 'Certificados', count: 1 }],
      certificatesByEmail: 1,
      filledFields: ['phone'],
      signupsToMove: 1,
      signupConflicts: 1,
    });
    expect(deps.integration.adminMergeUsers).not.toHaveBeenCalled();
  });

  it('shows the blockers and plans nothing', async () => {
    const deps = mergeDeps({ preview: { ...PREVIEW, blockers: ['As duas contas têm CPFs diferentes.'] } });
    const out = await previewMerge({ ...deps, actor: ACTOR, keepId: '621', dropId: '620' });
    expect(out).toMatchObject({ canMerge: false, blockers: ['As duas contas têm CPFs diferentes.'], signupsToMove: 0 });
    expect(deps.eventando.findSignupsByEmail).not.toHaveBeenCalled();
  });

  it('refuses the same account twice', async () => {
    const deps = mergeDeps();
    await expect(previewMerge({ ...deps, actor: ACTOR, keepId: '7', dropId: '7' })).rejects.toThrow('Escolha duas contas diferentes.');
  });
});

describe('mergeAccounts', () => {
  it('joins in the backend, moves the signups to the kept e-mail and records it without personal data', async () => {
    const deps = mergeDeps({ keepSignups: [signup(5, 26, 'wagdson.sd@x.io')] });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const out = await mergeAccounts({ ...deps, actor: ACTOR, keepId: '621', dropId: '620' });
    const logged = info.mock.calls.map((call) => call.join(' ')).join('\n');
    info.mockRestore();

    expect(deps.integration.adminMergeUsers).toHaveBeenCalledWith({ keepId: 621, dropId: 620, actorId: 1 });
    expect(deps.eventando.updateSignup).toHaveBeenCalledTimes(1);
    expect(deps.eventando.updateSignup).toHaveBeenCalledWith('s-927', { email: 'wagdson.sd@x.io' });
    expect(deps.clearCache).toHaveBeenCalled();
    expect(out).toMatchObject({
      keepUserId: '621', signupsMoved: 1, signupsKept: 1, signupsFailed: 0, recorded: true, filledFields: ['phone'],
      linksMoved: [{ label: 'Certificados', count: 1 }],
    });
    expect(out.message).toMatch(/Contas juntadas/);

    const record = deps.integration.adminCreateUserChange.mock.calls[0][0];
    expect(record).toEqual({
      kind: 'merge',
      actor: 'u-root',
      target: 'u-621',
      source: 'u-620',
      fields: ['phone'],
      signups_moved: 1,
      sessions_revoked: true,
      moved: {
        links: { 'api::certificate.certificate.users_permissions_user': 1 },
        certificates_by_email: 1,
        requests_by_email: 0,
        signups_kept: 1,
        signups_failed: 0,
      },
    });
    expect(JSON.stringify(record)).not.toMatch(/@/);
    expect(logged).not.toMatch(/@/);
  });

  it('refuses to drop the admin doing it, before asking the backend', async () => {
    const deps = mergeDeps();
    await expect(mergeAccounts({ ...deps, actor: ACTOR, keepId: '621', dropId: '1' }))
      .rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(deps.integration.adminPreviewUserMerge).not.toHaveBeenCalled();
  });

  it('refuses what the backend refuses, and joins nothing', async () => {
    const deps = mergeDeps({ preview: { ...PREVIEW, blockers: ['A conta descartada é Admin.'] } });
    await expect(mergeAccounts({ ...deps, actor: ACTOR, keepId: '621', dropId: '620' }))
      .rejects.toThrow('A conta descartada é Admin.');
    expect(deps.integration.adminMergeUsers).not.toHaveBeenCalled();
    expect(deps.eventando.updateSignup).not.toHaveBeenCalled();
  });

  it('turns a refusal of the merge call into BAD_USER_INPUT', async () => {
    const deps = mergeDeps();
    const refusal = Object.assign(new Error('A conta descartada já foi juntada a outra.'), { status: 400 });
    deps.integration.adminMergeUsers.mockRejectedValue(refusal);
    await expect(mergeAccounts({ ...deps, actor: ACTOR, keepId: '621', dropId: '620' }))
      .rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
  });

  it('keeps going when a signup cannot move, and says so', async () => {
    const deps = mergeDeps();
    deps.eventando.updateSignup.mockRejectedValueOnce(new Error('nope'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const out = await mergeAccounts({ ...deps, actor: ACTOR, keepId: '621', dropId: '620' });
    error.mockRestore();
    info.mockRestore();
    expect(out).toMatchObject({ signupsMoved: 1, signupsFailed: 1 });
    expect(out.message).toMatch(/não puderam ser movidas/);
  });

  it('warns when the record fails, after joining', async () => {
    const deps = mergeDeps();
    deps.integration.adminCreateUserChange.mockRejectedValue(new Error('down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const out = await mergeAccounts({ ...deps, actor: ACTOR, keepId: '621', dropId: '620' });
    error.mockRestore();
    info.mockRestore();
    expect(out.recorded).toBe(false);
    expect(out.message).toMatch(/registro da junção falhou/);
  });
});
