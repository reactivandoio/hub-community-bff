import crypto from 'crypto';

// REA-52: Mailgun's webhook tells what happened to each e-mail after it left (delivered, opened,
// clicked, failed, spam complaint, unsubscribe). Each event is added to the e-mail's record (the
// `email-campaign-delivery` row whose message_id it names), which the admin shows as a timeline.
//
// Mailgun signs every request: signature = HMAC-SHA256(signing key, timestamp + token), hex. The key
// is the "HTTP webhook signing key" of the Mailgun account, in MAILGUN_WEBHOOK_SIGNING_KEY. Without
// it the webhook is off. The account is shared with other systems: an event of an e-mail the Hub did
// not send is answered 200 and ignored (anything else makes Mailgun retry).

export const MAX_EVENTS = 50;
const MAX_TEXT = 300;

/** The events kept; anything else (e.g. "stored") is ignored. */
export const KNOWN_EVENTS = new Set([
  'accepted', 'delivered', 'opened', 'clicked', 'failed', 'complained', 'unsubscribed',
]);

export const signingKey = (env = process.env) => String(env.MAILGUN_WEBHOOK_SIGNING_KEY || '').trim();

/** Constant-time check of Mailgun's signature. */
export const verifySignature = (key, signature) => {
  const { timestamp, token, signature: given } = signature || {};
  if (!key || !timestamp || !token || typeof given !== 'string' || !/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = crypto.createHmac('sha256', key).update(`${timestamp}${token}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given.toLowerCase(), 'hex'));
};

const text = (value) => {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, MAX_TEXT) : null;
};

const bareMessageId = (value) => text(String(value ?? '').replace(/^<|>$/g, ''));

/**
 * The part of Mailgun's `event-data` worth keeping, or null for an event we do not track.
 * No IP, location or device: only what says what happened to the e-mail.
 */
export const parseEvent = (data) => {
  if (!data || !KNOWN_EVENTS.has(data.event)) return null;
  const messageId = bareMessageId(data.message?.headers?.['message-id']);
  if (!messageId) return null;
  const seconds = Number(data.timestamp);
  const status = data['delivery-status'] || {};
  return {
    messageId,
    event: {
      id: text(data.id),
      event: data.event,
      severity: data.event === 'failed' ? text(data.severity) : null,
      reason: data.event === 'failed' ? text(data.reason) : null,
      message: data.event === 'failed' ? text(status.description || status.message) : null,
      url: data.event === 'clicked' ? text(data.url) : null,
      at: new Date(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now()).toISOString(),
    },
  };
};

/**
 * The record's new events (oldest first, each Mailgun event once, at most MAX_EVENTS) and its last
 * event. Returns null when the event was already there (Mailgun retries).
 */
export const applyEvent = (row, event) => {
  const events = Array.isArray(row?.events) ? row.events : [];
  if (event.id && events.some((e) => e?.id === event.id)) return null;
  const next = [...events, event]
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-MAX_EVENTS);
  const last = next[next.length - 1];
  return { events: next, last_event: last.event, last_event_at: last.at };
};

// Events of one message are applied one at a time here (delivered and opened often arrive
// together), so neither overwrites the other. The bff runs as one process.
const queues = new Map();
const serialized = (key, task) => {
  const run = (queues.get(key) || Promise.resolve()).then(task, task);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
};

/**
 * Handles one webhook request. Resolves { status, body } for the HTTP answer.
 * `integration` needs findEmailDeliveryByMessageId and updateEmailDelivery.
 */
export const handleMailgunWebhook = async ({ body, integration, env = process.env }) => {
  const key = signingKey(env);
  if (!key) return { status: 503, body: { error: 'webhook off' } };
  if (!verifySignature(key, body?.signature)) return { status: 401, body: { error: 'invalid signature' } };

  const parsed = parseEvent(body?.['event-data']);
  if (!parsed) return { status: 200, body: { ok: true, ignored: 'event' } };

  return serialized(parsed.messageId, async () => {
    const row = await integration.findEmailDeliveryByMessageId(parsed.messageId);
    if (!row) return { status: 200, body: { ok: true, ignored: 'message' } };
    const patch = applyEvent(row, parsed.event);
    if (!patch) return { status: 200, body: { ok: true, duplicate: true } };
    await integration.updateEmailDelivery(row.documentId, patch);
    return { status: 200, body: { ok: true } };
  });
};
