import { requireEventOrganizer } from '../../utils/auth';
import { findEventandoEvent } from '../../utils/eventando-event';
import { CONFIRMED, holdsPlace } from '../../utils/payment-status';
import { signupIdOf } from '../../utils/signup-id';
import { sendSignupConfirmation } from '../../services/email/signup-confirmation';
import {
  CONFIRMATION_KINDS,
  SIGNUP_CONFIRMATION_RESEND_KIND,
  confirmationFailureMessage,
  confirmationStatusBySignup,
  resendWaitSeconds,
} from '../../services/email/confirmation-status';

// Signups being resent right now in this process: a second click waits for the first.
const inFlight = new Set();

const refuse = (message, extra = {}) => ({
  success: false, message, sent_at: null, retry_after: null, ...extra,
});

/**
 * REA-50: "Reenviar e-mail" on a row of the participants list (Analytics). Sends the same
 * "Inscrição confirmada" e-mail again, with the ticket, recorded as `signup-confirmation-resend`
 * (that record holds the date of the last resend). Admin and the event's organizers and managers
 * (REA-48). Only confirmed signups: free, paid or approved by hand — never pending, expired,
 * canceled or refunded. One resend a minute per signup.
 */
export const resendSignupConfirmation = async (
  _,
  { event: key, signup_id: signupIdArg },
  ctx,
  { now = new Date(), send = sendSignupConfirmation } = {},
) => {
  await requireEventOrganizer(ctx, key);
  const { dataSources } = ctx;

  const event = await findEventandoEvent(dataSources, key);
  if (!event) return refuse(`Evento "${key}" não encontrado.`);

  const signup = await dataSources.eventandoIntegration.findSignupWithPayment(signupIdArg);
  const signupEventId = signup?.event?.id ?? signup?.event;
  if (!signup || String(signupEventId) !== String(event.id)) {
    return refuse('Inscrição não encontrada neste evento.');
  }
  if (!holdsPlace(signup)) {
    return refuse(
      'Só inscrições confirmadas (gratuitas, pagas ou aprovadas) recebem o e-mail de confirmação.',
    );
  }
  if (!signup.email) return refuse('Esta inscrição não tem e-mail.');

  const signupId = signupIdOf(signup);
  if (inFlight.has(signupId)) return refuse('O e-mail desta inscrição já está sendo reenviado.');
  inFlight.add(signupId);
  try {
    // The last resend, across restarts and other BFF processes.
    let status = null;
    try {
      const rows = await dataSources.managerIntegration
        .findTransactionalDeliveries([signup.email], CONFIRMATION_KINDS);
      status = confirmationStatusBySignup(rows, [signupId]).get(signupId) || null;
    } catch (err) {
      console.error(`[ResendConfirmation] could not read the deliveries of ${signupId}:`, err.message);
    }
    const wait = resendWaitSeconds(status, now);
    if (wait > 0) {
      return refuse(`Este e-mail acabou de ser reenviado. Aguarde ${wait} segundos para reenviar de novo.`, {
        retry_after: wait,
      });
    }

    const payment = signup.payment || null;
    const result = await send({
      dataSources,
      eventSlug: event.slug || event.uuid,
      eventandoEvent: event,
      signupId,
      name: signup.name,
      email: signup.email,
      phone: signup.phone_number || null,
      cpf: signup.cpf || null,
      isFree: !payment || !(Number(payment.value) > 0),
      isPaid: payment?.status === CONFIRMED,
      kind: SIGNUP_CONFIRMATION_RESEND_KIND,
    });

    const who = ctx.user?.email || ctx.user?.id;
    if (!result?.success) {
      console.error(
        `[ResendConfirmation] inscrição ${signupId} do evento ${event.id}, por ${who}:`,
        result?.error || 'erro',
      );
      return refuse(confirmationFailureMessage(result?.error));
    }
    console.log(`[ResendConfirmation] inscrição ${signupId} do evento ${event.id} reenviada por ${who}`);
    return {
      success: true,
      message: `E-mail de confirmação reenviado para ${signup.email}.`,
      sent_at: now.toISOString(),
      retry_after: null,
    };
  } finally {
    inFlight.delete(signupId);
  }
};

const SignupConfirmation = {
  Mutation: {
    resendSignupConfirmation: (parent, args, ctx) => resendSignupConfirmation(parent, args, ctx),
  },
};

export default SignupConfirmation;
