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
