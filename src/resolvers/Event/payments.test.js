import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSignupConfirmation } from '../../services/email/signup-confirmation';
import Event from './index';

vi.mock('../../dataSources/pubsub', () => ({ default: { publish: vi.fn(), asyncIterator: vi.fn() } }));
vi.mock('../../services/email/signup-confirmation', () => ({
  sendSignupConfirmation: vi.fn().mockResolvedValue({ success: true }),
}));

beforeEach(() => vi.clearAllMocks());

const makeDataSources = ({ signup, existing = [] } = {}) => ({
  eventandoIntegration: {
    findEventBySlug: vi.fn().mockResolvedValue({ data: [{ id: 42, name: 'Meetup' }] }),
    findSignupByEmail: vi.fn().mockResolvedValue({ data: existing }),
    signup: vi.fn().mockResolvedValue(signup),
  },
  manager: { findEvents: vi.fn().mockResolvedValue({ data: [{ slug: 'meetup', call_link: null }] }) },
  managerIntegration: {},
});

// With utils/auth (PR #33): isUserSignedUp is for the person themself, updateEventSale for admins.
const ANA = { id: 7, email: 'ana@x.io' };
const ADMIN = { id: 1, email: 'admin@x.io', role: { type: 'admin' } };

const args = { eventId: 'meetup', name: 'Ana', email: 'ana@x.io', batch_id: '3', cpf: '529.982.247-25', kind: 'PIX_QR' };

// Signed in (the signup without login is services/guest-signup).
describe('signupToEvent com Opa Pingou', () => {
  it('repassa cpf e kind ao Eventando', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: true } } });
    await Event.Mutation.signupToEvent(null, args, { dataSources, user: ANA });
    expect(dataSources.eventandoIntegration.signup).toHaveBeenCalledWith(42, expect.objectContaining({
      cpf: '529.982.247-25', kind: 'PIX_QR', batch_id: 3,
    }));
  });

  it('pago no Opa Pingou: não manda o e-mail agora (vai na confirmação do webhook)', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: false, payment_provider: 'opapingou', pix_br_code: '0002' } } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources, user: ANA });
    expect(out.success).toBe(true);
    expect(out.payment.pix_br_code).toBe('0002');
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
  });

  it('gratuito (inclusive cupom de 100%) no Opa Pingou: e-mail na hora', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: true, payment_provider: 'opapingou' } } });
    await Event.Mutation.signupToEvent(null, args, { dataSources, user: ANA });
    expect(sendSignupConfirmation).toHaveBeenCalledTimes(1);
  });

  it('pago sem provedor na resposta também espera o webhook', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: false } } });
    await Event.Mutation.signupToEvent(null, args, { dataSources, user: ANA });
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
  });

  it('o CPF nunca volta na resposta', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: true, cpf: '52998224725', signup: { cpf: '52998224725', name: 'Ana' } } } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources, user: ANA });
    expect(JSON.stringify(out)).not.toContain('52998224725');
  });

  it('erro de CPF do Eventando chega como mensagem', async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.signup.mockRejectedValue(new Error('Informe um CPF válido.'));
    const out = await Event.Mutation.signupToEvent(null, { ...args, cpf: '1' }, { dataSources, user: ANA });
    expect(out).toMatchObject({ success: false, message: 'Informe um CPF válido.' });
  });
});

describe('isUserSignedUp com pagamento', () => {
  it('Opa Pingou pendente ou expirado não é inscrito', async () => {
    for (const payment of [{ status: 'PEDING_PAYMENT', provider: 'opapingou' }, { status: 'EXPIRED', provider: 'opapingou' }]) {
      const dataSources = makeDataSources({ existing: [{ id: 7, email: 'ana@x.io', payment }] });
      // eslint-disable-next-line no-await-in-loop
      const out = await Event.Query.isUserSignedUp(null, { eventId: 'meetup', email: 'ana@x.io' }, { dataSources, user: ANA });
      expect(out.is_signed_up).toBe(false);
    }
  });

  it('confirmado é inscrito', async () => {
    const dataSources = makeDataSources({ existing: [{ id: 7, email: 'ana@x.io', payment: { status: 'CONFIRMED', provider: 'opapingou' } }] });
    const out = await Event.Query.isUserSignedUp(null, { eventId: 'meetup', email: 'ana@x.io' }, { dataSources, user: ANA });
    expect(out).toMatchObject({ is_signed_up: true, signup_id: '7' });
  });
});

describe('updateEventSale e o provedor (REA-15)', () => {
  const saleDataSources = (event) => ({
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42, uuid: 'u1', products: [], ...event }] }),
      updateEvent: vi.fn().mockResolvedValue({ data: {} }),
    },
  });

  it('ignora o payment_provider enviado e põe opapingou no evento que ainda tem o campo', async () => {
    const dataSources = saleDataSources({ payment_provider: 'pixai' });
    await Event.Mutation.updateEventSale(null, { id: 'u1', data: { payment_provider: 'pixai', products: [] } }, { dataSources, user: ADMIN });
    expect(dataSources.eventandoIntegration.updateEvent).toHaveBeenCalledWith(42, { payment_provider: 'opapingou' });
  });

  it('evento já no Opa Pingou: não regrava', async () => {
    const dataSources = saleDataSources({ payment_provider: 'opapingou' });
    await Event.Mutation.updateEventSale(null, { id: 'u1', data: { payment_provider: 'pixai', products: [] } }, { dataSources, user: ADMIN });
    expect(dataSources.eventandoIntegration.updateEvent).not.toHaveBeenCalled();
  });

  it('Eventando sem o campo: nada de payment_provider vai para lá', async () => {
    const dataSources = saleDataSources({});
    await Event.Mutation.updateEventSale(null, { id: 'u1', data: { payment_provider: 'opapingou', max_slots: 10, products: [] } }, { dataSources, user: ADMIN });
    expect(dataSources.eventandoIntegration.updateEvent).toHaveBeenCalledWith(42, { max_slots: 10 });
  });
});

describe('createEvent/updateEvent não repassam campos do Pix Aí', () => {
  it('pixai_token_integration(_id) ficam fora do corpo do Eventando', async () => {
    const dataSources = {
      managerIntegration: { createEvent: vi.fn().mockResolvedValue({ data: { documentId: 'ev1' } }) },
      eventandoIntegration: { createEvent: vi.fn().mockResolvedValue({ data: { id: 1, uuid: 'ev1' } }) },
    };
    await Event.Mutation.createEvent(null, { data: {
      title: 'Meetup', start_date: '2026-10-01', end_date: '2026-10-01',
      pixai_token_integration: 'antigo', pixai_token_integration_id: 'antigo',
    } }, { dataSources, user: ADMIN });
    const sent = dataSources.eventandoIntegration.createEvent.mock.calls[0][0];
    expect(sent).not.toHaveProperty('pixai_token_integration');
    expect(sent).not.toHaveProperty('pixai_token_integration_id');
    expect(sent).toMatchObject({ name: 'Meetup', uuid: 'ev1' });
  });
});

describe('signupToEvent sem sessão (REA-22)', () => {
  it('vai para a inscrição sem login: CPF inválido é recusado antes do Eventando', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: true } } });
    const out = await Event.Mutation.signupToEvent(null, { ...args, cpf: '529.982.247-24' }, { dataSources, clientIp: '1.2.3.4' });
    expect(out).toMatchObject({ success: false, message: 'Informe um CPF válido.' });
    expect(dataSources.eventandoIntegration.signup).not.toHaveBeenCalled();
  });
});
