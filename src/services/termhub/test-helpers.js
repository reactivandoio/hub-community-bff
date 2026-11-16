// REA-51: fake termhub HTTP answers for the tests (no network).

export const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
  body: null,
});

export const errorResponse = (status, code, message = '', extra = {}, headers = {}) =>
  jsonResponse(status, { error: { code, message, ...extra } }, headers);

/** An SSE response whose body yields the given chunks (strings), then ends — or throws `fail`. */
export const sseResponse = (chunks, { fail } = {}) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'text/event-stream' },
  json: async () => ({}),
  body: (async function* body() {
    const encoder = new TextEncoder();
    for (const chunk of chunks) yield encoder.encode(chunk);
    if (fail) throw fail;
  }()),
});

export const sseEvent = (seq, type, data) => `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/** fetch that answers from a queue of responses (or functions of (url, init)) and records calls. */
export const scriptedFetch = (answers) => {
  const calls = [];
  const queue = [...answers];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch ${init.method || 'GET'} ${url}`);
    const answer = typeof next === 'function' ? next(url, init) : next;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  fn.calls = calls;
  fn.pending = () => queue.length;
  return fn;
};

export const networkError = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
