import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSignupConfirmation } from '../../services/email/signup-confirmation';
import Payment from './index';

vi.mock('../../services/email/signup-confirmation', () => ({
  sendSignupConfirmation: vi.fn().mockResolvedValue({ success: true }),
}));

beforeEach(() => vi.clearAllMocks());

const ADMIN = { id: 1, documentId: 'u-admin', email: 'admin@x.io', name: 'Admin Silva', role: { type: 'admin' } };
const EVENT = { id: 42, uuid: 'ev-uuid', slug: 'meetup', name: 'Meetup' };

const codeError = (code) => Object.assign(new Error('Request failed with status code 409'), { code });

const approved = (extra = {}) => ({
  approved: true,
  already_approved: false,
  warnings: ['BATCH_FULL'],
  payment: { id: 5, status: 'CONFIRMED', value: 5000, manual_approved_at: '2026-11-10T15:00:00.000Z' },
  signup: { id: 9, documentId: 'doc-9', name: 'Ana', email: 'ana@x.io', phone_number: '11999990000', cpf: '52998224725' },
  event: { id: 42, uuid: 'ev-uuid', slug: 'meetup' },
  ...extra,
});

const makeCtx = ({ user = ADMIN, eventando = {} } = {}) => ({
  user,
  dataSources: {
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [EVENT] }),
      manualApprovalPreview: vi.fn().mockResolvedValue({
        approvable: true, reason: null, status: 'EXPIRED', warnings: ['EVENT_FULL'],
      }),
      approveSignupManually: vi.fn().mockResolvedValue(approved()),
      ...eventando,
    },
    managerIntegration: {},
  },
});

describe('signupApprovalPreview (REA-34)', () => {
  it('exige admin', async () => {
    await expect(Payment.Query.signupApprovalPreview(null, { event: 'meetup', signup_id: '9' }, makeCtx({ user: null })))
      .rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
    const manager = { id: 2, role: { type: 'community-manager' } };
    await expect(Payment.Query.signupApprovalPreview(null, { event: 'meetup', signup_id: '9' }, makeCtx({ user: manager })))
      .rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });

  it('resolve o evento pelo slug e devolve o que o Eventando diz', async () => {
    const ctx = makeCtx();
    const out = await Payment.Query.signupApprovalPreview(null, { event: 'meetup', signup_id: '9' }, ctx);
    expect(out).toEqual({ approvable: true, reason: null, status: 'EXPIRED', warnings: ['EVENT_FULL'] });
    expect(ctx.dataSources.eventandoIntegration.manualApprovalPreview).toHaveBeenCalledWith({ eventId: 42, signupId: '9' });
  });

  it('evento desconhecido: não aprovável, NOT_FOUND, sem chamar o Eventando', async () => {
    const ctx = makeCtx({ eventando: { findEvents: vi.fn().mockResolvedValue({ data: [] }) } });
    const out = await Payment.Query.signupApprovalPreview(null, { event: 'x', signup_id: '9' }, ctx);
    expect(out).toEqual({ approvable: false, reason: 'NOT_FOUND', status: null, warnings: [] });
    expect(ctx.dataSources.eventandoIntegration.manualApprovalPreview).not.toHaveBeenCalled();
  });

  it('resposta incompleta vira valores seguros', async () => {
    const ctx = makeCtx({ eventando: { manualApprovalPreview: vi.fn().mockResolvedValue({ approvable: false, reason: 'REFUNDED' }) } });
    const out = await Payment.Query.signupApprovalPreview(null, { event: 'meetup', signup_id: '9' }, ctx);
    expect(out).toEqual({ approvable: false, reason: 'REFUNDED', status: null, warnings: [] });
  });
});

