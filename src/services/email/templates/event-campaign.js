// REA-29: the three campaign e-mails of an event, admin page "E-mail marketing".
// invite: the whole Hub base · share: signups get a personal link to invite someone · reminder: signups.

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const CAMPAIGN_TYPES = ['invite', 'share', 'reminder'];

export const defaultSubject = (type, eventTitle) => {
  const title = eventTitle || 'evento';
  if (type === 'share') return `🤝 Convide alguém para ${title}`;
  if (type === 'reminder') return `⏰ Lembrete: ${title} está chegando`;
  return `📣 Você está convidado: ${title}`;
};

const HEADINGS = {
  invite: '📣 Você está convidado',
  share: '🤝 Traga alguém com você',
  reminder: '⏰ Seu evento está chegando',
};

const INTROS = {
  invite: (title) => `Queremos você no <strong style="color:#ffffff;">${title}</strong>. Confira os detalhes e garanta sua vaga:`,
  share: (title) => `Obrigado por se inscrever no <strong style="color:#ffffff;">${title}</strong>! Conhece alguém que vai gostar? Mande o seu link de convite:`,
  reminder: (title) => `Você está inscrito no <strong style="color:#ffffff;">${title}</strong>. Anote aí:`,
};

const FOOTERS = {
  invite: 'Você recebeu este email porque tem uma conta no Hub Community.',
  share: 'Você recebeu este email porque se inscreveu neste evento.',
  reminder: 'Você recebeu este email porque se inscreveu neste evento.',
};

const button = (href, label, background = '#22c55e', color = '#0f1117') =>
  `<a href="${escapeHtml(href)}" style="display:inline-block;margin:4px;padding:12px 24px;background-color:${background};color:${color};text-decoration:none;font-size:15px;font-weight:600;border-radius:50px;">${label}</a>`;

const detailRow = (icon, value) =>
  `<tr><td style="padding:4px 0;font-size:15px;color:#d1d5db;">${icon}&nbsp; ${escapeHtml(value)}</td></tr>`;

/** The admin's optional message: plain text, one paragraph per blank line. */
const messageHtml = (message) => {
  const text = String(message || '').trim();
  if (!text) return '';
  return text.split(/\n\s*\n/).map((paragraph) =>
    `<p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#d1d5db;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
};

const shareBlock = ({ shareUrl, artUrl, eventTitle }) => {
  const text = `Bora no ${eventTitle}? Inscreva-se: ${shareUrl}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  return `
              <p style="margin:24px 0 0;text-align:center;">
                ${button(whatsapp, 'Enviar no WhatsApp', '#25d366')}
                ${button(linkedin, 'Compartilhar no LinkedIn', '#0a66c2', '#ffffff')}
              </p>
              <p style="margin:20px 0 4px;font-size:13px;color:#9ca3af;text-align:center;">Ou copie o seu link:</p>
              <p style="margin:0;padding:12px;background-color:#0f1117;border:1px solid #2a2d37;border-radius:8px;font-size:14px;color:#22c55e;text-align:center;word-break:break-all;">
                ${escapeHtml(shareUrl)}
              </p>
              ${artUrl ? `<p style="margin:16px 0 0;font-size:14px;text-align:center;"><a href="${escapeHtml(artUrl)}" style="color:#a78bfa;">Gerar a arte "eu vou" para postar</a></p>` : ''}`;
};

/**
 * @param {Object} p
 * @param {'invite'|'share'|'reminder'} p.type
 * @param {{ title: string, dateStr?: string, timeStr?: string, locationStr?: string }} p.event
 * @param {string} [p.recipientName]
 * @param {string} [p.message] - optional text written by the admin
 * @param {string} p.eventUrl - signup link (invite) or event page (share/reminder)
 * @param {string} [p.shareUrl] - share only: the signup's personal `?ref=` link
 * @param {string} [p.artUrl] - share only: /events/<slug>/arte
 * @param {string} p.unsubscribeUrl
 */
export const eventCampaignTemplate = ({
  type, event, recipientName, message, eventUrl, shareUrl, artUrl, unsubscribeUrl,
}) => {
  const kind = CAMPAIGN_TYPES.includes(type) ? type : 'invite';
  const title = escapeHtml(event?.title || 'evento');
  const greeting = recipientName ? `Olá, <strong style="color:#ffffff;">${escapeHtml(recipientName)}</strong>! ` : 'Olá! ';
  const cta = kind === 'invite'
    ? button(eventUrl, 'Quero me inscrever')
    : button(eventUrl, 'Ver o evento', '#1f2937', '#ffffff');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f1117;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;">
          <tr>
            <td align="center" style="padding:24px 0 32px;">
              <span style="font-size:24px;font-weight:700;color:#22c55e;letter-spacing:-0.5px;">🌐 Hub Community</span>
            </td>
          </tr>
          <tr>
            <td style="background-color:#1a1d27;border-radius:16px;border:1px solid #2a2d37;padding:32px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">${HEADINGS[kind]}</h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#d1d5db;">${greeting}${INTROS[kind](title)}</p>
              <h2 style="margin:24px 0 8px;font-size:18px;font-weight:700;color:#ffffff;">${title}</h2>
              <table role="presentation" cellspacing="0" cellpadding="0">
                ${event?.dateStr ? detailRow('📅', event.dateStr) : ''}
                ${event?.timeStr ? detailRow('🕐', event.timeStr) : ''}
                ${event?.locationStr ? detailRow('📍', event.locationStr) : ''}
              </table>
              ${messageHtml(message)}
              ${kind === 'share' && shareUrl ? shareBlock({ shareUrl, artUrl, eventTitle: event?.title || 'evento' }) : ''}
              <p style="margin:28px 0 0;text-align:center;">${cta}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 0;text-align:center;">
              <p style="margin:0;font-size:13px;color:#666;">${FOOTERS[kind]}</p>
              <p style="margin:8px 0 0;font-size:13px;color:#666;">
                Não quer mais receber esses emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#888;">Descadastrar</a>
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#555;">© ${new Date().getFullYear()} Hub Community. Todos os direitos reservados.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
