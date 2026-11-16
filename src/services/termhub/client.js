import { createSSEParser } from './sse';
import { TermhubError } from './errors';

// REA-51: client of the termhub runs API (contract in the REA-51 card). Only GET and POST under
// /api/v1. The token goes only in the Authorization header: never in a URL, a log line or an error.
// Retries only on 429 (Retry-After, else exponential backoff) and on network failures; every other
// answer is thrown as a TermhubError with the contract's code. A POST /runs is safe to repeat because
// it always carries an idempotency_key.

export const DEFAULT_BASE_URL = 'https://termhub.dev';
const MAX_WAIT_MS = 60 * 1000;

export const baseUrlOf = (env = process.env) => String(env.TERMHUB_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');

const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  }, { once: true });
});

/** Seconds (integer) or an HTTP date; null when absent or unreadable. In ms. */
export const parseRetryAfter = (value, now = Date.now()) => {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
};

const isAbort = (err, signal) => signal?.aborted || err?.name === 'AbortError';

async function* chunksOf(body) {
  if (!body) return;
  if (typeof body[Symbol.asyncIterator] === 'function') {
    yield* body;
    return;
  }
  const reader = body.getReader();
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

const readError = async (res) => {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const error = body?.error || {};
  return new TermhubError({
    status: res.status,
    code: typeof error.code === 'string' ? error.code : `HTTP_${res.status}`,
    message: typeof error.message === 'string' ? error.message : '',
    candidates: Array.isArray(error.candidates) ? error.candidates : null,
    retryAfter: res.status === 429 ? Math.ceil((parseRetryAfter(res.headers?.get?.('retry-after')) ?? 0) / 1000) || null : null,
  });
};

export const createTermhubClient = ({
  token,
  env = process.env,
  baseUrl = baseUrlOf(env),
  fetch = globalThis.fetch,
  sleep = defaultSleep,
  random = Math.random,
  maxRetries = 4,
  maxReconnects = 10,
} = {}) => {
  if (!token) throw new TermhubError({ code: 'UNAUTHENTICATED', message: 'sem token' });

  const backoff = (attempt) => Math.min(30000, 1000 * 2 ** attempt) * (0.5 + random() / 2);

  // How long to wait before retrying a 429, or null to give up now.
  const rateLimitWait = (res, attempt) => {
    const header = parseRetryAfter(res.headers?.get?.('retry-after'));
    const wait = header ?? backoff(attempt);
    return wait > MAX_WAIT_MS ? null : wait;
  };

  const request = async (method, path, { body, signal } = {}) => {
    const url = `${baseUrl}/api/v1${path}`;
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        // eslint-disable-next-line no-await-in-loop
        res = await fetch(url, {
          method,
          signal,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (err) {
        if (isAbort(err, signal)) throw err;
        if (attempt >= maxRetries) throw new TermhubError({ code: 'NETWORK', message: 'falha de rede' });
        // eslint-disable-next-line no-await-in-loop
        await sleep(backoff(attempt), signal);
        // eslint-disable-next-line no-continue
        continue;
      }
      if (res.ok) {
        // eslint-disable-next-line no-await-in-loop
        return res.status === 204 ? null : res.json();
      }
      if (res.status === 429 && attempt < maxRetries) {
        const wait = rateLimitWait(res, attempt);
        if (wait !== null) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(wait, signal);
          // eslint-disable-next-line no-continue
          continue;
        }
      }
      // eslint-disable-next-line no-await-in-loop
      throw await readError(res);
    }
  };

  /**
   * Reads the run's events until `done`, reconnecting with Last-Event-ID after a drop. No read
   * timeout (a run may take an hour; keep-alives come every 15 s). Closing the stream does not
   * cancel the run. Resolves { lastSeq, done } where done is the `done` event's data.
   */
  const streamEvents = async (runId, { after = 0, onEvent = () => {}, signal } = {}) => {
    let lastSeq = Number(after) || 0;
    let failures = 0;
    const url = `${baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events`;
    for (;;) {
      let done = null;
      let res;
      try {
        // eslint-disable-next-line no-await-in-loop
        res = await fetch(url, {
          method: 'GET',
          signal,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
            ...(lastSeq ? { 'Last-Event-ID': String(lastSeq) } : {}),
          },
        });
        if (!res.ok) {
          if (res.status === 429 && failures < maxReconnects) {
            const wait = rateLimitWait(res, failures);
            failures += 1;
            // eslint-disable-next-line no-await-in-loop
            await sleep(wait ?? MAX_WAIT_MS, signal);
            // eslint-disable-next-line no-continue
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          throw await readError(res);
        }
        const parser = createSSEParser((message) => {
          const seq = Number(message.id);
          if (Number.isFinite(seq) && seq > 0) {
            if (seq <= lastSeq) return; // already seen before a reconnect
            lastSeq = seq;
          }
          let data = {};
          try {
            data = message.data ? JSON.parse(message.data) : {};
          } catch {
            data = { raw: message.data };
          }
          failures = 0;
          if (message.event === 'done') done = data;
          onEvent({ seq: lastSeq, type: message.event, data });
        });
        // eslint-disable-next-line no-restricted-syntax, no-await-in-loop
        for await (const chunk of chunksOf(res.body)) {
          parser.feed(chunk);
          if (done) break;
        }
        if (done) return { lastSeq, done };
        // The stream ended without `done`: the connection dropped. Reconnect from lastSeq.
      } catch (err) {
        if (isAbort(err, signal)) throw err;
        if (err instanceof TermhubError) throw err;
        if (done) return { lastSeq, done };
      }
      failures += 1;
      if (failures > maxReconnects) throw new TermhubError({ code: 'NETWORK', message: 'conexão com o termhub caiu' });
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoff(failures - 1), signal);
    }
  };

  return {
    /** POST /runs → { run_id, status, events_url }. */
    createRun: (input, opts) => request('POST', '/runs', { ...opts, body: input }),
    getRun: (runId, opts) => request('GET', `/runs/${encodeURIComponent(runId)}`, opts),
    listRuns: ({ project, status, limit } = {}, opts) => {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      if (status) params.set('status', status);
      if (limit) params.set('limit', String(limit));
      return request('GET', `/runs?${params.toString()}`, opts);
    },
    cancelRun: (runId, opts) => request('POST', `/runs/${encodeURIComponent(runId)}/cancel`, opts),
    streamEvents,
  };
};
