import { describe, expect, it, vi } from 'vitest';
import { makeAiTextResolvers } from './index';

vi.mock('../../services/email/signup-confirmation', () => ({
  loadSignupEventDetails: vi.fn().mockResolvedValue({
    title: 'Meetup Go', dateStr: 'terça-feira, 1 de dezembro de 2026', timeStr: '19:00', locationStr: 'Goiânia', description: '',
  }),
}));

const ADMIN = { id: 9, documentId: 'u-admin', email: 'adm@hub.io', role: { type: 'admin' } };
const ANA = { id: 1, documentId: 'u-ana', email: 'ana@x.io', role: { type: 'community-manager' } };
const BOB = { id: 2, documentId: 'u-bob', email: 'bob@x.io', role: { type: 'authenticated' } };
const EVENT = { documentId: 'ev-1', slug: 'meetup', title: 'Meetup Go', communities: [{ organizers: [{ documentId: 'u-ana' }] }] };

const makeService = () => ({
  getSettings: vi.fn().mockResolvedValue({ configured: false }),
  saveSettings: vi.fn().mockResolvedValue({ configured: true }),
  testSettings: vi.fn(),
  deleteSettings: vi.fn(),
  start: vi.fn().mockResolvedValue({ id: 'g1', status: 'queued' }),
  get: vi.fn().mockResolvedValue({ id: 'g1', status: 'running' }),
  cancel: vi.fn().mockResolvedValue({ id: 'g1', status: 'cancelled' }),
});

const ctxOf = (user) => ({
  user,
  dataSources: { managerIntegration: { findEventWithOrganizers: vi.fn().mockResolvedValue(EVENT), findEventBySlug: vi.fn() } },
});

const env = { FRONTEND_URL: 'https://hub.io' };

describe('AI text resolvers', () => {
  it('lets only admin users see and save their termhub settings', async () => {
    const service = makeService();
    const r = makeAiTextResolvers({ service, env });
    await expect(r.Query.termhubSettings(null, {}, ctxOf(undefined))).rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
    await expect(r.Query.termhubSettings(null, {}, ctxOf(BOB))).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    await r.Mutation.saveTermhubSettings(null, { input: { token: 't', project: 'TER' } }, ctxOf(ANA));
    expect(service.saveSettings).toHaveBeenCalledWith(expect.any(Object), ANA, { token: 't', project: 'TER' });
  });

  it('builds the prompt from the event (name, date, place, link) and the campaign type', async () => {
    const service = makeService();
    const r = makeAiTextResolvers({ service, env });
    const out = await r.Mutation.generateEmailCampaignText(null, {
      input: { eventSlug: 'meetup', type: 'reminder', subject: 'Amanhã', instructions: 'tom animado', requestId: 'abc' },
    }, ctxOf(ANA));
    expect(out).toEqual({ id: 'g1', status: 'queued' });
    const [, user, args] = service.start.mock.calls[0];
    expect(user).toBe(ANA);
    expect(args).toMatchObject({ event: EVENT, type: 'reminder', requestId: 'abc' });
    expect(args.prompt).toContain('Meetup Go');
    expect(args.prompt).toContain('terça-feira, 1 de dezembro de 2026');
    expect(args.prompt).toContain('Goiânia');
    expect(args.prompt).toContain('https://hub.io/events/meetup?utm_source=email&utm_medium=email&utm_campaign=reminder');
    expect(args.prompt).toContain('Lembrete');
    expect(args.prompt).toContain('Assunto: Amanhã');
    expect(args.prompt).toContain('tom animado');
  });

  it('follows the campaign rules: invite is admin only, others need to organize the event', async () => {
    const service = makeService();
    const r = makeAiTextResolvers({ service, env });
    await expect(r.Mutation.generateEmailCampaignText(null, { input: { eventSlug: 'meetup', type: 'invite' } }, ctxOf(ANA)))
      .rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    await r.Mutation.generateEmailCampaignText(null, { input: { eventSlug: 'meetup', type: 'invite' } }, ctxOf(ADMIN));
    expect(service.start).toHaveBeenCalledTimes(1);
  });

  it('refuses instructions that are too long', async () => {
    const r = makeAiTextResolvers({ service: makeService(), env });
    await expect(r.Mutation.generateEmailCampaignText(null, {
      input: { eventSlug: 'meetup', type: 'share', instructions: 'x'.repeat(501) },
    }, ctxOf(ANA))).rejects.toThrow(/500 caracteres/);
  });

  it('polls and cancels through the service, for the signed-in user', async () => {
    const service = makeService();
    const r = makeAiTextResolvers({ service, env });
    await r.Query.aiTextGeneration(null, { id: 'g1' }, ctxOf(ANA));
    await r.Mutation.cancelAiTextGeneration(null, { id: 'g1' }, ctxOf(ANA));
    expect(service.get).toHaveBeenCalledWith(expect.any(Object), ANA, 'g1');
    expect(service.cancel).toHaveBeenCalledWith(expect.any(Object), ANA, 'g1');
  });
});
