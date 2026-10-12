/* eslint-disable import/no-extraneous-dependencies */
import express from 'express';
import { handleOpaWebhook, isEnabled } from '../services/opapingou/webhook';
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
 * Registers POST /webhooks/opapingou with the raw body. Must run before any JSON body
 * parser: the signature is over the exact bytes received.
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

  app.post(
    OPAPINGOU_WEBHOOK_PATH,
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req, res) => {
      try {
        const { status, body } = await handleOpaWebhook({
          rawBody: req.body,
          headers: req.headers,
          env,
          store: { save: (event) => eventando.saveEvent(event) },
          schedule: (item) => defer(() => proc.processEvent(item)),
        });
        res.status(status).json(body);
      } catch (err) {
        console.error(`[opapingou] erro no webhook: ${err.message}`);
        res.status(500).json({ error: 'internal error' });
      }
    },
  );

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
