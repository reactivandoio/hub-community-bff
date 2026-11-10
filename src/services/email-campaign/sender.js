import { sendEmail } from '../email';
import { loadSignupEventDetails } from '../email/signup-confirmation';
import { deliveryKey, loadCandidates, loadEventSignups, screenCandidates } from './audience';
import { remainingToday, startOfDaySaoPaulo } from './quota';
import { buildCampaignEmail } from './render';

// REA-29: the campaign queue. Every minute it sends what today's quota allows (at most
// MAX_PER_TICK), oldest campaign first, and records each e-mail in Strapi before sending it, so a
// restart never sends one twice. Off unless EMAIL_CAMPAIGNS_ENABLED=true.
// EMAIL_CAMPAIGN_REDIRECT_TO sends everything to that address instead (tests, staging).

export const TICK_INTERVAL_MS = 60 * 1000;
export const MAX_PER_TICK = 20;

export const isEnabled = (env = process.env) =>
  String(env.EMAIL_CAMPAIGNS_ENABLED || '').toLowerCase() === 'true' && Boolean(env.EMAIL_UNSUBSCRIBE_SECRET);

/** Where the e-mail really goes: the redirect address, when set, with the person in the subject. */
export const addressFor = ({ email, subject }, env = process.env) => {
  const redirect = (env.EMAIL_CAMPAIGN_REDIRECT_TO || '').trim();
  if (!redirect) return { to: email, subject };
  return { to: redirect, subject: `[para ${email}] ${subject}` };
};

const deliver = async ({ dataSources, campaign, event, recipient, env, now, send }) => {
  const integration = dataSources.managerIntegration;
  let delivery;
  try {
    delivery = await integration.createEmailDelivery({
      key: deliveryKey(campaign.documentId, recipient.email),
      campaign_document_id: campaign.documentId,
      email: recipient.email,
      status: 'sending',
    });
  } catch (err) {
    // Unique key taken: another tick (or a run before a restart) already has this one.
    if (/unique/i.test(err.message || '')) return 'duplicate';
    // Strapi down or similar: stop this tick before moving the cursor past the person.
    throw err;
  }
  const email = buildCampaignEmail({ campaign, event, recipient, env });
  const { to, subject } = addressFor({ email: recipient.email, subject: email.subject }, env);
  const result = await send({ to, subject, html: email.html, headers: email.headers });
  const status = result?.success ? 'sent' : 'failed';
  try {
    await integration.updateEmailDelivery(delivery.documentId, {
      status, error: result?.success ? null : String(result?.error || 'erro'), sent_at: now.toISOString(),
    });
  } catch (err) {
    console.error(`[email-campaign] could not record delivery ${delivery.documentId}: ${err.message}`);
  }
  return status;
};

/** Sends up to `budget` e-mails of one campaign. Returns how many reached the SMTP. */
export const processCampaign = async ({ dataSources, campaign, budget, env, now, send }) => {
  const integration = dataSources.managerIntegration;
  const event = await loadSignupEventDetails({ dataSources, eventSlug: campaign.event_slug });
  const signups = await loadEventSignups(dataSources, campaign.event_slug);
  let { cursor = 0, sent = 0, failed = 0 } = campaign;
  let used = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { candidates, exhausted } = await loadCandidates({ dataSources, campaign: { ...campaign, cursor }, signups });
    // eslint-disable-next-line no-await-in-loop
    const screened = await screenCandidates({ dataSources, campaign, candidates, signups });
    let stopped = false;
    for (const candidate of screened) {
      if (!candidate.skip) {
        if (used >= budget) { stopped = true; break; }
        // eslint-disable-next-line no-await-in-loop
        const status = await deliver({ dataSources, campaign, event, recipient: candidate, env, now, send });
        if (status === 'sent') { sent += 1; used += 1; }
        if (status === 'failed') { failed += 1; used += 1; }
      }
      if (candidate.cursor) cursor = candidate.cursor;
    }
    const done = !stopped && exhausted;
    // eslint-disable-next-line no-await-in-loop
    await integration.updateEmailCampaign(campaign.documentId, {
      cursor, sent, failed, ...(done ? { status: 'done', finished_at: now.toISOString() } : {}),
    });
    if (stopped || done || candidates.length === 0) return used;
  }
};

/** One run of the queue. */
export const runTick = async ({
  dataSources, env = process.env, now = new Date(), send = sendEmail, maxPerTick = MAX_PER_TICK,
}) => {
  if (!isEnabled(env)) return { sent: 0 };
  const integration = dataSources.managerIntegration;
  const sentToday = await integration.countEmailDeliveriesSince(startOfDaySaoPaulo(now));
  let budget = Math.min(remainingToday({ sentToday, env }), maxPerTick);
  if (budget <= 0) return { sent: 0 };
  const campaigns = await integration.findSendingEmailCampaigns();
  let total = 0;
  for (const campaign of campaigns) {
    if (budget <= 0) break;
    try {
      // eslint-disable-next-line no-await-in-loop
      const used = await processCampaign({ dataSources, campaign, budget, env, now, send });
      budget -= used;
      total += used;
    } catch (err) {
      console.error(`[email-campaign] campaign ${campaign.documentId}: ${err.message}`);
    }
  }
  return { sent: total };
};

/** Every minute, one tick at a time. Off with the flag. */
export const startEmailCampaignSweep = (makeDataSources, { env = process.env, intervalMs = TICK_INTERVAL_MS } = {}) => {
  if (!isEnabled(env)) return null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { sent } = await runTick({ dataSources: makeDataSources({ 'accept-language': 'pt-br' }), env });
      if (sent) console.log(`[email-campaign] ${sent} e-mail(s) enviados`);
    } catch (err) {
      console.error(`[email-campaign] tick: ${err.message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
};
