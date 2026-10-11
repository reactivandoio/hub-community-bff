import crypto from 'crypto';
import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mountOpaPingouWebhook, startOpaPingouSweep, confirmationSender } from '../routes/opapingou-webhook';
import { sendSignupConfirmation } from '../services/email/signup-confirmation';

vi.mock('../services/email/signup-confirmation', () => ({ sendSignupConfirmation: vi.fn() }));

const SECRET = 'whsec_teste_rota';
const env = { OPAPINGOU_ENABLED: 'true', OPAPINGOU_WEBHOOK_SECRET: SECRET };

// Corpo com espaços, quebras de linha e acentos: se algo reserializar, a assinatura falha.
const RAW = '{ "id": "evt_rota",\n  "type": "charge.paid", "testMode": false,\n  "data": { "type": "charge", "object": { "id": "chg_1", "description": "Inscrição — São João" } } }';
const signature = (raw, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', SECRET).update(`${t}.`).update(raw).digest('hex')}`;

let server;
let base;
const eventando = { saveEvent: vi.fn().mockResolvedValue({ duplicate: false }) };
const processor = { processEvent: vi.fn().mockResolvedValue({}), sweep: vi.fn() };

const startApp = async (appEnv) => {
  const app = express();
  mountOpaPingouWebhook(app, { env: appEnv, eventando, processor, defer: (fn) => fn() });
  // O Apollo do BFF vem depois, com o parser JSON: não pode tocar na rota acima.
  app.use('/', bodyParser.json(), (req, res) => res.status(400).json({ apollo: true }));
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, url: `http://127.0.0.1:${srv.address().port}` };
};

const post = (url, body, headers = {}) =>
  fetch(`${url}/webhooks/opapingou`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

beforeAll(async () => {
  ({ srv: server, url: base } = await startApp(env));
});
afterAll(() => new Promise((r) => server.close(r)));

describe('POST /webhooks/opapingou', () => {
  it('confere a assinatura sobre o corpo cru (espaços e acentos) e agenda o processamento', async () => {
    const res = await post(base, RAW, { 'opa-signature': signature(RAW), 'opa-event-id': 'evt_rota' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(eventando.saveEvent).toHaveBeenCalledWith(expect.objectContaining({ event_id: 'evt_rota', charge_id: 'chg_1' }));
    expect(processor.processEvent).toHaveBeenCalledWith({ eventId: 'evt_rota', type: 'charge.paid' });
  });

  it('funciona com qualquer content-type', async () => {
    const res = await post(base, RAW, { 'content-type': 'text/plain', 'opa-signature': signature(RAW) });
    expect(res.status).toBe(200);
  });

  it('assinatura inválida: 401', async () => {
    eventando.saveEvent.mockClear();
    const res = await post(base, RAW, { 'opa-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}` });
    expect(res.status).toBe(401);
    expect(eventando.saveEvent).not.toHaveBeenCalled();
  });

  it('timestamp vencido: 401', async () => {
    const res = await post(base, RAW, { 'opa-signature': signature(RAW, Math.floor(Date.now() / 1000) - 600) });
    expect(res.status).toBe(401);
  });

  it('corpo vazio: 401', async () => {
    const res = await post(base, '', {});
    expect(res.status).toBe(401);
  });

  it('o resto do app segue com o parser JSON', async () => {
    const res = await fetch(`${base}/`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(await res.json()).toEqual({ apollo: true });
  });

  it('flag desligada: 404', async () => {
    const off = await startApp({ OPAPINGOU_WEBHOOK_SECRET: SECRET });
    const res = await post(off.url, RAW, { 'opa-signature': signature(RAW) });
    expect(res.status).toBe(404);
    await new Promise((r) => off.srv.close(r));
  });
});

describe('startOpaPingouSweep', () => {
  it('não liga com a flag desligada', () => {
    expect(startOpaPingouSweep(processor, { env: {} })).toBeNull();
  });
  it('chama a varredura a cada intervalo', () => {
    vi.useFakeTimers();
    const p = { sweep: vi.fn().mockResolvedValue({}) };
    const timer = startOpaPingouSweep(p, { env, intervalMs: 1000 });
    vi.advanceTimersByTime(2500);
    expect(p.sweep).toHaveBeenCalledTimes(2);
    clearInterval(timer);
    vi.useRealTimers();
  });
});

describe('confirmationSender', () => {
  it('manda o e-mail com ingresso (isPaid) para a inscrição confirmada', async () => {
    sendSignupConfirmation.mockResolvedValue({ success: true });
    const makeDataSources = vi.fn(() => ({ ds: true }));
    await confirmationSender(makeDataSources)({
      id: 5,
      signup: { id: 9, name: 'Ana', email: 'ana@x.io', phone_number: '62999' },
      event: { id: 3, uuid: 'u1', slug: 'meetup' },
    });
    expect(sendSignupConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      eventSlug: 'meetup', signupId: '9', email: 'ana@x.io', isFree: false, isPaid: true,
    }));
  });
  it('falha do envio vira erro (o processador registra)', async () => {
    sendSignupConfirmation.mockResolvedValue({ success: false, error: 'smtp' });
    await expect(confirmationSender(() => ({}))({ signup: { id: 1, email: 'a@b.c' }, event: {} })).rejects.toThrow('smtp');
  });
});
