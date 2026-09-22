import QRCode from 'qrcode';
import { sendEmail } from './index';
import { signupConfirmationTemplate } from './templates/signup-confirmation';
import { saveMissingCpf } from '../../utils/signup-cpf';

const TICKET_QR_CID = 'ticket-qr';
const BATCH_CONCURRENCY = 5;

const frontendUrl = () => process.env.FRONTEND_URL || 'https://hubcommunity.io';

// Same contract as hub-community-frontend/src/lib/ticket.ts: the QR opens the
// signup page on a phone, while the check-in kiosk only reads `?ticket=`.
export const ticketUrlFor = (baseUrl, eventSlug, signupId) =>
  `${baseUrl.replace(/\/$/, '')}/events/${encodeURIComponent(eventSlug)}/signup?ticket=${encodeURIComponent(signupId)}`;

const setPasswordUrlFor = (baseUrl, token) =>
  `${baseUrl.replace(/\/$/, '')}/criar-senha?code=${encodeURIComponent(token)}`;

/**
 * Everything the e-mail shows about the event, shared by every signup of it.
 * Hub Community Manager has the rich data (dates, location, images, is_online);
 * Eventando has the products. A failed manager lookup falls back to Eventando.
 */
export const loadSignupEventDetails = async ({ dataSources, eventSlug, eventandoEvent }) => {
  // Eventando answers in Strapi v4 shape (fields under .attributes) on some routes
  // and already flattened on others.
  const eventandoFlat = {
    ...(eventandoEvent || {}),
    ...(eventandoEvent?.attributes || {}),
    id: eventandoEvent?.id,
  };
  const rawProducts = eventandoFlat.products?.data || eventandoFlat.products || [];
  const eventandoProducts = (Array.isArray(rawProducts) ? rawProducts : [])
    .map((p) => ({ ...p, ...(p.attributes || {}), id: p.id }));

  let managerEvent = null;
  try {
    const slug = eventandoFlat.slug || eventSlug;
    const managerResponse = await dataSources.managerIntegration.findEventBySlug(slug);
    managerEvent = managerResponse?.data?.[0] || null;
  } catch (err) {
    console.error('[Email] Could not fetch manager event:', err.message);
  }

  const event = managerEvent || eventandoFlat;
  const title = event.title || event.name || eventandoFlat.name || 'Evento';

  const startDate = event.start_date ? new Date(event.start_date) : null;
  const timeZone = 'America/Sao_Paulo';
  const dateStr = startDate
    ? startDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone })
    : 'A definir';
  const timeStr = startDate
    ? startDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone })
    : 'A definir';

  const isOnline = event.is_online || false;
  let locationStr = 'A definir';
  if (isOnline) {
    locationStr = 'Online';
  } else if (event.location) {
    locationStr = event.location.title || event.location.city || 'Local a definir';
  }

  // Hub Community Manager images are relative URLs
  const managerBaseUrl = process.env.MANAGER_URL || 'https://manager.hubcommunity.io';
  let imageUrl = null;
  if (event.images && event.images.length > 0) {
    const img = event.images[0];
    const rawUrl = typeof img === 'string'
      ? img
      : img?.url || img?.formats?.large?.url || img?.formats?.medium?.url || null;
    if (rawUrl) {
      imageUrl = rawUrl.startsWith('http') ? rawUrl : `${managerBaseUrl}${rawUrl}`;
    }
  }

  return {
    title,
    dateStr,
    timeStr,
    locationStr,
    description: typeof event.description === 'string' ? event.description : '',
    imageUrl,
    slug: event.slug || eventandoFlat.slug || eventSlug,
    productName: eventandoProducts[0]?.name || 'Ingresso',
    isOnline,
    callLink: event.call_link || null,
  };
};

const setUpAccount = async (dataSources, { email, name, phone }) => {
  try {
    const result = await dataSources.managerIntegration.accountSetup({ email, name, phone });
    return { created: Boolean(result?.created), token: result?.token || null };
  } catch (err) {
    console.error(`[Email] account-setup failed for ${email}:`, err.message);
    return { created: false, token: null };
  }
};

