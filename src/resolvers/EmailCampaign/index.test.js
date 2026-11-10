import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEmailCampaignResolvers } from './index';
import { unsubscribeToken } from '../../services/email-campaign/token';

vi.mock('../../services/email/signup-confirmation', () => ({
  loadSignupEventDetails: vi.fn().mockResolvedValue({ title: 'Meetup', dateStr: 'terça', timeStr: '19:00', locationStr: 'Goiânia' }),
}));

const env = { EMAIL_CAMPAIGNS_ENABLED: 'true', EMAIL_UNSUBSCRIBE_SECRET: 's', FRONTEND_URL: 'https://hub.io' };
const ADMIN = { id: 9, documentId: 'u-admin', email: 'adm@hub.io', name: 'Adm', role: { type: 'admin' } };
const ANA = { id: 1, documentId: 'u-ana', email: 'ana@x.io', role: { type: 'community-manager' } };
const EVENT = { documentId: 'ev-1', slug: 'meetup', title: 'Meetup', communities: [{ organizers: [{ documentId: 'u-ana' }] }] };

const makeDataSources = (over = {}) => ({
  managerIntegration: {
    findEventWithOrganizers: vi.fn().mockResolvedValue(EVENT),
    findEmailCampaignsByEvent: vi.fn().mockResolvedValue([]),
    createEmailCampaign: vi.fn().mockImplementation(async (data) => ({ documentId: 'cp-1', ...data })),
    findEmailCampaign: vi.fn(),
    updateEmailCampaign: vi.fn().mockImplementation(async (id, data) => data),
    countReachableUsers: vi.fn().mockResolvedValue(150),
    countEmailSuppressions: vi.fn().mockResolvedValue(10),
    findSuppressedEmails: vi.fn().mockResolvedValue(new Set()),
    findEmailSuppression: vi.fn().mockResolvedValue(null),
    createEmailSuppression: vi.fn().mockResolvedValue({}),
    ...over,
  },
  eventandoIntegration: {
    findEvents: vi.fn().mockResolvedValue({ data: [{ id: 1 }] }),
    findSignupsByEvent: vi.fn().mockResolvedValue([{ email: 'bia@x.io', name: 'Bia' }]),
  },
});

let send;
let resolvers;
beforeEach(() => {
  send = vi.fn().mockResolvedValue({ success: true });
  resolvers = makeEmailCampaignResolvers({ env, send, now: () => new Date('2026-11-10T12:00:00Z') });
});

const input = (type, extra = {}) => ({ input: { eventSlug: 'meetup', type, ...extra } });

describe('startEmailCampaign', () => {
  it('queues the campaign with its audience and who started it', async () => {
    const dataSources = makeDataSources();
    const out = await resolvers.Mutation.startEmailCampaign(null, input('invite', { subject: ' Oi ' }), { user: ADMIN, dataSources });
    expect(dataSources.managerIntegration.createEmailCampaign).toHaveBeenCalledWith(expect.objectContaining({
      event_document_id: 'ev-1', event_slug: 'meetup', type: 'invite', subject: 'Oi', status: 'sending', total: 140,
      created_by_email: 'adm@hub.io', started_at: '2026-11-10T12:00:00.000Z',
    }));
    expect(out).toMatchObject({ id: 'cp-1', status: 'sending', total: 140 });
  });

  it('refuses while the queue is off', async () => {
    const off = makeEmailCampaignResolvers({ env: { ...env, EMAIL_CAMPAIGNS_ENABLED: 'false' }, send });
    await expect(off.Mutation.startEmailCampaign(null, input('reminder'), { user: ADMIN, dataSources: makeDataSources() }))
      .rejects.toThrow(/desligado/);
  });

  it('refuses a second campaign of the same type still running', async () => {
    const dataSources = makeDataSources({ findEmailCampaignsByEvent: vi.fn().mockResolvedValue([{ type: 'reminder', status: 'paused' }]) });
    await expect(resolvers.Mutation.startEmailCampaign(null, input('reminder'), { user: ANA, dataSources }))
      .rejects.toThrow(/em andamento/);
  });

  it('refuses a subject that is too long', async () => {
    await expect(resolvers.Mutation.startEmailCampaign(null, input('reminder', { subject: 'x'.repeat(151) }), { user: ANA, dataSources: makeDataSources() }))
      .rejects.toThrow(/assunto/);
  });
});

