import { describe, expect, it, vi } from 'vitest';
import { createTermhubClient, parseRetryAfter } from './client';
import { TermhubError } from './errors';
import { errorResponse, jsonResponse, networkError, scriptedFetch, sseEvent, sseResponse } from './test-helpers';

const TOKEN = 'thp_very_secret_token_9999';
const make = (fetch, extra = {}) => {
  const sleep = vi.fn(async () => {});
  const client = createTermhubClient({ token: TOKEN, baseUrl: 'https://th.test', fetch, sleep, random: () => 1, ...extra });
  return { client, sleep };
};

describe('termhub client — requests', () => {
  it('creates a run with the bearer token, JSON body, under /api/v1', async () => {
    const fetch = scriptedFetch([jsonResponse(202, { run_id: 'r1', status: 'queued', events_url: '/api/v1/runs/r1/events' })]);
    const { client } = make(fetch);
    const body = { project: 'TER', prompt: 'x', capabilities: ['read'], idempotency_key: 'k1' };
    await expect(client.createRun(body)).resolves.toMatchObject({ run_id: 'r1', status: 'queued' });
    const [{ url, init }] = fetch.calls;
    expect(url).toBe('https://th.test/api/v1/runs');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual(body);
    expect(url).not.toContain(TOKEN);
  });

  it('lists runs with query params (used to test a token without spending a run)', async () => {
    const fetch = scriptedFetch([jsonResponse(200, { runs: [] })]);
    const { client } = make(fetch);
    await client.listRuns({ project: 'TER', limit: 1 });
    expect(fetch.calls[0].url).toBe('https://th.test/api/v1/runs?project=TER&limit=1');
    expect(fetch.calls[0].init.method).toBe('GET');
  });

  it('cancels with POST /runs/<id>/cancel', async () => {
    const fetch = scriptedFetch([jsonResponse(202, { run_id: 'r1', status: 'cancelled' })]);
    const { client } = make(fetch);
    await expect(client.cancelRun('r1')).resolves.toEqual({ run_id: 'r1', status: 'cancelled' });
    expect(fetch.calls[0].url).toBe('https://th.test/api/v1/runs/r1/cancel');
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'SCOPE_REQUIRED'],
    [404, 'NOT_FOUND'],
    [409, 'AGENT_OUTDATED'],
    [422, 'VALIDATION'],
  ])('does not retry a %i %s and throws it with the code', async (status, code) => {
    const fetch = scriptedFetch([errorResponse(status, code, 'detalhe')]);
    const { client, sleep } = make(fetch);
    const err = await client.createRun({}).catch((e) => e);
    expect(err).toBeInstanceOf(TermhubError);
    expect(err).toMatchObject({ status, code, message: 'detalhe' });
    expect(fetch.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('keeps the candidates of a 409 NO_ACCOUNT_AVAILABLE', async () => {
    const candidates = [{ account: 'a', machine: 'm', reason: 'limited' }];
    const fetch = scriptedFetch([errorResponse(409, 'NO_ACCOUNT_AVAILABLE', 'none', { candidates })]);
    const { client } = make(fetch);
    await expect(client.createRun({})).rejects.toMatchObject({ code: 'NO_ACCOUNT_AVAILABLE', candidates });
  });

  it('does not retry a 5xx (only 429 and network failures are retried)', async () => {
    const fetch = scriptedFetch([jsonResponse(503, 'oops')]);
    const { client } = make(fetch);
    await expect(client.getRun('r1')).rejects.toMatchObject({ status: 503, code: 'HTTP_503' });
    expect(fetch.calls).toHaveLength(1);
  });

  it('waits Retry-After on 429 and retries', async () => {
    const fetch = scriptedFetch([
      errorResponse(429, 'RATE_LIMITED', 'slow', {}, { 'retry-after': '7' }),
      jsonResponse(202, { run_id: 'r1', status: 'queued' }),
    ]);
    const { client, sleep } = make(fetch);
    await expect(client.createRun({ idempotency_key: 'k' })).resolves.toMatchObject({ run_id: 'r1' });
    expect(sleep).toHaveBeenCalledWith(7000, undefined);
    // Same body (same idempotency_key) on the retry.
    expect(fetch.calls[1].init.body).toBe(fetch.calls[0].init.body);
  });

  it('backs off exponentially on 429 without Retry-After, then gives up with RATE_LIMITED', async () => {
    const fetch = scriptedFetch(Array.from({ length: 5 }, () => errorResponse(429, 'RATE_LIMITED')));
    const { client, sleep } = make(fetch);
    await expect(client.listRuns({})).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000, 8000]);
  });

  it('gives up at once when Retry-After is longer than a minute, carrying retryAfter', async () => {
    const fetch = scriptedFetch([errorResponse(429, 'RATE_LIMITED', '', {}, { 'retry-after': '900' })]);
    const { client, sleep } = make(fetch);
    await expect(client.createRun({})).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 900 });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries network failures, then throws NETWORK without the token', async () => {
    const fetch = scriptedFetch([networkError(), jsonResponse(200, { status: 'running' })]);
    const { client } = make(fetch);
    await expect(client.getRun('r1')).resolves.toEqual({ status: 'running' });

    const failing = scriptedFetch(Array.from({ length: 5 }, networkError));
    const err = await make(failing).client.getRun('r1').catch((e) => e);
    expect(err).toMatchObject({ code: 'NETWORK' });
    expect(failing.calls).toHaveLength(5);
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain(TOKEN);
  });

  it('parses Retry-After as seconds or HTTP date', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('termhub client — run events (SSE)', () => {
  it('delivers every event, ignores keep-alives and ends at done', async () => {
    const fetch = scriptedFetch([sseResponse([
      ': keep-alive\n\n',
      sseEvent(1, 'started', { provider: 'claude', model: 'm' }),
      sseEvent(2, 'text_delta', { text: 'Ol' }),
      sseEvent(3, 'text', { text: 'Olá' }),
      sseEvent(4, 'done', { status: 'succeeded', result: 'Olá' }),
    ])]);
    const { client } = make(fetch);
    const events = [];
    const out = await client.streamEvents('r1', { onEvent: (e) => events.push(e) });
    expect(events.map((e) => e.type)).toEqual(['started', 'text_delta', 'text', 'done']);
    expect(out).toEqual({ lastSeq: 4, done: { status: 'succeeded', result: 'Olá' } });
    expect(fetch.calls[0].init.headers.Accept).toBe('text/event-stream');
    expect(fetch.calls[0].init.headers['Last-Event-ID']).toBeUndefined();
  });

  it('reconnects with Last-Event-ID after the connection drops, without repeating events', async () => {
    const fetch = scriptedFetch([
      sseResponse([sseEvent(1, 'started', {}), sseEvent(2, 'text', { text: 'a' })], { fail: networkError() }),
      networkError(),
      // The server may resend the last event; it is skipped.
      sseResponse([sseEvent(2, 'text', { text: 'a' }), sseEvent(3, 'done', { status: 'succeeded', result: 'a' })]),
    ]);
    const { client, sleep } = make(fetch);
    const events = [];
    const out = await client.streamEvents('r1', { onEvent: (e) => events.push(e) });
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(out.done.status).toBe('succeeded');
    expect(fetch.calls[1].init.headers['Last-Event-ID']).toBe('2');
    expect(fetch.calls[2].init.headers['Last-Event-ID']).toBe('2');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('reconnects when the stream ends cleanly before done', async () => {
    const fetch = scriptedFetch([
      sseResponse([sseEvent(1, 'started', {})]),
      sseResponse([sseEvent(2, 'done', { status: 'failed', result: null })]),
    ]);
    const { client } = make(fetch);
    const out = await client.streamEvents('r1');
    expect(out).toEqual({ lastSeq: 2, done: { status: 'failed', result: null } });
    expect(fetch.calls[1].init.headers['Last-Event-ID']).toBe('1');
  });

  it('resumes from a given seq (after a BFF restart)', async () => {
    const fetch = scriptedFetch([sseResponse([sseEvent(8, 'done', { status: 'cancelled' })])]);
    const { client } = make(fetch);
    await client.streamEvents('r1', { after: 7 });
    expect(fetch.calls[0].init.headers['Last-Event-ID']).toBe('7');
  });

  it('passes the error event and a failed done to the caller', async () => {
    const fetch = scriptedFetch([sseResponse([
      sseEvent(1, 'error', { code: 'agent_offline', message: 'offline' }),
      sseEvent(2, 'done', { status: 'failed', result: null }),
    ])]);
    const { client } = make(fetch);
    const events = [];
    const out = await client.streamEvents('r1', { onEvent: (e) => events.push(e) });
    expect(events[0]).toMatchObject({ type: 'error', data: { code: 'agent_offline' } });
    expect(out.done.status).toBe('failed');
  });

  it('gives up after too many drops in a row', async () => {
    const fetch = scriptedFetch(Array.from({ length: 4 }, networkError));
    const { client } = make(fetch, { maxReconnects: 3 });
    await expect(client.streamEvents('r1')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('throws contract errors of the stream (404) without retrying', async () => {
    const fetch = scriptedFetch([errorResponse(404, 'NOT_FOUND')]);
    const { client } = make(fetch);
    await expect(client.streamEvents('r1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fetch.calls).toHaveLength(1);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const fetch = scriptedFetch([() => { controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }]);
    const { client } = make(fetch);
    await expect(client.streamEvents('r1', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
