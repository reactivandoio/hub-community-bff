import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addressFor, isEnabled, runTick } from './sender';
import { USERS_PAGE } from './audience';

vi.mock('../email/signup-confirmation', () => ({
  loadSignupEventDetails: vi.fn().mockResolvedValue({ title: 'Meetup', dateStr: 'terça', timeStr: '19:00', locationStr: 'Goiânia' }),
}));

const env = { EMAIL_CAMPAIGNS_ENABLED: 'true', EMAIL_UNSUBSCRIBE_SECRET: 's', FRONTEND_URL: 'https://hub.io' };
const now = new Date('2026-11-10T15:00:00Z');

const users = (from, count) => Array.from({ length: count }, (_, i) => ({ id: from + i, email: `u${from + i}@x.io`, name: `U${from + i}` }));

const makeDataSources = ({ campaigns, sentToday = 0, pages = [], signups = [], existingKeys = [] } = {}) => {
  const createdKeys = new Set(existingKeys);
  const integration = {
    countEmailDeliveriesSince: vi.fn().mockResolvedValue(sentToday),
    findSendingEmailCampaigns: vi.fn().mockResolvedValue(campaigns),
    findUsersAfterId: vi.fn().mockImplementation(async () => pages.shift() || []),
    findSuppressedEmails: vi.fn().mockResolvedValue(new Set()),
    findEmailDeliveriesByKeys: vi.fn().mockResolvedValue([]),
    createEmailDelivery: vi.fn().mockImplementation(async (data) => {
      if (createdKeys.has(data.key)) throw new Error('This attribute must be unique');
      createdKeys.add(data.key);
      return { documentId: `d-${data.email}` };
    }),
    updateEmailDelivery: vi.fn().mockResolvedValue({}),
    updateEmailCampaign: vi.fn().mockResolvedValue({}),
  };
  return {
    managerIntegration: integration,
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 1 }] }),
      findSignupsByEvent: vi.fn().mockResolvedValue(signups),
    },
  };
};

const invite = { documentId: 'c1', type: 'invite', event_slug: 'meetup', subject: 'Oi', status: 'sending', cursor: 0, sent: 0, failed: 0 };
const reminder = { ...invite, documentId: 'c2', type: 'reminder' };

let send;
beforeEach(() => {
  send = vi.fn().mockResolvedValue({ success: true });
});

describe('isEnabled', () => {
  it('needs the flag and the unsubscribe secret', () => {
    expect(isEnabled(env)).toBe(true);
    expect(isEnabled({ ...env, EMAIL_CAMPAIGNS_ENABLED: 'false' })).toBe(false);
    expect(isEnabled({ EMAIL_CAMPAIGNS_ENABLED: 'true' })).toBe(false);
  });
});

describe('addressFor', () => {
  it('sends to the redirect address with the person in the subject', () => {
    expect(addressFor({ email: 'ana@x.io', subject: 'Oi' }, { EMAIL_CAMPAIGN_REDIRECT_TO: 'qa@hub.io' }))
      .toEqual({ to: 'qa@hub.io', subject: '[para ana@x.io] Oi' });
    expect(addressFor({ email: 'ana@x.io', subject: 'Oi' }, {})).toEqual({ to: 'ana@x.io', subject: 'Oi' });
  });
});

describe('runTick', () => {
  it('sends nothing with the flag off', async () => {
    const ds = makeDataSources({ campaigns: [invite] });
    expect(await runTick({ dataSources: ds, env: {}, now, send })).toEqual({ sent: 0 });
    expect(ds.managerIntegration.countEmailDeliveriesSince).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when the daily quota is used up', async () => {
    const ds = makeDataSources({ campaigns: [invite], sentToday: 70 });
    expect(await runTick({ dataSources: ds, env, now, send })).toEqual({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(ds.managerIntegration.countEmailDeliveriesSince).toHaveBeenCalledWith(new Date('2026-11-10T03:00:00Z'));
  });

  it('stops at the per-tick budget and keeps the cursor on the last one sent', async () => {
    const ds = makeDataSources({ campaigns: [invite], pages: [users(1, USERS_PAGE)] });
    expect(await runTick({ dataSources: ds, env, now, send, maxPerTick: 3 })).toEqual({ sent: 3 });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['u1@x.io', 'u2@x.io', 'u3@x.io']);
    expect(ds.managerIntegration.updateEmailCampaign).toHaveBeenLastCalledWith('c1', { cursor: 3, sent: 3, failed: 0 });
  });

  it('respects what is left of the daily quota', async () => {
    const ds = makeDataSources({ campaigns: [invite], sentToday: 68, pages: [users(1, USERS_PAGE)] });
    expect(await runTick({ dataSources: ds, env, now, send })).toEqual({ sent: 2 });
  });

  it('never sends twice to a person already recorded (restart in the middle)', async () => {
    const ds = makeDataSources({ campaigns: [invite], pages: [users(1, 3)], existingKeys: ['c1:u2@x.io'] });
    await runTick({ dataSources: ds, env, now, send });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['u1@x.io', 'u3@x.io']);
  });

  it('records a failure and goes on', async () => {
    send.mockResolvedValueOnce({ success: false, error: 'smtp down' });
    const ds = makeDataSources({ campaigns: [invite], pages: [users(1, 2)] });
    await runTick({ dataSources: ds, env, now, send });
    expect(ds.managerIntegration.updateEmailDelivery).toHaveBeenCalledWith('d-u1@x.io', expect.objectContaining({ status: 'failed', error: 'smtp down' }));
    expect(ds.managerIntegration.updateEmailCampaign).toHaveBeenLastCalledWith('c1', expect.objectContaining({ sent: 1, failed: 1, status: 'done' }));
  });

  it('finishes a reminder after the last signup, with the unsubscribe headers', async () => {
    const ds = makeDataSources({ campaigns: [reminder], signups: [{ email: 'Ana@x.io', name: 'Ana' }] });
    await runTick({ dataSources: ds, env, now, send });
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe('ana@x.io');
    expect(mail.subject).toBe('Oi');
    expect(mail.headers['List-Unsubscribe']).toMatch(/^<https:\/\/hub\.io\/api\/email\/unsubscribe\?t=/);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.html).toContain('https://hub.io/descadastro?t=');
    expect(ds.managerIntegration.updateEmailCampaign).toHaveBeenLastCalledWith('c2', expect.objectContaining({ status: 'done', sent: 1 }));
  });

  it('redirects every e-mail when EMAIL_CAMPAIGN_REDIRECT_TO is set', async () => {
    const ds = makeDataSources({ campaigns: [reminder], signups: [{ email: 'ana@x.io' }] });
    await runTick({ dataSources: ds, env: { ...env, EMAIL_CAMPAIGN_REDIRECT_TO: 'qa@hub.io' }, now, send });
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'qa@hub.io', subject: '[para ana@x.io] Oi' });
  });

  it('walks the next page of the base when the first is all skipped', async () => {
    const blocked = users(1, USERS_PAGE).map((u) => ({ ...u, blocked: true }));
    const ds = makeDataSources({ campaigns: [invite], pages: [blocked, users(100, 1)] });
    await runTick({ dataSources: ds, env, now, send });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(['u100@x.io']);
    expect(ds.managerIntegration.findUsersAfterId).toHaveBeenNthCalledWith(2, USERS_PAGE, USERS_PAGE);
  });
});
