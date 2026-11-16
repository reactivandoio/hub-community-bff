import { describe, expect, it, vi } from 'vitest';
import { createTermhubClient } from './client';
import { createTermhubService, LIMITS } from './generations';
import { errorResponse, jsonResponse, networkError, scriptedFetch, sseEvent, sseResponse } from './test-helpers';

const TOKEN = 'thp_admin_personal_token_ABCD';
const env = { TERMHUB_TOKEN_KEY: Buffer.alloc(32, 3).toString('base64'), TERMHUB_URL: 'https://th.test' };
const USER = { id: 9, email: 'adm@hub.io' };
const EVENT = { documentId: 'ev-1', slug: 'meetup' };
const NOW = new Date('2026-11-15T12:00:00Z');
const DRAFT = { subject: '📣 Vem pro Meetup', message: 'Parágrafo um.\n\nParágrafo dois.' };

// In-memory api::termhub-credential and api::ai-text-run.
const fakeIntegration = () => {
  const credentials = [];
  const runs = [];
  let n = 0;
  return {
    credentials,
    runs,
    findTermhubCredential: vi.fn(async (userId) => credentials.find((c) => c.user_id === Number(userId)) || null),
    createTermhubCredential: vi.fn(async (data) => { const row = { documentId: `c${n += 1}`, ...data }; credentials.push(row); return row; }),
    updateTermhubCredential: vi.fn(async (id, data) => Object.assign(credentials.find((c) => c.documentId === id), data)),
    deleteTermhubCredential: vi.fn(async (id) => { credentials.splice(credentials.findIndex((c) => c.documentId === id), 1); return true; }),
    findAiTextRun: vi.fn(async (id) => { const r = runs.find((x) => x.documentId === id); return r ? { ...r } : null; }),
    findAiTextRunByKey: vi.fn(async (key) => runs.find((x) => x.idempotency_key === key) || null),
    findAiTextRunsOfUserSince: vi.fn(async (userId, date) => runs.filter((r) => r.user_id === Number(userId) && Date.parse(r.createdAt) >= date.getTime())),
    createAiTextRun: vi.fn(async (data) => { const row = { documentId: `g${n += 1}`, createdAt: NOW.toISOString(), ...data }; runs.push(row); return { ...row }; }),
    updateAiTextRun: vi.fn(async (id, data) => Object.assign(runs.find((r) => r.documentId === id), data)),
  };
};

const setup = (answers, { integration = fakeIntegration(), keys = ['req-1'] } = {}) => {
  const fetch = scriptedFetch(answers);
  const log = { error: vi.fn(), warn: vi.fn() };
  const queue = [...keys];
  const service = createTermhubService({
    env,
    now: () => NOW,
    newKey: () => queue.shift() || 'k-extra',
    makeClient: (token) => createTermhubClient({ token, env, fetch, sleep: async () => {}, random: () => 1 }),
    log,
  });
  return { service, fetch, integration, log };
};

const saveCredential = async (integration) => {
  const { service } = setup([jsonResponse(200, { runs: [] })], { integration });
  await service.saveSettings(integration, USER, { token: TOKEN, project: 'TER' });
};

const created = (runId = 'run-1') => jsonResponse(202, { run_id: runId, status: 'queued', events_url: `/api/v1/runs/${runId}/events` });
const succeeded = (from = 1, result = JSON.stringify(DRAFT)) => sseResponse([
  sseEvent(from, 'started', { provider: 'claude', model: 'm' }),
  sseEvent(from + 1, 'text', { text: result }),
  sseEvent(from + 2, 'usage', { input_tokens: 10, output_tokens: 20, cost_usd: 0.01 }),
  sseEvent(from + 3, 'done', { status: 'succeeded', result }),
]);

const startArgs = { event: EVENT, type: 'invite', prompt: 'PROMPT', requestId: 'req-1' };

