import { describe, it, expect, vi } from 'vitest';
import resolvers from './index';
import { OpaPingouConnectionError } from '../../dataSources/eventando-manager/opapingou';

const KEY = `opk_live_${'k'.repeat(43)}`;
const ADMIN = { id: 9, documentId: 'u-admin', role: { type: 'admin' } };
const ANA = { id: 1, documentId: 'u-ana', username: 'ana', name: 'Ana', role: { type: 'community-manager' } };

// Ana organizes ev-1 and ev-2; ev-x belongs to another community.
const EVENTS = {
  'ev-1': { documentId: 'ev-1', slug: 'meetup', communities: [{ organizers: [{ documentId: 'u-ana' }] }] },
  meetup: { documentId: 'ev-1', slug: 'meetup', communities: [{ organizers: [{ documentId: 'u-ana' }] }] },
  'ev-2': { documentId: 'ev-2', communities: [{ organizers: [{ documentId: 'u-ana' }] }] },
  'ev-x': { documentId: 'ev-x', communities: [{ organizers: [{ documentId: 'u-other' }] }] },
};

const summary = (id, over = {}) => ({
  id,
  company_name: `Empresa ${id}`,
  company_document: '**.***.***/0001-90',
  test_mode: false,
  key_last4: 'kkkk',
  created_by: 'u-someone',
  created_by_name: 'Alguém',
  created_at: '2026-10-12T00:00:00.000Z',
  event_uuids: [],
  ...over,
});

const ALL = [
  summary('opc_mine', { created_by: 'u-ana' }),
  summary('opc_on_my_event', { event_uuids: ['ev-x', 'ev-2'] }),
  summary('opc_other', { event_uuids: ['ev-x'] }),
];

const ctxFor = (user, eventando) => ({
  user,
  opaPingouEventando: eventando,
  dataSources: {
    managerIntegration: { findEventWithOrganizers: vi.fn(async (id) => EVENTS[id] || null) },
  },
});

const fakeEventando = (over = {}) => ({
  eventConnection: vi.fn().mockResolvedValue({ connection: null, legacy: false }),
  listConnections: vi.fn().mockResolvedValue(ALL),
  connect: vi.fn().mockResolvedValue(summary('opc_new', { created_by: 'u-ana' })),
  attach: vi.fn(async (_, id) => summary(id)),
  detach: vi.fn().mockResolvedValue({ connection: null, legacy: false }),
  ...over,
});

const { Query, Mutation } = resolvers;

describe('eventOpaPingouAccount', () => {
  it('community-manager vê só as contas que conectou ou que estão em eventos que organiza', async () => {
    const out = await Query.eventOpaPingouAccount(null, { eventId: 'meetup' }, ctxFor(ANA, fakeEventando()));
    expect(out.available).toBe(true);
    expect(out.reusable.map((c) => c.id)).toEqual(['opc_mine', 'opc_on_my_event']);
  });

  it('admin vê todas', async () => {
    const out = await Query.eventOpaPingouAccount(null, { eventId: 'ev-1' }, ctxFor(ADMIN, fakeEventando()));
    expect(out.reusable.map((c) => c.id)).toEqual(['opc_mine', 'opc_on_my_event', 'opc_other']);
  });

  it('usa o documentId do evento como uuid do Eventando, mesmo recebendo o slug', async () => {
    const eventando = fakeEventando();
    await Query.eventOpaPingouAccount(null, { eventId: 'meetup' }, ctxFor(ANA, eventando));
    expect(eventando.eventConnection).toHaveBeenCalledWith('ev-1');
  });

  it('evento que ainda não existe no Eventando: available false', async () => {
    const eventando = fakeEventando({
      eventConnection: vi.fn().mockRejectedValue(new OpaPingouConnectionError({ code: 'EVENT_NOT_FOUND', status: 404 })),
    });
    const out = await Query.eventOpaPingouAccount(null, { eventId: 'ev-1' }, ctxFor(ANA, eventando));
    expect(out).toEqual({ connection: null, legacy: false, available: false, reusable: [] });
  });

  it('o resumo não traz ids internos nem a lista de eventos', async () => {
    const eventando = fakeEventando({ eventConnection: vi.fn().mockResolvedValue({ connection: ALL[0], legacy: false }) });
    const out = await Query.eventOpaPingouAccount(null, { eventId: 'ev-1' }, ctxFor(ANA, eventando));
    expect(out.connection).toEqual({
      id: 'opc_mine',
      companyName: 'Empresa opc_mine',
      companyDocument: '**.***.***/0001-90',
      testMode: false,
      keyLast4: 'kkkk',
      createdByName: 'Alguém',
      createdAt: '2026-10-12T00:00:00.000Z',
    });
  });
});

