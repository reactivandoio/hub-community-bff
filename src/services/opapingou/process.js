// Processing of the saved Opa Pingou events, outside the webhook request.
//
// The Eventando does the real work (re-reads the charge with GET /v1/charges/{id} and
// applies the transition atomically), so a repeated or out-of-order event comes back
// with `transitioned: false` and nothing happens here. The confirmation e-mail goes
// out only when the payment has just become CONFIRMED — once.

const ALERT_TYPES = new Set(['payment.refunded', 'payment.charged_back']);

export const createOpaProcessor = ({
  eventando,
  sendConfirmation,
  alert = (message) => console.error(`[opapingou][ALERTA] ${message}`),
  log = console,
  olderThanSeconds = 60,
}) => {
  const inFlight = new Set();

  const processEvent = async ({ eventId, type = null }) => {
    if (!eventId || inFlight.has(eventId)) return { skipped: true };
    inFlight.add(eventId);
    try {
      if (ALERT_TYPES.has(type)) {
        alert(`evento ${eventId} (${type}): reembolso/contestação, tratar manualmente`);
      }
      let result;
      try {
        result = await eventando.processEvent(eventId);
      } catch (err) {
        // Stays pending in the Eventando: the sweep tries again.
        log.error(`[opapingou] evento ${eventId} não processado: ${err.message}`);
        return { error: true };
      }
      if (result?.alert && !ALERT_TYPES.has(type)) {
        alert(`evento ${eventId}: ${result.reason || result.status || 'verificar no Eventando'}`);
      }
      if (result?.transitioned && result.status === 'CONFIRMED' && result.payment) {
        try {
          await sendConfirmation(result.payment);
        } catch (err) {
          log.error(`[opapingou] e-mail de confirmação do evento ${eventId} falhou: ${err.message}`);
        }
      }
      return result || {};
    } finally {
      inFlight.delete(eventId);
    }
  };

  // Events saved but not processed (the process right after the webhook failed, or
  // the BFF restarted in between). One at a time.
  const sweep = async () => {
    let pending;
    try {
      pending = await eventando.pendingEvents(olderThanSeconds);
    } catch (err) {
      log.error(`[opapingou] varredura: ${err.message}`);
      return { processed: 0 };
    }
    const processed = await pending.reduce(async (countSoFar, item) => {
      const count = await countSoFar;
      const out = await processEvent(item);
      return !out?.skipped && !out?.error ? count + 1 : count;
    }, Promise.resolve(0));
    return { processed };
  };

  return { processEvent, sweep };
};

export default createOpaProcessor;