describe('termhub settings', () => {
  it('tests the token on the project without spending a run, then saves it encrypted', async () => {
    const integration = fakeIntegration();
    const { service, fetch } = setup([jsonResponse(200, { runs: [] })], { integration });
    const out = await service.saveSettings(integration, USER, { token: ` ${TOKEN} `, project: 'TER' });

    expect(fetch.calls[0].url).toBe('https://th.test/api/v1/runs?project=TER&limit=1');
    expect(fetch.calls[0].init.method).toBe('GET');
    expect(out).toEqual({
      configured: true, token_hint: '…ABCD', project: 'TER', verified_at: NOW.toISOString(), server_ready: true, base_url: 'https://th.test',
    });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    const [row] = integration.credentials;
    expect(row).toMatchObject({ user_id: 9, project: 'TER', token_hint: '…ABCD' });
    expect(row.token_ciphertext).not.toContain(TOKEN);
  });

  it.each([
    [401, 'UNAUTHENTICATED', 'TERMHUB_TOKEN_INVALID'],
    [403, 'SCOPE_REQUIRED', 'TERMHUB_TOKEN_SCOPE'],
    [404, 'NOT_FOUND', 'TERMHUB_NOT_FOUND'],
  ])('does not save when termhub answers %i %s', async (status, code, gqlCode) => {
    const integration = fakeIntegration();
    const { service } = setup([errorResponse(status, code, 'x')], { integration });
    await expect(service.saveSettings(integration, USER, { token: TOKEN, project: 'TER' }))
      .rejects.toMatchObject({ extensions: { code: gqlCode } });
    expect(integration.credentials).toHaveLength(0);
  });

  it('changes only the project with the saved token, and tests it again', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, fetch } = setup([jsonResponse(200, { runs: [] })], { integration });
    const out = await service.saveSettings(integration, USER, { project: 'HUB' });
    expect(fetch.calls[0].init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(out).toMatchObject({ project: 'HUB', token_hint: '…ABCD' });
  });

  it('validates the input and needs the server key', async () => {
    const integration = fakeIntegration();
    const { service } = setup([]);
    await expect(service.saveSettings(integration, USER, { project: 'TER' })).rejects.toThrow(/Cole o token/);
    await expect(service.saveSettings(integration, USER, { token: 'a b c d e f g h', project: 'TER' })).rejects.toThrow(/não parece válido/);
    await expect(service.saveSettings(integration, USER, { token: TOKEN, project: 'with space' })).rejects.toThrow(/projeto/);
    const noKey = createTermhubService({ env: {}, now: () => NOW });
    await expect(noKey.saveSettings(integration, USER, { token: TOKEN, project: 'TER' }))
      .rejects.toMatchObject({ extensions: { code: 'TERMHUB_SERVER_NOT_READY' } });
  });

  it('reports a stored token that the server key cannot open', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const other = createTermhubService({ env: { ...env, TERMHUB_TOKEN_KEY: Buffer.alloc(32, 4).toString('base64') }, now: () => NOW });
    await expect(other.testSettings(integration, USER)).rejects.toMatchObject({ extensions: { code: 'TERMHUB_TOKEN_UNREADABLE' } });
  });

  it('tests and removes the saved credential', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service } = setup([jsonResponse(200, { runs: [] })], { integration });
    await expect(service.testSettings(integration, USER)).resolves.toMatchObject({ configured: true });
    await expect(service.deleteSettings(integration, USER)).resolves.toMatchObject({ configured: false, token_hint: null });
    expect(integration.credentials).toHaveLength(0);
  });
});

