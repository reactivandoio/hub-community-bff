import { GraphQLError } from 'graphql';
import { requireAdmin, requireEventOrganizer, requireUser } from '../../utils/auth';
import { sendEmail } from '../../services/email';
import { loadSignupEventDetails } from '../../services/email/signup-confirmation';
import { countAudience } from '../../services/email-campaign/audience';
import { dailyLimit, estimatedDays } from '../../services/email-campaign/quota';
import { buildCampaignEmail } from '../../services/email-campaign/render';
import { isEnabled } from '../../services/email-campaign/sender';
import { normalizeEmail, readUnsubscribeToken } from '../../services/email-campaign/token';

// REA-29: e-mail campaigns of an event. invite (whole base) is admin only; share and reminder,
// the event's organizers. The queue itself is services/email-campaign/sender.

export const MAX_SUBJECT = 150;
export const MAX_MESSAGE = 2000;
const ACTIVE = ['sending', 'paused'];

const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

/** Checks who may touch a campaign of this type, before any data source. */
export const requireCampaignAccess = async (ctx, eventSlug, type) => {
  requireUser(ctx);
  if (type === 'invite') {
    requireAdmin(ctx);
    return;
  }
  await requireEventOrganizer(ctx, eventSlug);
};

const cleanInput = ({ subject, message }) => {
  const s = String(subject || '').trim();
  const m = String(message || '').trim();
  if (s.length > MAX_SUBJECT) throw badInput(`O assunto pode ter até ${MAX_SUBJECT} caracteres.`);
  if (m.length > MAX_MESSAGE) throw badInput(`A mensagem pode ter até ${MAX_MESSAGE} caracteres.`);
  return { subject: s, message: m };
};

const loadEvent = async (ctx, eventSlug) => {
  const event = await ctx.dataSources.managerIntegration.findEventWithOrganizers(String(eventSlug));
  if (!event) throw badInput('Evento não encontrado.');
  return event;
};

// The preview shows a real-looking link without needing the secret of the server.
const previewEnv = (env) => (env.EMAIL_UNSUBSCRIBE_SECRET ? env : { ...env, EMAIL_UNSUBSCRIBE_SECRET: 'preview' });

const renderFor = async (ctx, input, env) => {
  const event = await loadEvent(ctx, input.eventSlug);
  const details = await loadSignupEventDetails({ dataSources: ctx.dataSources, eventSlug: event.slug });
  const { subject, message } = cleanInput(input);
  const campaign = { type: input.type, subject, message, event_slug: event.slug };
  const recipient = { email: ctx.user.email, name: ctx.user.name || ctx.user.username || '' };
  return { event, email: buildCampaignEmail({ campaign, event: details, recipient, env }) };
};

export const toCampaign = (row) => ({
  id: row.documentId,
  type: row.type,
  subject: row.subject || '',
  message: row.message || null,
  status: row.status,
  total: row.total || 0,
  sent: row.sent || 0,
  failed: row.failed || 0,
  created_by_email: row.created_by_email || null,
  started_at: row.started_at || null,
  finished_at: row.finished_at || null,
  createdAt: row.createdAt || null,
});

const NEXT_STATUS = {
  pause: { from: ['sending'], to: 'paused' },
  resume: { from: ['paused'], to: 'sending' },
  cancel: { from: ACTIVE, to: 'canceled' },
};