const ticketQrAttachment = async (ticketUrl) => {
  try {
    const content = await QRCode.toBuffer(ticketUrl, { type: 'png', width: 400, margin: 1 });
    return { filename: 'ingresso.png', content, contentType: 'image/png', cid: TICKET_QR_CID };
  } catch (err) {
    console.error('[Email] Could not generate ticket QR:', err.message);
    return null;
  }
};

/**
 * The single "Inscrição confirmada" e-mail: event info, the ticket QR (in-person
 * and free only — a paid signup still has its PIX pending) and, while the account
 * has no password of its own, the "Crie sua senha" link.
 *
 * `account` skips the account-setup call when the caller already made it;
 * `eventDetails` skips the event lookup (see sendSignupConfirmationBatch).
 *
 * Never throws: every failure is logged as `[Email] ...` and the e-mail goes out
 * with whatever could be built. Resolves { success, error? }.
 */
export const sendSignupConfirmation = async ({
  dataSources,
  eventSlug,
  eventandoEvent,
  signupId,
  name,
  email,
  phone,
  cpf,
  isFree,
  account,
  eventDetails,
}) => {
  if (!email) return { success: false, error: 'no e-mail' };

  try {
    const { token } = account || (await setUpAccount(dataSources, { email, name, phone }));
    // The account exists now: keep the CPF from the sheet on it (never overwrites one).
    if (cpf) await saveMissingCpf(dataSources, email, cpf);
    const details = eventDetails
      || (await loadSignupEventDetails({ dataSources, eventSlug, eventandoEvent }));
    const baseUrl = frontendUrl();

    const hasTicket = !details.isOnline && Boolean(isFree) && Boolean(signupId);
    const ticketUrl = hasTicket ? ticketUrlFor(baseUrl, details.slug, signupId) : null;
    const qr = ticketUrl ? await ticketQrAttachment(ticketUrl) : null;

    const html = signupConfirmationTemplate({
      userName: name || email.split('@')[0],
      eventTitle: details.title,
      eventDate: details.dateStr,
      eventTime: details.timeStr,
      eventLocation: details.locationStr,
      eventDescription: details.description,
      eventImage: details.imageUrl,
      eventSlug: details.slug,
      productName: details.productName,
      isFree,
      isOnline: details.isOnline,
      callLink: details.callLink,
      baseUrl,
      ticketUrl,
      ticketQrCid: qr ? TICKET_QR_CID : null,
      setPasswordUrl: token ? setPasswordUrlFor(baseUrl, token) : null,
    });

    return await sendEmail({
      to: email,
      subject: `✅ Inscrição Confirmada — ${details.title}`,
      html,
      ...(qr ? { attachments: [qr] } : {}),
    });
  } catch (err) {
    console.error(`[Email] Could not send signup confirmation to ${email}:`, err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Sends the confirmation to many signups of one event, `concurrency` at a time,
 * looking the event up once. Meant to run in the background: never throws and
 * logs `[Email] {label} {slug}: X enviados, Y falharam` at the end.
 *
 * @param {Array<{ signupId, name, email, phone }>} params.signups
 */
export const sendSignupConfirmationBatch = async ({
  dataSources,
  eventSlug,
  eventandoEvent,
  signups,
  isFree,
  label = 'batch',
  concurrency = BATCH_CONCURRENCY,
}) => {
  let sent = 0;
  let failed = 0;

  try {
    const eventDetails = await loadSignupEventDetails({ dataSources, eventSlug, eventandoEvent });
    const queue = [...signups];

    const worker = async () => {
      while (queue.length > 0) {
        const signup = queue.shift();
        // eslint-disable-next-line no-await-in-loop
        const result = await sendSignupConfirmation({
          ...signup,
          dataSources,
          eventSlug,
          eventandoEvent,
          isFree,
          eventDetails,
        });
        if (result?.success) sent += 1;
        else failed += 1;
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  } catch (err) {
    console.error(`[Email] ${label} ${eventSlug}: batch aborted:`, err.message);
  }

  console.log(`[Email] ${label} ${eventSlug}: ${sent} enviados, ${failed} falharam`);
  return { sent, failed };
};
