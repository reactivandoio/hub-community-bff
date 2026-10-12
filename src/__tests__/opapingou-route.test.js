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

describe('POST /webhooks/opapingou/:connectionId (REA-12)', () => {
  const CONN = 'opc_abcdefghij123';
  const postTo = (id, body, headers = {}) =>
    fetch(`${base}/webhooks/opapingou/${id}`, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

  it('o Eventando confere com o segredo da conexão, sobre o corpo cru; grava com a conexão', async () => {
    eventando.saveEvent.mockClear();
    eventando.verifyWebhook = vi.fn().mockResolvedValue({ found: true, valid: true, test_mode: false });
    const sig = `t=${Math.floor(Date.now() / 1000)},v1=${'b'.repeat(64)}`;
    const res = await postTo(CONN, RAW, { 'opa-signature': sig, 'opa-event-id': 'evt_conn' });
    expect(res.status).toBe(200);
    const [id, raw, header] = eventando.verifyWebhook.mock.calls[0];
    expect(id).toBe(CONN);
    expect(Buffer.from(raw).toString('utf8')).toBe(RAW);
    expect(header).toBe(sig);
    expect(eventando.saveEvent).toHaveBeenCalledWith(expect.objectContaining({ event_id: 'evt_conn', connection: CONN }));
  });

  it('assinatura que não confere com a conexão: 401 sem gravar', async () => {
    eventando.saveEvent.mockClear();
    eventando.verifyWebhook = vi.fn().mockResolvedValue({ found: true, valid: false, reason: 'mismatch' });
    const res = await postTo(CONN, RAW, { 'opa-signature': signature(RAW) });
    expect(res.status).toBe(401);
    expect(eventando.saveEvent).not.toHaveBeenCalled();
  });

  it('a assinatura do segredo global não vale na URL de uma conexão', async () => {
    eventando.verifyWebhook = vi.fn().mockResolvedValue({ found: true, valid: false, reason: 'mismatch' });
    const res = await postTo(CONN, RAW, { 'opa-signature': signature(RAW) });
    expect(res.status).toBe(401);
  });

  it('conexão desconhecida: 404', async () => {
    eventando.verifyWebhook = vi.fn().mockResolvedValue({ found: false, valid: false });
    const res = await postTo(CONN, RAW, { 'opa-signature': signature(RAW) });
    expect(res.status).toBe(404);
  });

  it('id fora do formato: 404 sem perguntar ao Eventando', async () => {
    eventando.verifyWebhook = vi.fn();
    for (const id of ['x', 'opc_curto', `opc_${'a'.repeat(80)}`, 'opc_abc%2F..%2Fdef123']) {
      const res = await postTo(id, RAW, { 'opa-signature': signature(RAW) });
      expect(res.status).toBe(404);
    }
    expect(eventando.verifyWebhook).not.toHaveBeenCalled();
  });

  it('Eventando fora do ar ao conferir: 500 (o Opa Pingou reenvia) sem gravar', async () => {
    eventando.saveEvent.mockClear();
    eventando.verifyWebhook = vi.fn().mockRejectedValue(new Error('Eventando POST falhou (sem resposta)'));
    const res = await postTo(CONN, RAW, { 'opa-signature': signature(RAW) });
    expect(res.status).toBe(500);
    expect(eventando.saveEvent).not.toHaveBeenCalled();
  });
});

describe('limite de corpo da rota por conexão', () => {
  it('corpo acima de 512 KB: 413 sem perguntar ao Eventando', async () => {
    eventando.verifyWebhook = vi.fn();
    const big = JSON.stringify({ id: 'evt_big', pad: 'x'.repeat(600 * 1024) });
    const res = await fetch(`${base}/webhooks/opapingou/opc_abcdefghij123`, { method: 'POST', body: big, headers: { 'content-type': 'application/json', 'opa-signature': 't=1,v1=ab' } });
    expect(res.status).toBe(413);
    expect(eventando.verifyWebhook).not.toHaveBeenCalled();
  });
});
