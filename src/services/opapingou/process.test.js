import { describe, it, expect, vi } from 'vitest';
import { createOpaProcessor } from './process';

const payment = { id: 5, value: 100, signup: { id: 9, name: 'Ana', email: 'ana@x.io' }, event: { id: 3, uuid: 'u1', slug: 'meetup' } };
const quiet = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

// Dublê do Eventando com o estado de um pagamento, aplicando as transições como a Task E4.
const fakeEventando = (chargeStatusByEvent) => {
  let status = 'PEDING_PAYMENT';
  const allowed = { CONFIRMED: ['PEDING_PAYMENT', 'EXPIRED', 'CANCELED'], EXPIRED: ['PEDING_PAYMENT'], CANCELED: ['PEDING_PAYMENT'] };
  const target = { PAID: 'CONFIRMED', EXPIRED: 'EXPIRED', CANCELED: 'CANCELED' };
  return {
    processEvent: vi.fn(async (eventId) => {
      const to = target[chargeStatusByEvent[eventId]];
      const transitioned = Boolean(to) && allowed[to].includes(status);
      if (transitioned) status = to;
      return { transitioned, status, payment };
    }),
    pendingEvents: vi.fn().mockResolvedValue([]),
    state: () => status,
  };
};

describe('createOpaProcessor', () => {
  it('confirmado: manda o e-mail uma vez, mesmo com o evento reprocessado', async () => {
    const eventando = fakeEventando({ evt_paid: 'PAID' });
    const sendConfirmation = vi.fn().mockResolvedValue({ success: true });
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation, log: quiet });
    await processEvent({ eventId: 'evt_paid', type: 'charge.paid' });
    await processEvent({ eventId: 'evt_paid', type: 'charge.paid' });
    expect(sendConfirmation).toHaveBeenCalledTimes(1);
    expect(sendConfirmation).toHaveBeenCalledWith(payment);
  });

  it('fora de ordem: paid e depois expired → continua CONFIRMED, um e-mail só', async () => {
    const eventando = fakeEventando({ evt_paid: 'PAID', evt_exp: 'EXPIRED' });
    const sendConfirmation = vi.fn();
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation, log: quiet });
    await processEvent({ eventId: 'evt_paid', type: 'charge.paid' });
    await processEvent({ eventId: 'evt_exp', type: 'charge.expired' });
    expect(eventando.state()).toBe('CONFIRMED');
    expect(sendConfirmation).toHaveBeenCalledTimes(1);
  });

  it('fora de ordem: expired e depois paid → confirma (Pix pago depois de vencer) e manda o e-mail', async () => {
    const eventando = fakeEventando({ evt_paid: 'PAID', evt_exp: 'EXPIRED' });
    const sendConfirmation = vi.fn();
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation, log: quiet });
    await processEvent({ eventId: 'evt_exp', type: 'charge.expired' });
    expect(sendConfirmation).not.toHaveBeenCalled();
    await processEvent({ eventId: 'evt_paid', type: 'charge.paid' });
    expect(eventando.state()).toBe('CONFIRMED');
    expect(sendConfirmation).toHaveBeenCalledTimes(1);
  });

  it('erro do Eventando ao processar: não manda e-mail e não lança (a varredura repete)', async () => {
    const eventando = { processEvent: vi.fn().mockRejectedValue(new Error('HTTP 503')) };
    const sendConfirmation = vi.fn();
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation, log: quiet });
    await expect(processEvent({ eventId: 'evt_1', type: 'charge.paid' })).resolves.toEqual({ error: true });
    expect(sendConfirmation).not.toHaveBeenCalled();
  });

  it('cobrança que não é de inscrição (ignored): nada acontece', async () => {
    const eventando = { processEvent: vi.fn().mockResolvedValue({ ignored: true }) };
    const sendConfirmation = vi.fn();
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation, log: quiet });
    await processEvent({ eventId: 'evt_1', type: 'charge.paid' });
    expect(sendConfirmation).not.toHaveBeenCalled();
  });

  it('reembolso e contestação: alerta, e o e-mail nunca sai', async () => {
    const eventando = { processEvent: vi.fn().mockResolvedValue({ ignored: true }) };
    const alert = vi.fn();
    const sendConfirmation = vi.fn();
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation, alert, log: quiet });
    await processEvent({ eventId: 'evt_r', type: 'payment.refunded' });
    await processEvent({ eventId: 'evt_c', type: 'payment.charged_back' });
    expect(alert).toHaveBeenCalledTimes(2);
    expect(sendConfirmation).not.toHaveBeenCalled();
  });

  it('falha no e-mail não derruba o processamento', async () => {
    const eventando = fakeEventando({ evt_paid: 'PAID' });
    const sendConfirmation = vi.fn().mockRejectedValue(new Error('smtp'));
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation, log: quiet });
    await expect(processEvent({ eventId: 'evt_paid', type: 'charge.paid' })).resolves.toMatchObject({ transitioned: true });
  });

  it('o mesmo evento em paralelo (webhook e varredura) é processado uma vez', async () => {
    let release;
    const eventando = { processEvent: vi.fn(() => new Promise((r) => { release = () => r({ transitioned: false }); })) };
    const { processEvent } = createOpaProcessor({ eventando, sendConfirmation: vi.fn(), log: quiet });
    const first = processEvent({ eventId: 'evt_1' });
    const second = await processEvent({ eventId: 'evt_1' });
    expect(second).toEqual({ skipped: true });
    release();
    await first;
    expect(eventando.processEvent).toHaveBeenCalledTimes(1);
  });

  it('varredura processa os pendentes e sobrevive a erro da listagem', async () => {
    const eventando = fakeEventando({ evt_paid: 'PAID' });
    eventando.pendingEvents.mockResolvedValueOnce([{ eventId: 'evt_paid', type: 'charge.paid' }]);
    const sendConfirmation = vi.fn();
    const { sweep } = createOpaProcessor({ eventando, sendConfirmation, log: quiet });
    expect(await sweep()).toEqual({ processed: 1 });
    expect(sendConfirmation).toHaveBeenCalledTimes(1);
    eventando.pendingEvents.mockRejectedValueOnce(new Error('HTTP 500'));
    expect(await sweep()).toEqual({ processed: 0 });
  });
});
