import { describe, it, expect, vi } from 'vitest';
import Analytics from './index';

const rawSignups = [
  { id: 1, name: 'ana-4f2k', email: 'ana@x.io', createdAt: '2026-09-01T10:00:00.000Z' },
  { id: 2, name: 'Bia Lima', email: 'bia@x.io', createdAt: '2026-09-02T10:00:00.000Z' },
];

const makeDataSources = ({ users = [], usersError = null, swForms = [] } = {}) => ({
  manager: { findEvents: vi.fn().mockResolvedValue({ data: [] }) },
  eventandoIntegration: {
    findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42, name: 'Ev', slug: 'ev', uuid: 'u', products: [] }] }),
    findSignupsByEvent: vi.fn().mockResolvedValue(rawSignups),
  },
  managerIntegration: {
    findParticipants: vi.fn().mockResolvedValue({ meta: { pagination: { total: 0 } } }),
    findUsersByEmails: usersError
      ? vi.fn().mockRejectedValue(usersError)
      : vi.fn().mockResolvedValue(users),
    findSwFormsByEmails: vi.fn().mockResolvedValue(swForms),
  },
});

describe('eventAnalytics.all_signups', () => {
  it('uses the HubCommunity user name when the account has one', async () => {
    const dataSources = makeDataSources({ users: [{ email: 'ana@x.io', name: 'Ana Souza' }] });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources });
    expect(out.all_signups.map((s) => s.name)).toEqual(['Ana Souza', 'Bia Lima']);
    expect(dataSources.managerIntegration.findUsersByEmails).toHaveBeenCalledWith(['ana@x.io', 'bia@x.io']);
  });

  it('keeps the signup names when the user lookup fails', async () => {
    const dataSources = makeDataSources({ usersError: new Error('strapi down') });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources });
    expect(out.all_signups.map((s) => s.name)).toEqual(['ana-4f2k', 'Bia Lima']);
  });

  it('carries the CPF from the account, or from the Startup Weekend form', async () => {
    const dataSources = makeDataSources({
      users: [{ email: 'ana@x.io', name: 'Ana Souza', cpf: '123.456.789-09' }],
      swForms: [{ email: 'bia@x.io', cpf: '98765432100' }],
    });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources });
    expect(out.all_signups.map((s) => s.cpf)).toEqual(['12345678909', '98765432100']);
  });

  it('still answers without CPFs when the sw-form lookup fails', async () => {
    const dataSources = makeDataSources();
    dataSources.managerIntegration.findSwFormsByEmails = vi.fn(() => {
      throw new Error('boom');
    });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources });
    expect(out.all_signups.map((s) => s.cpf)).toEqual([null, null]);
  });
});
