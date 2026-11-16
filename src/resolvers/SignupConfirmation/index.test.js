import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resendSignupConfirmation } from './index';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const UUID = '0b6f3c1e-1111-4a4a-8b8b-123456789abc';

const makeCtx = ({ role = 'admin', signup, deliveries = [] } = {}) => ({
  user: { id: 1, documentId: 'u1', email: 'adm@x.io', role: { type: role } },
  dataSources: {
    managerIntegration: {
      findEventWithOrganizers: vi.fn().mockResolvedValue({ documentId: 'ev1', communities: [], managers: [] }),
      findTransactionalDeliveries: vi.fn().mockResolvedValue(deliveries),
    },
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 5, slug: 'meetup', uuid: 'ev1' }] }),
      findSignupWithPayment: vi.fn().mockResolvedValue(
        signup === undefined
          ? { id: 42, event: { id: 5 }, name: 'Ana', email: 'ana@x.io', payment: { status: 'CONFIRMED', value: 5000 } }
          : signup,
      ),
    },
  },
});

const run = (ctx, send = vi.fn().mockResolvedValue({ success: true })) =>
  resendSignupConfirmation(null, { event: 'ev1', signup_id: '42' }, ctx, { now: NOW, send }).then((out) => ({ out, send }));

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('resendSignupConfirmation (REA-50)', () => {
  it('resends the confirmation with the ticket of a paid signup, as a resend', async () => {
    const { out, send } = await run(makeCtx());
    expect(out).toMatchObject({ success: true, sent_at: NOW.toISOString() });
    expect(out.message).toContain('ana@x.io');
    expect(send.mock.calls[0][0]).toMatchObject({
      signupId: '42', email: 'ana@x.io', isPaid: true, isFree: false, kind: 'signup-confirmation-resend',
    });
  });

  it('treats a signup without payment as free', async () => {
    const ctx = makeCtx({ signup: { id: 42, event: { id: 5 }, email: 'ana@x.io', payment: null } });
    const { send } = await run(ctx);
    expect(send.mock.calls[0][0]).toMatchObject({ isFree: true, isPaid: false });
  });

  it('refuses a signup that is not confirmed', async () => {
    const ctx = makeCtx({ signup: { id: 42, event: { id: 5 }, email: 'ana@x.io', payment: { status: 'PEDING_PAYMENT', value: 5000 } } });
    const { out, send } = await run(ctx);
    expect(out).toMatchObject({ success: false });
    expect(out.message).toMatch(/Só inscrições confirmadas/);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a signup of another event', async () => {
    const ctx = makeCtx({ signup: { id: 42, event: { id: 6 }, email: 'ana@x.io', payment: null } });
    const { out, send } = await run(ctx);
    expect(out.message).toBe('Inscrição não encontrada neste evento.');
    expect(send).not.toHaveBeenCalled();
  });

  it('asks to wait when it was resent less than a minute ago', async () => {
    const ctx = makeCtx({ deliveries: [{
      key: `tx:sc:42:${UUID}`,
      campaign_document_id: 'transactional:signup-confirmation-resend',
      status: 'sent',
      sent_at: '2026-11-15T11:59:30.000Z',
    }] });
    const { out, send } = await run(ctx);
    expect(out).toMatchObject({ success: false, retry_after: 30 });
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores a second click while the first one is still sending', async () => {
    const ctx = makeCtx();
    let release;
    const send = vi.fn(() => new Promise((resolve) => { release = () => resolve({ success: true }); }));
    const first = resendSignupConfirmation(null, { event: 'ev1', signup_id: '42' }, ctx, { now: NOW, send });
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    const second = await resendSignupConfirmation(null, { event: 'ev1', signup_id: '42' }, ctx, { now: NOW, send });
    expect(second.message).toMatch(/já está sendo reenviado/);
    release();
    expect((await first).success).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('tells clearly when the provider refused it for the quota', async () => {
    const { out } = await run(makeCtx(), vi.fn().mockResolvedValue({ success: false, error: '421 daily limit exceeded' }));
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/cota de e-mails do dia/);
  });

  it('lets an event manager of the event resend, and refuses anyone else', async () => {
    const manager = makeCtx({ role: 'event-manager' });
    manager.dataSources.managerIntegration.findEventWithOrganizers
      .mockResolvedValue({ documentId: 'ev1', communities: [], managers: [{ documentId: 'u1' }] });
    expect((await run(manager)).out.success).toBe(true);

    const stranger = makeCtx({ role: 'event-manager' });
    await expect(run(stranger)).rejects.toThrow(/organizadores do evento/);
  });
});