describe('sendEmailCampaignTest', () => {
  it('sends only to the signed-in user, marked as a test', async () => {
    await resolvers.Mutation.sendEmailCampaignTest(null, input('share'), { user: ANA, dataSources: makeDataSources() });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'ana@x.io', subject: '[teste] 🤝 Convide alguém para Meetup' });
    expect(send.mock.calls[0][0].html).toContain('https://hub.io/events/meetup?ref=');
  });
});

describe('updateEmailCampaignStatus', () => {
  it('pauses a running campaign of the event', async () => {
    const dataSources = makeDataSources({ findEmailCampaign: vi.fn().mockResolvedValue({ documentId: 'cp-1', event_document_id: 'ev-1', type: 'reminder', status: 'sending' }) });
    const out = await resolvers.Mutation.updateEmailCampaignStatus(null, { eventSlug: 'meetup', id: 'cp-1', action: 'pause' }, { user: ANA, dataSources });
    expect(dataSources.managerIntegration.updateEmailCampaign).toHaveBeenCalledWith('cp-1', { status: 'paused' });
    expect(out.status).toBe('paused');
  });

  it('refuses a campaign of another event', async () => {
    const dataSources = makeDataSources({ findEmailCampaign: vi.fn().mockResolvedValue({ documentId: 'cp-1', event_document_id: 'ev-2', type: 'reminder', status: 'sending' }) });
    await expect(resolvers.Mutation.updateEmailCampaignStatus(null, { eventSlug: 'meetup', id: 'cp-1', action: 'pause' }, { user: ANA, dataSources }))
      .rejects.toThrow(/não encontrada/);
  });

  it('keeps an organizer away from the invite campaign', async () => {
    const dataSources = makeDataSources({ findEmailCampaign: vi.fn().mockResolvedValue({ documentId: 'cp-1', event_document_id: 'ev-1', type: 'invite', status: 'sending' }) });
    await expect(resolvers.Mutation.updateEmailCampaignStatus(null, { eventSlug: 'meetup', id: 'cp-1', action: 'cancel' }, { user: ANA, dataSources }))
      .rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    expect(dataSources.managerIntegration.updateEmailCampaign).not.toHaveBeenCalled();
  });

  it('does not resume a finished campaign', async () => {
    const dataSources = makeDataSources({ findEmailCampaign: vi.fn().mockResolvedValue({ documentId: 'cp-1', event_document_id: 'ev-1', type: 'reminder', status: 'done' }) });
    await expect(resolvers.Mutation.updateEmailCampaignStatus(null, { eventSlug: 'meetup', id: 'cp-1', action: 'resume' }, { user: ANA, dataSources }))
      .rejects.toThrow(/não pode/);
  });
});

describe('unsubscribeEmail', () => {
  it('records the unsubscribed e-mail', async () => {
    const dataSources = makeDataSources();
    expect(await resolvers.Mutation.unsubscribeEmail(null, { token: unsubscribeToken('Ana@X.io', env) }, { dataSources })).toBe(true);
    expect(dataSources.managerIntegration.createEmailSuppression).toHaveBeenCalledWith({ email: 'ana@x.io', reason: 'unsubscribe', source: 'link' });
  });

  it('answers false to a bad token without writing', async () => {
    const dataSources = makeDataSources();
    expect(await resolvers.Mutation.unsubscribeEmail(null, { token: 'abc.def' }, { dataSources })).toBe(false);
    expect(dataSources.managerIntegration.createEmailSuppression).not.toHaveBeenCalled();
  });

  it('is fine to click twice', async () => {
    const dataSources = makeDataSources({ findEmailSuppression: vi.fn().mockResolvedValue({ email: 'ana@x.io' }) });
    expect(await resolvers.Mutation.unsubscribeEmail(null, { token: unsubscribeToken('ana@x.io', env) }, { dataSources })).toBe(true);
    expect(dataSources.managerIntegration.createEmailSuppression).not.toHaveBeenCalled();
  });
});

describe('emailCampaignAudience', () => {
  it('tells the size, the days and whether the queue is on', async () => {
    const out = await resolvers.Query.emailCampaignAudience(null, { eventSlug: 'meetup', type: 'reminder' }, { user: ANA, dataSources: makeDataSources() });
    expect(out).toEqual({ total: 1, approximate: false, daily_limit: 70, estimated_days: 1, sending_enabled: true, redirect_to: null });
  });
});
