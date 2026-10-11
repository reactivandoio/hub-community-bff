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

/**
 * Answers the Opa Pingou request; the event is only saved here (by Opa-Event-Id) and
 * processed afterwards by `schedule` / the sweep, so the 2xx goes out fast.
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
}) => {
  if (!isEnabled(env)) return reply(404, { error: 'not found' });

  // express.raw leaves `{}` when there is no body.
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === 'string' ? rawBody : '');
  const check = verifyOpaSignature({
    rawBody: raw,
    header: headerOf(headers, 'opa-signature'),
    secret: env.OPAPINGOU_WEBHOOK_SECRET,
    nowS,
  });
  if (!check.ok) {
    log.warn(`[opapingou] webhook recusado: assinatura ${check.reason}`);
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
