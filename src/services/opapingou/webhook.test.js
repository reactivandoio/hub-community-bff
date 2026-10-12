import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import { handleOpaWebhook, chargeIdOf } from './webhook';

const SECRET = 'whsec_teste_local';
const NOW = 1_800_000_000;
const env = { OPAPINGOU_ENABLED: 'true', OPAPINGOU_WEBHOOK_SECRET: SECRET };
const quiet = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

const charge = (status = 'PAID') => ({ id: 'chg_1', status, amountCents: 100 });
const eventBody = (over = {}) => ({
  id: 'evt_1',
  type: 'charge.paid',
  occurredAt: '2026-10-11T12:00:00Z',
  testMode: false,
  data: { type: 'charge', object: charge() },
  ...over,
});

const signed = (body, { t = NOW, secret = SECRET } = {}) => {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, 1));
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  return { raw, headers: { 'opa-signature': `t=${t},v1=${v1}`, 'opa-event-id': JSON.parse(raw).id } };
};

const run = (body, opts = {}) => {
  const { raw, headers } = signed(body, opts);
  const store = { save: opts.save || vi.fn().mockResolvedValue({ duplicate: false }) };
  const schedule = vi.fn();
  return handleOpaWebhook({
    rawBody: opts.rawBody || raw,
    headers: opts.headers || headers,
    env: opts.env || env,
    nowS: opts.nowS || NOW,
    store,
    schedule,
    log: quiet,
  }).then((out) => ({ ...out, store, schedule }));
};

describe('handleOpaWebhook', () => {
  it('assinatura válida: grava o evento, responde 200 e agenda o processamento', async () => {
    const out = await run(eventBody());
    expect(out.status).toBe(200);
    expect(out.store.save).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'evt_1', type: 'charge.paid', test_mode: false, charge_id: 'chg_1',
    }));
    expect(out.schedule).toHaveBeenCalledWith({ eventId: 'evt_1', type: 'charge.paid' });
  });

  it('assinatura inválida: 401 e nada é gravado', async () => {
    const out = await run(eventBody(), { secret: 'whsec_outro' });
    expect(out.status).toBe(401);
    expect(out.store.save).not.toHaveBeenCalled();
    expect(out.schedule).not.toHaveBeenCalled();
  });

  it('corpo adulterado depois de assinado: 401', async () => {
    const { headers } = signed(eventBody());
    const out = await run(eventBody(), { headers, rawBody: Buffer.from(JSON.stringify(eventBody({ type: 'charge.expired' }))) });
    expect(out.status).toBe(401);
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('sem header de assinatura: 401', async () => {
    const out = await run(eventBody(), { headers: { 'opa-event-id': 'evt_1' } });
    expect(out.status).toBe(401);
  });

  it('timestamp vencido (mais de 300 s): 401', async () => {
    const out = await run(eventBody(), { t: NOW - 301 });
    expect(out.status).toBe(401);
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('evento repetido: 200 sem novo agendamento', async () => {
    const out = await run(eventBody(), { save: vi.fn().mockResolvedValue({ duplicate: true }) });
    expect(out.status).toBe(200);
    expect(out.body.duplicate).toBe(true);
    expect(out.schedule).not.toHaveBeenCalled();
  });

  it('ping: 200 sem gravar', async () => {
    const out = await run(eventBody({ id: 'evt_ping', type: 'ping', data: {} }));
    expect(out.status).toBe(200);
    expect(out.body.ignored).toBe('ping');
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('tipo que não tratamos (bank_account.*): 200 ignorado sem gravar', async () => {
    const out = await run(eventBody({ type: 'bank_account.updated', data: { type: 'bank_account', object: {} } }));
    expect(out.status).toBe(200);
    expect(out.body.ignored).toBe('type');
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('testMode em produção: 200 ignorado sem gravar', async () => {
    const out = await run(eventBody({ testMode: true }));
    expect(out.status).toBe(200);
    expect(out.body.ignored).toBe('test-mode');
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('testMode aceito quando OPAPINGOU_ACCEPT_TEST_MODE=true', async () => {
    const out = await run(eventBody({ testMode: true }), { env: { ...env, OPAPINGOU_ACCEPT_TEST_MODE: 'true' } });
    expect(out.status).toBe(200);
    expect(out.store.save).toHaveBeenCalledWith(expect.objectContaining({ test_mode: true }));
  });

  it('falha ao gravar no Eventando: 500 (o Opa Pingou reenvia) e não agenda', async () => {
    const out = await run(eventBody(), { save: vi.fn().mockRejectedValue(new Error('Eventando POST /opapingou/events falhou (HTTP 502)')) });
    expect(out.status).toBe(500);
    expect(out.schedule).not.toHaveBeenCalled();
  });

  it('flag desligada: 404 sem nem conferir a assinatura', async () => {
    const out = await run(eventBody(), { env: { OPAPINGOU_WEBHOOK_SECRET: SECRET } });
    expect(out.status).toBe(404);
    expect(out.store.save).not.toHaveBeenCalled();
  });

  it('flag ligada sem segredo configurado: 401', async () => {
    const out = await run(eventBody(), { env: { OPAPINGOU_ENABLED: 'true' } });
    expect(out.status).toBe(401);
  });

  it('nenhuma linha de log tem o segredo', async () => {
    const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const { raw, headers } = signed(eventBody(), { secret: 'whsec_errado' });
    await handleOpaWebhook({ rawBody: raw, headers, env, nowS: NOW, store: { save: vi.fn() }, schedule: vi.fn(), log });
    const lines = [...log.warn.mock.calls, ...log.info.mock.calls, ...log.error.mock.calls].flat().join('\n');
    expect(lines).not.toContain(SECRET);
    expect(lines).not.toContain('whsec_');
  });
});

describe('chargeIdOf', () => {
  it('charge.*: id do objeto', () => {
    expect(chargeIdOf({ type: 'charge.expired', data: { object: { id: 'chg_9' } } })).toBe('chg_9');
  });
  it('payment.confirmed: só se trouxer o id da cobrança', () => {
    expect(chargeIdOf({ type: 'payment.confirmed', data: { object: { id: 'pay_1', chargeId: 'chg_2' } } })).toBe('chg_2');
    expect(chargeIdOf({ type: 'payment.confirmed', data: { object: { id: 'pay_1', charge: { id: 'chg_3' } } } })).toBe('chg_3');
    expect(chargeIdOf({ type: 'payment.confirmed', data: { object: { id: 'pay_1' } } })).toBeNull();
  });
});
