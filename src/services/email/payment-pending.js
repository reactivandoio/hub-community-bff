import { sendEmail } from './index';
import { paymentPendingTemplate } from './templates/payment-pending';

const frontendUrl = () => process.env.FRONTEND_URL || 'https://hubcommunity.io';

// REA-22: the signup page reads `?pagamento=` and shows that signup's Pix
// (signupPaymentStatus, public and without personal data).
export const paymentUrlFor = (baseUrl, eventSlug, signupId) =>
  `${baseUrl.replace(/\/$/, '')}/events/${encodeURIComponent(eventSlug)}/signup?pagamento=${encodeURIComponent(signupId)}`;

export const deadlineOf = (expiresAt) => {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
};

/** Never throws: resolves { success, error? }. */
export const sendPaymentPending = async ({ email, name, eventTitle, eventSlug, signupId, expiresAt }) => {
  if (!email || !signupId) return { success: false, error: 'no e-mail or signup' };
  try {
    return await sendEmail({
      to: email,
      subject: `⏳ Finalize sua inscrição — ${eventTitle || 'evento'}`,
      html: paymentPendingTemplate({
        userName: name || email.split('@')[0],
        eventTitle: eventTitle || 'evento',
        paymentUrl: paymentUrlFor(frontendUrl(), eventSlug, signupId),
        deadline: deadlineOf(expiresAt),
      }),
    });
  } catch (err) {
    console.error('[Email] Could not send payment-pending:', err.message);
    return { success: false, error: err.message };
  }
};
