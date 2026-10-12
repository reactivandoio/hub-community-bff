/* eslint-disable import/no-extraneous-dependencies */
import express from 'express';
import {
  handleOpaWebhook, isEnabled, connectionVerifier, CONNECTION_ID_PATTERN,
} from '../services/opapingou/webhook';
import { createOpaProcessor } from '../services/opapingou/process';
import { createOpaPingouEventando } from '../dataSources/eventando-manager/opapingou';
import { sendSignupConfirmation } from '../services/email/signup-confirmation';
import { signupIdOf } from '../utils/signup-id';

export const OPAPINGOU_WEBHOOK_PATH = '/webhooks/opapingou';
const SWEEP_INTERVAL_MS = 60 * 1000;

// "Inscrição confirmada" with the ticket, for the payment the Eventando just confirmed.
export const confirmationSender = (makeDataSources) => async (payment) => {
  const signup = payment?.signup || {};
  const event = payment?.event || {};
  const result = await sendSignupConfirmation({
    dataSources: makeDataSources({ 'accept-language': 'pt-br' }),
    eventSlug: event.slug || event.uuid,
    eventandoEvent: event,
    signupId: signupIdOf(signup),
    name: signup.name,
    email: signup.email,
    phone: signup.phone_number || null,
    isFree: false,
    isPaid: true,
  });
  if (!result?.success) throw new Error(result?.error || 'e-mail não enviado');
};

/**
 * Registers POST /webhooks/opapingou (global key, env secret) and, REA-12,
 * POST /webhooks/opapingou/:connectionId (the URL registered in each community's account;
 * the Eventando checks the signature with that account's secret). Raw body on both: must run
 * before any JSON body parser, the signature is over the exact bytes received.
 */
export const mountOpaPingouWebhook = (app, {
  env = process.env,
  eventando = createOpaPingouEventando(),
  processor,
  makeDataSources,
  defer = (fn) => setImmediate(fn),
} = {}) => {
  const proc = processor || createOpaProcessor({
    eventando,
    sendConfirmation: confirmationSender(makeDataSources),
  });

  const handle = (connection) => async (req, res) => {
    try {
      const { status, body } = await handleOpaWebhook({
        rawBody: req.body,
        headers: req.headers,
        env,
        connection,
        ...(connection ? { verify: connectionVerifier(eventando, connection) } : {}),
        store: { save: (event) => eventando.saveEvent(event) },
        schedule: (item) => defer(() => proc.processEvent(item).catch((err) => {
          console.error(`[opapingou] processamento do evento ${item.eventId}: ${err.message}`);
        })),
      });
      res.status(status).json(body);
    } catch (err) {
      console.error(`[opapingou] erro no webhook: ${err.message}`);
      res.status(500).json({ error: 'internal error' });
    }
  };

  const raw = express.raw({ type: '*/*', limit: '1mb' });
  app.post(OPAPINGOU_WEBHOOK_PATH, raw, handle(null));
  app.post(`${OPAPINGOU_WEBHOOK_PATH}/:connectionId`, raw, (req, res) => {
    const { connectionId } = req.params;
    // Not an id we hand out: answer like an unknown route, without asking the Eventando.
    if (!CONNECTION_ID_PATTERN.test(connectionId || '')) return res.status(404).json({ error: 'not found' });
    return handle(connectionId)(req, res);
  });

  return proc;
};

// Every minute, the events the Eventando still has pending. Off with the flag.
export const startOpaPingouSweep = (
  processor,
  { env = process.env, intervalMs = SWEEP_INTERVAL_MS } = {},
) => {
  if (!isEnabled(env)) return null;
  const timer = setInterval(() => {
    processor.sweep().catch((err) => console.error(`[opapingou] varredura: ${err.message}`));
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
};