describe('termhub generations', () => {
  it('refuses without a saved token', async () => {
    const { service, integration } = setup([]);
    await expect(service.start(integration, USER, startArgs)).rejects.toMatchObject({ extensions: { code: 'TERMHUB_NOT_CONFIGURED' } });
  });

  it('creates a read-only run with an idempotency key and returns the draft when it succeeds', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, fetch } = setup([created(), succeeded()], { integration });

    const first = await service.start(integration, USER, startArgs);
    expect(first).toMatchObject({ status: 'queued', campaign_type: 'invite', subject: null });
    const body = JSON.parse(fetch.calls[0].init.body);
    expect(body).toEqual({
      project: 'TER',
      prompt: 'PROMPT',
      capabilities: ['read'],
      model_class: 'default',
      budget: { timeout_s: 300 },
      idempotency_key: 'hub-ai-9-req-1',
    });
    expect(fetch.calls[1].url).toBe('https://th.test/api/v1/runs/run-1/events');

    await service.settled(first.id);
    const out = await service.get(integration, USER, first.id);
    expect(out).toMatchObject({ status: 'succeeded', subject: DRAFT.subject, message: DRAFT.message, error_code: null });
    expect(integration.runs[0]).toMatchObject({ run_id: 'run-1', status: 'succeeded', last_seq: 4, finished_at: NOW.toISOString() });
  });

  it('shows the text while the run streams', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const slow = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: (async function* body() {
        const enc = new TextEncoder();
        yield enc.encode(sseEvent(1, 'started', {}));
        yield enc.encode(sseEvent(2, 'text_delta', { text: '{"subject": "Vem' }));
        await gate;
        yield enc.encode(sseEvent(3, 'done', { status: 'succeeded', result: JSON.stringify(DRAFT) }));
      }()),
    };
    const { service } = setup([created(), slow], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await new Promise((r) => { setTimeout(r, 5); });
    expect(await service.get(integration, USER, id)).toMatchObject({ status: 'running', preview: '{"subject": "Vem' });
    release();
    await service.settled(id);
    expect(await service.get(integration, USER, id)).toMatchObject({ status: 'succeeded' });
  });

  it('keeps going after the stream drops (reconnects with Last-Event-ID)', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, fetch } = setup([
      created(),
      sseResponse([sseEvent(1, 'started', {})], { fail: networkError() }),
      sseResponse([sseEvent(2, 'done', { status: 'succeeded', result: JSON.stringify(DRAFT) })]),
    ], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    expect(fetch.calls[2].init.headers['Last-Event-ID']).toBe('1');
    expect(await service.get(integration, USER, id)).toMatchObject({ status: 'succeeded', subject: DRAFT.subject });
  });

  it.each([
    ['agent_offline', 'offline', /offline/],
    ['account_limited', 'limit', /limite de uso/],
    ['timeout', '', /tempo limite/],
    ['permission_denied', '', /negou a permissão/],
    ['cli_failed', 'boom', /falhou ao rodar/],
  ])('settles a done/failed after an error event %s', async (code, message, expected) => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service } = setup([created(), sseResponse([
      sseEvent(1, 'started', {}),
      sseEvent(2, 'error', { code, message }),
      sseEvent(3, 'done', { status: 'failed', result: null }),
    ])], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    const out = await service.get(integration, USER, id);
    expect(out).toMatchObject({ status: 'failed', error_code: code, subject: null });
    expect(out.error_message).toMatch(expected);
  });

  it('fails clearly when the model answers outside the JSON format', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service } = setup([created(), succeeded(1, 'Não posso ajudar.')], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    expect(await service.get(integration, USER, id)).toMatchObject({ status: 'failed', error_code: 'invalid_output' });
  });

  it('repeats a run ended by a termhub restart with the same idempotency key', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, fetch } = setup([
      created('run-1'),
      sseResponse([
        sseEvent(1, 'started', {}),
        sseEvent(2, 'error', { code: 'cli_failed', message: 'server restarted' }),
        sseEvent(3, 'done', { status: 'failed', result: null }),
      ]),
      created('run-2'),
      succeeded(),
    ], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    expect(fetch.calls[2].init.body).toBe(fetch.calls[0].init.body);
    expect(fetch.calls[3].url).toBe('https://th.test/api/v1/runs/run-2/events');
    expect(fetch.calls[3].init.headers['Last-Event-ID']).toBeUndefined();
    expect(await service.get(integration, USER, id)).toMatchObject({ status: 'succeeded', subject: DRAFT.subject });
    expect(integration.runs[0].run_id).toBe('run-2');
  });

  it('settles as failed when the repeat returns the same failed run', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service } = setup([
      created('run-1'),
      sseResponse([sseEvent(1, 'error', { code: 'cli_failed', message: 'server restarted' }), sseEvent(2, 'done', { status: 'failed' })]),
      created('run-1'),
    ], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    const out = await service.get(integration, USER, id);
    expect(out).toMatchObject({ status: 'failed', error_code: 'cli_failed' });
    expect(out.error_message).toMatch(/reiniciou/);
  });

  it.each([
    [errorResponse(409, 'NO_ACCOUNT_AVAILABLE', 'x', { candidates: [{ account: 'a', machine: 'm', reason: 'limite atingido' }] }), 'TERMHUB_NO_ACCOUNT', /limite atingido/],
    [errorResponse(409, 'AGENT_OUTDATED', 'x'), 'TERMHUB_AGENT_OUTDATED', /desatualizado/],
    [errorResponse(422, 'VALIDATION', 'prompt too long'), 'TERMHUB_VALIDATION', /prompt too long/],
    [errorResponse(401, 'UNAUTHENTICATED'), 'TERMHUB_TOKEN_INVALID', /token/],
  ])('reports a refused run and records it as failed (%#)', async (answer, code, message) => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, fetch } = setup([answer], { integration });
    const err = await service.start(integration, USER, startArgs).catch((e) => e);
    expect(err.extensions.code).toBe(code);
    expect(err.message).toMatch(message);
    expect(fetch.calls).toHaveLength(1);
    expect(integration.runs[0]).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(err)).not.toContain(TOKEN);
  });

  it('waits out a 429 on create and goes on', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, fetch } = setup([errorResponse(429, 'RATE_LIMITED', '', {}, { 'retry-after': '2' }), created(), succeeded()], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    expect(JSON.parse(fetch.calls[1].init.body).idempotency_key).toBe('hub-ai-9-req-1');
    expect(await service.get(integration, USER, id)).toMatchObject({ status: 'succeeded' });
  });

  it('returns the same generation for a repeated request id, without a second run', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, fetch } = setup([created(), succeeded()], { integration });
    const first = await service.start(integration, USER, startArgs);
    const again = await service.start(integration, USER, startArgs);
    expect(again.id).toBe(first.id);
    await service.settled(first.id);
    expect(fetch.calls.filter((c) => c.init.method === 'POST')).toHaveLength(1);
  });

  it(`refuses a third run while ${LIMITS.concurrent} are active`, async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    integration.runs.push(
      { documentId: 'a', user_id: 9, run_id: 'r-a', status: 'running', createdAt: new Date(NOW - 60_000).toISOString() },
      { documentId: 'b', user_id: 9, run_id: 'r-b', status: 'queued', createdAt: new Date(NOW - 30_000).toISOString() },
    );
    const { service, fetch } = setup([], { integration });
    await expect(service.start(integration, USER, startArgs)).rejects.toMatchObject({ extensions: { code: 'TERMHUB_BUSY' } });
    expect(fetch.calls).toHaveLength(0);
  });

  it('does not count a stale active row (its BFF died) against the concurrent limit', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    integration.runs.push(
      { documentId: 'a', user_id: 9, run_id: 'r-a', status: 'running', createdAt: new Date(NOW - 40 * 60_000).toISOString() },
      { documentId: 'b', user_id: 9, run_id: 'r-b', status: 'running', createdAt: new Date(NOW - 30_000).toISOString() },
    );
    const { service } = setup([created(), succeeded()], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
  });

  it(`refuses the ${LIMITS.perHour + 1}th run of the hour with retryAfter`, async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    for (let i = 0; i < LIMITS.perHour; i += 1) {
      integration.runs.push({ documentId: `x${i}`, user_id: 9, run_id: `r${i}`, status: 'succeeded', createdAt: new Date(NOW - (50 - i) * 60_000).toISOString() });
    }
    const { service, fetch } = setup([], { integration });
    const err = await service.start(integration, USER, startArgs).catch((e) => e);
    expect(err.extensions).toEqual({ code: 'TERMHUB_HOURLY_LIMIT', retryAfter: 600 });
    expect(fetch.calls).toHaveLength(0);
  });

  it('cancels: POST /cancel, stops following, settles as cancelled', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const never = { ok: true, status: 200, headers: { get: () => null }, body: (async function* body() { yield new TextEncoder().encode(sseEvent(1, 'started', {})); await new Promise(() => {}); }()) };
    const { service, fetch } = setup([created(), never, jsonResponse(202, { run_id: 'run-1', status: 'cancelled' })], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    const out = await service.cancel(integration, USER, id);
    expect(out.status).toBe('cancelled');
    expect(fetch.calls[2]).toMatchObject({ url: 'https://th.test/api/v1/runs/run-1/cancel', init: { method: 'POST' } });
    expect(integration.runs[0].status).toBe('cancelled');
  });

  it('settles a run the server reports cancelled', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service } = setup([created(), sseResponse([sseEvent(1, 'done', { status: 'cancelled' })])], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    expect(await service.get(integration, USER, id)).toMatchObject({ status: 'cancelled' });
  });

  it('follows an active run again after a BFF restart, from the saved seq', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    integration.runs.push({
      documentId: 'g-old', user_id: 9, run_id: 'run-7', status: 'running', last_seq: 5, campaign_type: 'reminder', createdAt: NOW.toISOString(),
    });
    const { service, fetch } = setup([sseResponse([sseEvent(6, 'done', { status: 'succeeded', result: JSON.stringify(DRAFT) })])], { integration });
    expect(await service.get(integration, USER, 'g-old')).toMatchObject({ status: 'running' });
    expect(fetch.calls[0].init.headers['Last-Event-ID']).toBe('5');
    await service.settled('g-old');
    expect(await service.get(integration, USER, 'g-old')).toMatchObject({ status: 'succeeded', subject: DRAFT.subject });
  });

  it('settles as failed when termhub no longer knows the run', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    integration.runs.push({ documentId: 'g-old', user_id: 9, run_id: 'run-7', status: 'running', last_seq: 0, createdAt: NOW.toISOString() });
    const { service } = setup([errorResponse(404, 'NOT_FOUND')], { integration });
    await service.get(integration, USER, 'g-old');
    await service.settled('g-old');
    expect(await service.get(integration, USER, 'g-old')).toMatchObject({ status: 'failed', error_code: 'NOT_FOUND' });
  });

  it('only shows a generation to whoever started it', async () => {
    const integration = fakeIntegration();
    integration.runs.push({ documentId: 'g1', user_id: 9, status: 'succeeded' });
    const { service } = setup([]);
    await expect(service.get(integration, { id: 10 }, 'g1')).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    await expect(service.cancel(integration, { id: 10 }, 'g1')).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
  });

  it('never logs the token', async () => {
    const integration = fakeIntegration();
    await saveCredential(integration);
    const { service, log } = setup([created(), ...Array.from({ length: 11 }, networkError)], { integration });
    const { id } = await service.start(integration, USER, startArgs);
    await service.settled(id);
    expect(log.warn).toHaveBeenCalled();
    const logged = JSON.stringify([...log.warn.mock.calls, ...log.error.mock.calls]);
    expect(logged).not.toContain(TOKEN);
    // A network give-up leaves the run active: the next poll follows it again.
    expect(integration.runs[0].status).toBe('queued');
  });
});
