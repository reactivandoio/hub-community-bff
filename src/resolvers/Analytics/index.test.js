import { describe, it, expect, vi } from 'vitest';
import Analytics from './index';

const rawSignups = [
  { id: 1, name: 'ana-4f2k', email: 'ana@x.io', createdAt: '2026-09-01T10:00:00.000Z' },
  { id: 2, name: 'Bia Lima', email: 'bia@x.io', createdAt: '2026-09-02T10:00:00.000Z' },
];

const makeDataSources = ({ users = [], usersError = null } = {}) => ({
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
});