describe('approveSignupManually (REA-34)', () => {
  it('exige admin, antes de qualquer chamada', async () => {
    const ctx = makeCtx({ user: { id: 2, role: { type: 'community-manager' } } });
    await expect(Payment.Mutation.approveSignupManually(null, { event: 'meetup', signup_id: '9' }, ctx))
      .rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    expect(ctx.dataSources.eventandoIntegration.approveSignupManually).not.toHaveBeenCalled();
  });

  it('aprova com quem aprovou e manda o e-mail de confirmação com o ingresso', async () => {
    const ctx = makeCtx();
    const out = await Payment.Mutation.approveSignupManually(null, { event: 'meetup', signup_id: '9' }, ctx);
    expect(ctx.dataSources.eventandoIntegration.approveSignupManually).toHaveBeenCalledWith({
      eventId: 42,
      signupId: '9',
      approvedBy: { id: 'u-admin', email: 'admin@x.io', name: 'Admin Silva' },
    });
    expect(sendSignupConfirmation).toHaveBeenCalledTimes(1);
    expect(sendSignupConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      dataSources: ctx.dataSources,
      eventSlug: 'meetup',
      eventandoEvent: EVENT,
      signupId: 'doc-9',
      name: 'Ana',
      email: 'ana@x.io',
      phone: '11999990000',
      cpf: '52998224725',
      isFree: false,
      isPaid: true,
    }));
    expect(out).toMatchObject({ success: true, already_approved: false, warnings: ['BATCH_FULL'], email_sent: true });
    expect(out.message).toMatch(/aprovada/i);
  });

  it('já aprovada antes: sucesso, sem segundo e-mail', async () => {
    const ctx = makeCtx({
      eventando: { approveSignupManually: vi.fn().mockResolvedValue(approved({ already_approved: true, warnings: [] })) },
    });
    const out = await Payment.Mutation.approveSignupManually(null, { event: 'meetup', signup_id: '9' }, ctx);
    expect(out).toMatchObject({ success: true, already_approved: true, email_sent: false, warnings: [] });
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
  });

  it('e-mail que falha não desfaz a aprovação: avisa o admin', async () => {
    sendSignupConfirmation.mockResolvedValueOnce({ success: false, error: 'mailgun down' });
    const out = await Payment.Mutation.approveSignupManually(null, { event: 'meetup', signup_id: '9' }, makeCtx());
    expect(out).toMatchObject({ success: true, email_sent: false });
    expect(out.message).toMatch(/e-mail/i);
  });

  it.each([
    ['NOT_FOUND', /não encontrada/i],
    ['NO_PAYMENT', /sem pagamento|não tem pagamento/i],
    ['ALREADY_CONFIRMED', /já está confirmada/i],
    ['REFUNDED', /reembolsad/i],
  ])('erro %s do Eventando vira mensagem em português, sem e-mail', async (code, message) => {
    const ctx = makeCtx({ eventando: { approveSignupManually: vi.fn().mockRejectedValue(codeError(code)) } });
    const out = await Payment.Mutation.approveSignupManually(null, { event: 'meetup', signup_id: '9' }, ctx);
    expect(out.success).toBe(false);
    expect(out.message).toMatch(message);
    expect(out.warnings).toEqual([]);
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
  });

  it('falha inesperada do Eventando: success false com a mensagem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = makeCtx({ eventando: { approveSignupManually: vi.fn().mockRejectedValue(new Error('HTTP 503')) } });
    const out = await Payment.Mutation.approveSignupManually(null, { event: 'meetup', signup_id: '9' }, ctx);
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/Não foi possível aprovar/);
  });

  it('evento desconhecido: success false, sem chamar o Eventando', async () => {
    const ctx = makeCtx({ eventando: { findEvents: vi.fn().mockResolvedValue({ data: [] }) } });
    const out = await Payment.Mutation.approveSignupManually(null, { event: 'x', signup_id: '9' }, ctx);
    expect(out).toMatchObject({ success: false, warnings: [] });
    expect(out.message).toMatch(/Evento/);
    expect(ctx.dataSources.eventandoIntegration.approveSignupManually).not.toHaveBeenCalled();
  });
});
