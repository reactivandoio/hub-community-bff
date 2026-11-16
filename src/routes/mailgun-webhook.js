import express from 'express';
import { handleMailgunWebhook } from '../services/mailgun-events';

// REA-52: Mailgun's event webhook (delivered, opened, clicked, failed, complained, unsubscribed).
// Configure in Mailgun → Sending → Webhooks: https://<bff>/webhooks/mailgun. Signed with the
// account's HTTP webhook signing key (MAILGUN_WEBHOOK_SIGNING_KEY); without the key it answers 503.
export const MAILGUN_WEBHOOK_PATH = '/webhooks/mailgun';

export const mountMailgunWebhook = (app, { makeDataSources, env = process.env } = {}) => {
  app.post(MAILGUN_WEBHOOK_PATH, express.json({ limit: '256kb' }), async (req, res) => {
    try {
      const integration = makeDataSources({ 'accept-language': 'pt-br' }).managerIntegration;
      const { status, body } = await handleMailgunWebhook({ body: req.body, integration, env });
      res.status(status).json(body);
    } catch (err) {
      // 5xx: Mailgun tries again later.
      console.error(`[mailgun] erro no webhook: ${err.message}`);
      res.status(500).json({ error: 'internal error' });
    }
  });
};
