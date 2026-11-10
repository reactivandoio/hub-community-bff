import { defaultSubject, eventCampaignTemplate } from '../email/templates/event-campaign';
import { shareRef, unsubscribeToken } from './token';

// REA-29: subject, HTML and headers of one campaign e-mail — the same for the preview, the test
// e-mail and the queue.

const frontendUrl = (env) => (env.FRONTEND_URL || 'https://hubcommunity.io').replace(/\/$/, '');

export const eventUrlFor = (env, slug, type) =>
  `${frontendUrl(env)}/events/${encodeURIComponent(slug)}?utm_source=email&utm_medium=email&utm_campaign=${type}`;

export const shareUrlFor = (env, slug, email) =>
  `${frontendUrl(env)}/events/${encodeURIComponent(slug)}?ref=${shareRef(email, slug, env)}`;

export const unsubscribeUrlFor = (env, token) => `${frontendUrl(env)}/descadastro?t=${encodeURIComponent(token)}`;

// RFC 8058 one-click: mail clients POST to this URL (route handler of the frontend).
export const oneClickUrlFor = (env, token) => `${frontendUrl(env)}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;

/**
 * @param {{ type: string, subject?: string, message?: string, event_slug: string }} campaign
 * @param {{ title: string, dateStr?: string, timeStr?: string, locationStr?: string }} event
 * @param {{ email: string, name?: string }} recipient
 */
export const buildCampaignEmail = ({ campaign, event, recipient, env = process.env }) => {
  const slug = campaign.event_slug;
  const token = unsubscribeToken(recipient.email, env);
  const html = eventCampaignTemplate({
    type: campaign.type,
    event,
    recipientName: recipient.name,
    message: campaign.message,
    eventUrl: eventUrlFor(env, slug, campaign.type),
    shareUrl: campaign.type === 'share' ? shareUrlFor(env, slug, recipient.email) : undefined,
    artUrl: campaign.type === 'share' ? `${frontendUrl(env)}/events/${encodeURIComponent(slug)}/arte` : undefined,
    unsubscribeUrl: unsubscribeUrlFor(env, token),
  });
  return {
    subject: (campaign.subject || '').trim() || defaultSubject(campaign.type, event?.title),
    html,
    headers: {
      'List-Unsubscribe': `<${oneClickUrlFor(env, token)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
};