export const makeEmailCampaignResolvers = ({ env = process.env, send = sendEmail, now = () => new Date() } = {}) => ({
  Query: {
    eventEmailCampaigns: async (_, { eventSlug }, ctx) => {
      await requireEventOrganizer(ctx, eventSlug);
      const event = await loadEvent(ctx, eventSlug);
      const rows = await ctx.dataSources.managerIntegration.findEmailCampaignsByEvent(event.documentId);
      return rows.map(toCampaign);
    },

    emailCampaignAudience: async (_, { eventSlug, type }, ctx) => {
      await requireCampaignAccess(ctx, eventSlug, type);
      const event = await loadEvent(ctx, eventSlug);
      const { total, approximate } = await countAudience({ dataSources: ctx.dataSources, eventSlug: event.slug, type });
      return {
        total,
        approximate,
        daily_limit: dailyLimit(env),
        estimated_days: estimatedDays(total, env),
        sending_enabled: isEnabled(env),
        redirect_to: (env.EMAIL_CAMPAIGN_REDIRECT_TO || '').trim() || null,
      };
    },

    emailCampaignPreview: async (_, { input }, ctx) => {
      await requireCampaignAccess(ctx, input.eventSlug, input.type);
      const { email } = await renderFor(ctx, input, previewEnv(env));
      return { subject: email.subject, html: email.html };
    },
  },

  Mutation: {
    sendEmailCampaignTest: async (_, { input }, ctx) => {
      await requireCampaignAccess(ctx, input.eventSlug, input.type);
      if (!env.EMAIL_UNSUBSCRIBE_SECRET) throw badInput('Defina EMAIL_UNSUBSCRIBE_SECRET no servidor para enviar campanhas.');
      const { email } = await renderFor(ctx, input, env);
      const result = await send({ to: ctx.user.email, subject: `[teste] ${email.subject}`, html: email.html, headers: email.headers });
      if (!result?.success) throw new GraphQLError(`Não foi possível enviar o teste: ${result?.error || 'erro'}`);
      return true;
    },

    startEmailCampaign: async (_, { input }, ctx) => {
      await requireCampaignAccess(ctx, input.eventSlug, input.type);
      if (!isEnabled(env)) throw badInput('O envio de campanhas está desligado neste servidor.');
      const { subject, message } = cleanInput(input);
      const integration = ctx.dataSources.managerIntegration;
      const event = await loadEvent(ctx, input.eventSlug);
      const existing = await integration.findEmailCampaignsByEvent(event.documentId);
      if (existing.some((row) => row.type === input.type && ACTIVE.includes(row.status))) {
        throw badInput('Já existe uma campanha deste tipo em andamento para este evento.');
      }
      const { total } = await countAudience({ dataSources: ctx.dataSources, eventSlug: event.slug, type: input.type });
      if (!total) throw badInput('Ninguém para receber esta campanha.');
      const row = await integration.createEmailCampaign({
        event_document_id: event.documentId,
        event_slug: event.slug,
        event_title: event.title,
        type: input.type,
        subject,
        message,
        status: 'sending',
        total,
        sent: 0,
        failed: 0,
        cursor: 0,
        created_by_email: ctx.user.email,
        started_at: now().toISOString(),
      });
      return toCampaign(row);
    },

    updateEmailCampaignStatus: async (_, { eventSlug, id, action }, ctx) => {
      await requireEventOrganizer(ctx, eventSlug);
      const integration = ctx.dataSources.managerIntegration;
      const event = await loadEvent(ctx, eventSlug);
      const row = await integration.findEmailCampaign(id);
      if (!row || row.event_document_id !== event.documentId) throw badInput('Campanha não encontrada.');
      await requireCampaignAccess(ctx, eventSlug, row.type);
      const next = NEXT_STATUS[action];
      if (!next || !next.from.includes(row.status)) throw badInput('Esta campanha não pode mudar para esse estado.');
      if (next.to === 'sending' && !isEnabled(env)) throw badInput('O envio de campanhas está desligado neste servidor.');
      const updated = await integration.updateEmailCampaign(id, {
        status: next.to,
        ...(next.to === 'canceled' ? { finished_at: now().toISOString() } : {}),
      });
      return toCampaign({ ...row, ...updated });
    },

    unsubscribeEmail: async (_, { token }, ctx) => {
      const email = readUnsubscribeToken(token, env);
      if (!email) return false;
      const integration = ctx.dataSources.managerIntegration;
      if (await integration.findEmailSuppression(normalizeEmail(email))) return true;
      try {
        await integration.createEmailSuppression({ email, reason: 'unsubscribe', source: 'link' });
      } catch (err) {
        if (!/unique/i.test(err.message || '')) throw err;
      }
      return true;
    },
  },
});

export default makeEmailCampaignResolvers();
