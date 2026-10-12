import { verifyOpaSignature } from './signature';

// Events whose effect is applied by the Eventando (it re-reads the charge first).
export const HANDLED_TYPES = new Set([
  'charge.paid',
  'charge.expired',
  'charge.canceled',
  'payment.confirmed',
  'payment.refunded',
  'payment.charged_back',
]);

export const isEnabled = (env = process.env) => String(env.OPAPINGOU_ENABLED || '').toLowerCase() === 'true';

const acceptsTestMode = (env) => String(env.OPAPINGOU_ACCEPT_TEST_MODE || '').toLowerCase() === 'true';

const headerOf = (headers, name) => {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

// The charge the event is about. charge.*: data.object is the charge. payment.*: the
// payment object is not documented, so only the usual spellings of its charge id.
export const chargeIdOf = (event) => {
  const object = event?.data?.object || {};
  if (String(event?.type || '').startsWith('charge.')) return object.id || null;
  return object.chargeId || object.charge_id || object.charge?.id
    || (typeof object.charge === 'string' ? object.charge : null) || null;
};

const reply = (status, body) => ({ status, body });

// Public id of a connection in the webhook URL (REA-12): /webhooks/opapingou/<id>.
export const CONNECTION_ID_PATTERN = /^opc_[A-Za-z0-9_-]{10,64}$/;

// The old URL (no id): the global secret from the env, for the events still on the global key.
const envVerifier = (env) => async ({ rawBody, header, nowS }) =>
  verifyOpaSignature({ rawBody, header, secret: env.OPAPINGOU_WEBHOOK_SECRET, nowS });

// A connection URL: the Eventando checks with that account's secret (it never leaves there).
export const connectionVerifier = (eventando, connectionId) => async ({ rawBody, header }) => {
  const result = await eventando.verifyWebhook(connectionId, rawBody, header);
  if (!result?.found) return { ok: false, reason: 'unknown-connection', notFound: true };
  return result.valid ? { ok: true } : { ok: false, reason: result.reason || 'mismatch' };
};

/**
 * Answers the Opa Pingou request; the event is only saved here (by Opa-Event-Id) and
 * processed afterwards by `schedule` / the sweep, so the 2xx goes out fast.
 * `connection` (REA-12) is the public id from the URL; then `verify` checks the signature with
 * that account's secret and the event is saved with it, so the Eventando re-reads the charge
 * with that account's key.
 *
 * @returns {Promise<{ status: number, body: object }>}
 */
export const handleOpaWebhook = async ({
  rawBody,
  headers,
  env = process.env,
  nowS = Math.floor(Date.now() / 1000),
  store,
  schedule,
  log = console,
  connection = null,
  verify = envVerifier(env),
}) => {
  if (!isEnabled(env)) return reply(404, { error: 'not found' });

  // express.raw leaves `{}` when there is no body.
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === 'string' ? rawBody : '');
  let check;
  try {
    check = await verify({ rawBody: raw, header: headerOf(headers, 'opa-signature'), nowS });
  } catch (err) {
    // Could not check (Eventando down): a 5xx makes the Opa Pingou send it again.
    log.error(`[opapingou] assinatura não conferida${connection ? ` (conexão ${connection})` : ''}: ${err.message}`);
    return reply(500, { error: 'could not verify' });
  }
  if (check.notFound) {
    log.warn(`[opapingou] webhook para conexão desconhecida ${connection}`);
    return reply(404, { error: 'not found' });
  }
  if (!check.ok) {
    log.warn(`[opapingou] webhook recusado${connection ? ` (conexão ${connection})` : ''}: assinatura ${check.reason}`);
    return reply(401, { error: 'invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return reply(400, { error: 'invalid json' });
  }

  const eventId = headerOf(headers, 'opa-event-id') || event?.id;
  const type = event?.type || headerOf(headers, 'opa-event-type');
  if (type === 'ping') return reply(200, { received: true, ignored: 'ping' });
  if (!eventId || !type) return reply(400, { error: 'missing event id or type' });
  if (!HANDLED_TYPES.has(type)) return reply(200, { received: true, ignored: 'type' });
  if (event.testMode === true && !acceptsTestMode(env)) {
    log.info(`[opapingou] evento ${eventId} (${type}) de teste ignorado`);
    return reply(200, { received: true, ignored: 'test-mode' });
  }

  let saved;
  try {
    saved = await store.save({
      event_id: String(eventId),
      type,
      test_mode: event.testMode === true,
      charge_id: chargeIdOf(event),
      payload: event,
      ...(connection ? { connection } : {}),
    });
  } catch (err) {
    // Not saved: a 5xx makes the Opa Pingou send it again.
    log.error(`[opapingou] evento ${eventId} (${type}) não foi gravado: ${err.message}`);
    return reply(500, { error: 'could not store event' });
  }

  if (saved?.duplicate) return reply(200, { received: true, duplicate: true });

  schedule({ eventId: String(eventId), type });
  return reply(200, { received: true });
};

export default handleOpaWebhook;
