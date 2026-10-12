import { describe, it, expect, vi } from 'vitest';
import { createOpaPingouEventando } from './index';

const make = (responses) => {
  const http = { request: vi.fn() };
  responses.forEach((r) => (r instanceof Error ? http.request.mockRejectedValueOnce(r) : http.request.mockResolvedValueOnce(r)));
  return { http, client: createOpaPingouEventando({ baseUrl: 'https://ev.test', token: 'tok_integracao', http }) };
};

describe('Eventando: rotas do Opa Pingou', () => {
  it('grava o evento com o token de integração', async () => {
    const { http, client } = make([{ status: 201, data: { data: { id: 1 } } }]);
    expect(await client.saveEvent({ event_id: 'evt_1' })).toEqual({ duplicate: false });
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://ev.test/api/opapingou/events',
      data: { event_id: 'evt_1' },
      headers: expect.objectContaining({ Authorization: 'Bearer tok_integracao' }),
    }));
  });

  it('evento já gravado → duplicate', async () => {
    const { client } = make([{ status: 200, data: { duplicate: true } }]);
    expect(await client.saveEvent({ event_id: 'evt_1' })).toEqual({ duplicate: true });
  });

  it('erro HTTP ou de rede vira EventandoRequestError sem token nem corpo na mensagem', async () => {
    const { client } = make([{ status: 502, data: { secret: 'x' } }, new Error('ECONNRESET tok_integracao')]);
    const e1 = await client.saveEvent({}).catch((e) => e);
    expect(e1.status).toBe(502);
    const e2 = await client.saveEvent({}).catch((e) => e);
    expect(e2.status).toBeNull();
    expect(`${e1.message} ${e2.message}`).not.toContain('tok_integracao');
  });

  it('process: 404 (cobrança que não é nossa) → ignored', async () => {
    const { client } = make([{ status: 404, data: {} }]);
    expect(await client.processEvent('evt_1')).toEqual({ ignored: true, reason: 'not-found' });
  });

  it('process: devolve transitioned/status/payment', async () => {
    const out = { transitioned: true, status: 'CONFIRMED', payment: { id: 1 } };
    const { http, client } = make([{ status: 200, data: out }]);
    expect(await client.processEvent('evt/1')).toEqual(out);
    expect(http.request.mock.calls[0][0].url).toBe('https://ev.test/api/opapingou/events/evt%2F1/process');
  });

  it('pending: aceita ids soltos ou objetos', async () => {
    const { client } = make([{ status: 200, data: { data: ['e1', { event_id: 'e2', type: 'charge.paid' }] } }]);
    expect(await client.pendingEvents(60)).toEqual([
      { eventId: 'e1', type: null },
      { eventId: 'e2', type: 'charge.paid' },
    ]);
  });
});

describe('Eventando: conexões Opa Pingou (REA-12)', () => {
  const KEY = `opk_live_${'k'.repeat(43)}`;

  it('connect manda a chave só no corpo e devolve o resumo', async () => {
    const summary = { id: 'opc_1', company_name: 'Empresa', key_last4: 'kkkk' };
    const { http, client } = make([{ status: 200, data: { connection: summary } }]);
    expect(await client.connect({ eventUuid: 'ev-1', apiKey: KEY, createdBy: 'u-1', createdByName: 'Ana' })).toEqual(summary);
    const call = http.request.mock.calls[0][0];
    expect(call).toMatchObject({ method: 'POST', url: 'https://ev.test/api/opapingou/connections' });
    expect(call.data).toEqual({ event_uuid: 'ev-1', api_key: KEY, created_by: 'u-1', created_by_name: 'Ana' });
    expect(call.url).not.toContain(KEY);
    expect(call.timeout).toBeGreaterThanOrEqual(45000);
  });

  it('4xx com código vira OpaPingouConnectionError com a mensagem para a pessoa', async () => {
    const { client } = make([{ status: 400, data: { error: { code: 'MISSING_SCOPES', message: 'Faltam permissões', missing: ['charges:write'] } } }]);
    const err = await client.connect({ eventUuid: 'ev-1', apiKey: KEY }).catch((e) => e);
    expect(err.name).toBe('OpaPingouConnectionError');
    expect(err.code).toBe('MISSING_SCOPES');
    expect(err.message).toBe('Faltam permissões');
    expect(err.missing).toEqual(['charges:write']);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });

  it('500 ou rede: EventandoRequestError sem a chave', async () => {
    const { client } = make([{ status: 500, data: {} }, new Error(`boom ${KEY}`)]);
    const e1 = await client.connect({ eventUuid: 'ev-1', apiKey: KEY }).catch((e) => e);
    expect(e1.name).toBe('EventandoRequestError');
    const e2 = await client.connect({ eventUuid: 'ev-1', apiKey: KEY }).catch((e) => e);
    expect(e2.message).not.toContain(KEY);
  });

  it('verifyWebhook manda o corpo cru em base64 e a assinatura', async () => {
    const { http, client } = make([{ status: 200, data: { found: true, valid: true, test_mode: false } }]);
    const raw = Buffer.from('{ "id": "evt" }');
    expect(await client.verifyWebhook('opc_1', raw, 't=1,v1=ab')).toEqual({ found: true, valid: true, test_mode: false });
    const call = http.request.mock.calls[0][0];
    expect(call.url).toBe('https://ev.test/api/opapingou/connections/opc_1/verify');
    expect(Buffer.from(call.data.raw_body, 'base64').toString()).toBe('{ "id": "evt" }');
    expect(call.data.signature).toBe('t=1,v1=ab');
  });

  it('eventConnection, listConnections, attach e detach usam as rotas certas', async () => {
    const { http, client } = make([
      { status: 200, data: { connection: null, legacy: true } },
      { status: 200, data: { data: [{ id: 'opc_1', event_uuids: ['ev-1'] }] } },
      { status: 200, data: { connection: { id: 'opc_1' } } },
      { status: 200, data: { connection: null, legacy: false } },
    ]);
    expect(await client.eventConnection('ev-1')).toEqual({ connection: null, legacy: true });
    expect(await client.listConnections()).toEqual([{ id: 'opc_1', event_uuids: ['ev-1'] }]);
    expect(await client.attach('ev-1', 'opc_1')).toEqual({ id: 'opc_1' });
    expect(await client.detach('ev-1')).toEqual({ connection: null, legacy: false });
    expect(http.request.mock.calls.map(([c]) => `${c.method} ${c.url.replace('https://ev.test/api', '')}`)).toEqual([
      'GET /opapingou/connections/event/ev-1',
      'GET /opapingou/connections',
      'PUT /opapingou/connections/opc_1/events/ev-1',
      'DELETE /opapingou/connections/event/ev-1',
    ]);
  });
});