describe('connectEventOpaPingou', () => {
  it('manda a chave ao Eventando com quem conectou e nunca a devolve', async () => {
    const eventando = fakeEventando();
    const out = await Mutation.connectEventOpaPingou(null, { eventId: 'ev-1', apiKey: `  ${KEY} ` }, ctxFor(ANA, eventando));
    expect(eventando.connect).toHaveBeenCalledWith({ eventUuid: 'ev-1', apiKey: KEY, createdBy: 'u-ana', createdByName: 'Ana' });
    expect(out.connection.id).toBe('opc_new');
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('erro do Eventando vira erro GraphQL com código e permissões que faltam', async () => {
    const eventando = fakeEventando({
      connect: vi.fn().mockRejectedValue(new OpaPingouConnectionError({ code: 'MISSING_SCOPES', message: 'Faltam permissões', missing: ['charges:write'] })),
    });
    const err = await Mutation.connectEventOpaPingou(null, { eventId: 'ev-1', apiKey: KEY }, ctxFor(ANA, eventando)).catch((e) => e);
    expect(err.message).toBe('Faltam permissões');
    expect(err.extensions).toMatchObject({ code: 'OPAPINGOU_MISSING_SCOPES', missing: ['charges:write'] });
  });

  it('falha inesperada vira OPAPINGOU_UNAVAILABLE sem a chave na mensagem', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const eventando = fakeEventando({ connect: vi.fn().mockRejectedValue(new Error('Eventando POST /opapingou/connections falhou (HTTP 500)')) });
    const err = await Mutation.connectEventOpaPingou(null, { eventId: 'ev-1', apiKey: KEY }, ctxFor(ANA, eventando)).catch((e) => e);
    expect(err.extensions.code).toBe('OPAPINGOU_UNAVAILABLE');
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
    log.mockRestore();
  });

  it('evento de outra comunidade: FORBIDDEN sem chamar o Eventando', async () => {
    const eventando = fakeEventando();
    const err = await Mutation.connectEventOpaPingou(null, { eventId: 'ev-x', apiKey: KEY }, ctxFor(ANA, eventando)).catch((e) => e);
    expect(err.extensions.code).toBe('FORBIDDEN');
    expect(eventando.connect).not.toHaveBeenCalled();
  });
});

describe('useOpaPingouConnection', () => {
  it('liga uma conta que a pessoa pode reutilizar', async () => {
    const eventando = fakeEventando();
    const out = await Mutation.useOpaPingouConnection(null, { eventId: 'ev-1', connectionId: 'opc_on_my_event' }, ctxFor(ANA, eventando));
    expect(eventando.attach).toHaveBeenCalledWith('ev-1', 'opc_on_my_event');
    expect(out.connection.id).toBe('opc_on_my_event');
  });

  it('conta de outra comunidade: FORBIDDEN sem ligar', async () => {
    const eventando = fakeEventando();
    const err = await Mutation.useOpaPingouConnection(null, { eventId: 'ev-1', connectionId: 'opc_other' }, ctxFor(ANA, eventando)).catch((e) => e);
    expect(err.extensions.code).toBe('FORBIDDEN');
    expect(eventando.attach).not.toHaveBeenCalled();
  });
});

describe('disconnectEventOpaPingou', () => {
  it('pagamento em aberto: erro com a quantidade', async () => {
    const eventando = fakeEventando({
      detach: vi.fn().mockRejectedValue(new OpaPingouConnectionError({ code: 'PENDING_PAYMENTS', message: 'Há pagamentos em aberto', count: 2 })),
    });
    const err = await Mutation.disconnectEventOpaPingou(null, { eventId: 'ev-1' }, ctxFor(ANA, eventando)).catch((e) => e);
    expect(err.extensions).toMatchObject({ code: 'OPAPINGOU_PENDING_PAYMENTS', count: 2 });
  });

  it('solta o evento', async () => {
    const out = await Mutation.disconnectEventOpaPingou(null, { eventId: 'ev-1' }, ctxFor(ANA, fakeEventando()));
    expect(out.connection).toBeNull();
    expect(out.legacy).toBe(false);
  });
});
