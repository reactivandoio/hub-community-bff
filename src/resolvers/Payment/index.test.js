import { describe, it, expect, vi, afterEach } from 'vitest';
import Payment from './index';

afterEach(() => {
  delete process.env.REFUND_SUPPORT_TEXT;
  delete process.env.REFUND_SUPPORT_WHATSAPP;
  vi.useRealTimers();
});

const admin = { id: 1, role: { type: 'admin' } };
const ctx = (eventando, user = admin) => ({ user, dataSources: { eventandoIntegration: eventando, managerIntegration: {} } });

describe('signupPaymentStatus', () => {
  it('devolve status, Pix e prazo, sem dados pessoais', async () => {
    const signup = {
      id: 9, name: 'Ana', email: 'ana@x.io', cpf: '52998224725',
      payment: { status: 'PEDING_PAYMENT', provider: 'opapingou', kind: 'PIX_QR', pix_br_code: '000201...', value: '100', expires_at: '2099-01-01T00:00:00Z' },
    };
    const out = await Payment.Query.signupPaymentStatus(null, { signupId: '9' }, ctx({ findSignupWithPayment: vi.fn().mockResolvedValue(signup) }));
    expect(out).toMatchObject({ signup_id: '9', status: 'PEDING_PAYMENT', provider: 'opapingou', kind: 'PIX_QR', pix_br_code: '000201...', value: 100 });
    expect(JSON.stringify(out)).not.toMatch(/ana@x\.io|Ana|52998224725/);
    expect(out.refund_support).toBeNull();
  });

  it('pendente do Opa Pingou vencido aparece como EXPIRED', async () => {
    const signup = { id: 9, payment: { status: 'PEDING_PAYMENT', provider: 'opapingou', expires_at: '2000-01-01T00:00:00Z' } };
    const out = await Payment.Query.signupPaymentStatus(null, { signupId: '9' }, ctx({ findSignupWithPayment: vi.fn().mockResolvedValue(signup) }));
    expect(out.status).toBe('EXPIRED');
  });

  it('inscrição desconhecida ou sem pagamento: null', async () => {
    const eventando = { findSignupWithPayment: vi.fn().mockResolvedValue(null) };
    expect(await Payment.Query.signupPaymentStatus(null, { signupId: '0' }, ctx(eventando))).toBeNull();
    eventando.findSignupWithPayment.mockResolvedValue({ id: 3 });
    expect(await Payment.Query.signupPaymentStatus(null, { signupId: '3' }, ctx(eventando))).toBeNull();
  });

  it('suporte de reembolso só com texto ou número configurado', async () => {
    process.env.REFUND_SUPPORT_TEXT = 'Fale com o suporte';
    const signup = { id: 1, payment: { status: 'CONFIRMED' } };
    const out = await Payment.Query.signupPaymentStatus(null, { signupId: '1' }, ctx({ findSignupWithPayment: vi.fn().mockResolvedValue(signup) }));
    expect(out.refund_support).toEqual({ text: 'Fale com o suporte', whatsapp: null });
  });
});

describe('eventPaymentSettings / eventPayments', () => {
  const eventando = () => ({
    findEvents: vi.fn().mockResolvedValue({ data: [{ id: 3, payment_provider: 'opapingou' }] }),
    findPaymentsByEvent: vi.fn().mockResolvedValue([
      { status: 'CONFIRMED', value: 1000, signup: { email: 'a@x.io', name: 'A', cpf: '1' } },
      { status: 'PEDING_PAYMENT', provider: 'opapingou', value: 1000, expires_at: '2000-01-01T00:00:00Z', signup: { email: 'b@x.io' } },
    ]),
  });

  it('exigem admin', async () => {
    await expect(Payment.Query.eventPaymentSettings(null, { eventId: 'u1' }, ctx(eventando(), null)))
      .rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
    await expect(Payment.Query.eventPayments(null, { slugOrId: 'u1' }, ctx(eventando(), { id: 2, role: { type: 'authenticated' } })))
      .rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });

  it('provedor do evento é sempre opapingou (REA-15)', async () => {
    const ev = eventando();
    ev.findEvents.mockResolvedValue({ data: [{ id: 3, payment_provider: 'pixai' }] });
    expect(await Payment.Query.eventPaymentSettings(null, { eventId: 'u1' }, ctx(ev))).toEqual({ payment_provider: 'opapingou' });
  });

  it('lista pagamentos sem CPF, com o pendente vencido como EXPIRED', async () => {
    const out = await Payment.Query.eventPayments(null, { slugOrId: 'meetup' }, ctx(eventando()));
    expect(out).toEqual([
      { email: 'a@x.io', name: 'A', status: 'CONFIRMED', value: 1000, expires_at: null },
      { email: 'b@x.io', name: null, status: 'EXPIRED', value: 1000, expires_at: '2000-01-01T00:00:00Z' },
    ]);
  });
});
