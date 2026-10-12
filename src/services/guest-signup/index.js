// REA-22: signup to an event without login. The person types the minimum (name,
// e-mail, WhatsApp, CPF) on the event's signup page and does NOT get a session:
// creating the account, from the e-mail, is what confirms it.
//
// Pedro's rules:
//  1. E-mail and CPF already on the same account: sign up and say the confirmation
//     e-mail went out.
//  2. The CPF is another account's: the signup goes to the account that owns the CPF,
//     everything else typed is dropped, and the page only shows that account's e-mail
//     masked (glad****@***ail.com). Never a Pix, a ticket or anything else of it.
//  3. New person: account with the minimum data, then the signup.
//  4. The CPF (or e-mail) already holds a signup in the event: no new one; the
//     confirmation (or, while the Pix is open, the payment link) is sent again.
//  Proposal accepted with the card: the e-mail has an account with another CPF, or an
//  old account without CPF → the signup goes to that account (its owner gets the
//  e-mail) and the typed CPF stays only on the signup; an unauthenticated flow never
//  writes a CPF on an existing account.
//  7. Paid batch: the Pix is shown right away (cases 1, 3 and the proposal), plus a
//     "Finalize sua inscrição" e-mail with the way back to it.

import crypto from 'crypto';
import { createRateLimiter } from '../../utils/rate-limit';
import { maskEmail } from '../../utils/mask-email';
import { signupIdOf } from '../../utils/signup-id';
import { saveMissingCpf } from '../../utils/signup-cpf';
import { isValidCpf } from '../../resolvers/Certificate/eligibility';
import { sendSignupConfirmation as defaultSendConfirmation } from '../email/signup-confirmation';
import { sendPaymentPending as defaultSendPaymentPending } from '../email/payment-pending';

export const OUTCOMES = Object.freeze({
  NEW_ACCOUNT: 'NEW_ACCOUNT',
  EXISTING_ACCOUNT: 'EXISTING_ACCOUNT',
  CPF_OWNER: 'CPF_OWNER',
  ALREADY_SIGNED_UP: 'ALREADY_SIGNED_UP',
});

export const MESSAGES = Object.freeze({
  CPF: 'Informe um CPF válido.',
  NAME: 'Informe seu nome completo.',
  EMAIL: 'Informe um e-mail válido.',
  TOO_MANY: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  NO_EVENT: 'Evento não encontrado no sistema de inscrições.',
  UNAVAILABLE: 'Não foi possível concluir a inscrição agora. Tente de novo em instantes.',
  FAILED: 'Erro ao realizar inscrição.',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const digitsOf = (value) => String(value || '').replace(/\D/g, '');

// Personal data never stays in memory as a key: only its hash.
const keyOf = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex');

/**
 * Attempt limits, per process. ip: signups tried from one address; cpf: tried with
 * one CPF; resend: e-mails sent again to one person for one event.
 */
export const createGuestLimits = () => ({
  ip: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
  cpf: createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 }),
  resend: createRateLimiter({ limit: 1, windowMs: 10 * 60 * 1000 }),
});

const defaultLimits = createGuestLimits();

const failure = (message) => ({ success: false, message, payment: null, is_free: false });

const eventTitleOf = (event) => event?.name || event?.attributes?.name || 'evento';
const eventSlugOf = (event, fallback) => event?.slug || event?.attributes?.slug || fallback;

// The account behind the CPF, else behind the e-mail. A failed lookup stops the
// signup: going on could create a second account for someone else's CPF.
const resolveAccount = async (integration, { cpf, email }) => {
  const byCpf = await integration.findUserByCpf(cpf);
  if (byCpf?.email) {
    return normalizeEmail(byCpf.email) === email
      ? { outcome: OUTCOMES.EXISTING_ACCOUNT, account: byCpf }
      : { outcome: OUTCOMES.CPF_OWNER, account: byCpf };
  }
  const byEmail = await integration.findUserByEmail(email);
  if (byEmail) return { outcome: OUTCOMES.EXISTING_ACCOUNT, account: byEmail };
  return { outcome: OUTCOMES.NEW_ACCOUNT, account: null };
};

/**
 * @param {Object} params
 * @param {Object} params.dataSources
 * @param {Object} params.args - signupToEvent arguments
 * @param {string} params.clientIp
 * @param {Object} [params.limits] - createGuestLimits()
 * @param {Object} [params.mail] - { sendConfirmation, sendPaymentPending } (tests)
 */
export const guestSignupToEvent = async ({
  dataSources,
  args,
  clientIp,
  limits = defaultLimits,
  mail = {},
}) => {
  const sendConfirmation = mail.sendConfirmation || defaultSendConfirmation;
  const sendPaymentPending = mail.sendPaymentPending || defaultSendPaymentPending;
  const { eventId, batch_id: batchId, coupon_code: couponCode, is_student: isStudent, kind } = args;

  const name = String(args.name || '').trim();
  const typedEmail = normalizeEmail(args.email);
  const phone = String(args.phone_number || '').trim() || undefined;
  const cpf = digitsOf(args.cpf);

  if (!isValidCpf(cpf)) return failure(MESSAGES.CPF);
  if (name.length < 3) return failure(MESSAGES.NAME);
  if (!EMAIL_PATTERN.test(typedEmail)) return failure(MESSAGES.EMAIL);

  if (!limits.ip.hit(keyOf('ip', clientIp || 'unknown')) || !limits.cpf.hit(keyOf('cpf', cpf))) {
    return failure(MESSAGES.TOO_MANY);
  }

  const eventandoResponse = await dataSources.eventandoIntegration.findEventBySlug(eventId);
  const event = eventandoResponse?.data?.[0];
  if (!event) return failure(MESSAGES.NO_EVENT);
  const eventSlug = eventSlugOf(event, eventId);
  const eventTitle = eventTitleOf(event);

  let resolved;
  try {
    resolved = await resolveAccount(dataSources.managerIntegration, { cpf, email: typedEmail });
  } catch (err) {
    console.error('[GuestSignup] account lookup failed:', err.message);
    return failure(MESSAGES.UNAVAILABLE);
  }
  const { outcome, account } = resolved;
  const isCpfOwner = outcome === OUTCOMES.CPF_OWNER;

  // Rule 2: what was typed is dropped; the signup carries the owner's data.
  const signupEmail = isCpfOwner ? normalizeEmail(account.email) : typedEmail;
  const signupName = isCpfOwner ? (account.name || account.username || signupEmail.split('@')[0]) : name;
  const signupPhone = isCpfOwner ? (account.phone || undefined) : phone;
  // Where the page says the e-mail went: what the person typed, or the owner's, masked.
  const sentToFor = (email) => (normalizeEmail(email) === typedEmail ? typedEmail : maskEmail(email));

  // Rule 4: send again what the holder needs, at most once per window.
  const resendToHolder = async (holder) => {
    const resent = limits.resend.hit(keyOf('resend', event.id, normalizeEmail(holder.email)));
    if (resent) {
      const job = holder.payment_status === 'PEDING_PAYMENT'
        ? sendPaymentPending({
          email: holder.email,
          name: holder.name,
          eventTitle,
          eventSlug,
          signupId: String(holder.signup_id),
          expiresAt: null,
        })
        : sendConfirmation({
          dataSources,
          eventSlug,
          eventandoEvent: event,
          signupId: String(holder.signup_id),
          name: holder.name,
          email: holder.email,
          isFree: !(Number(holder.value) > 0),
          isPaid: Number(holder.value) > 0,
        });
      Promise.resolve(job).catch((err) => console.error('[GuestSignup] resend failed:', err.message));
    }
    const sentTo = sentToFor(holder.email);
    return {
      success: true,
      outcome: OUTCOMES.ALREADY_SIGNED_UP,
      confirmation_sent_to: sentTo,
      message: resent
        ? `Este CPF já tem inscrição neste evento. Enviamos de novo a confirmação para ${sentTo}.`
        : `Este CPF já tem inscrição neste evento. A confirmação foi enviada há pouco para ${sentTo}; confira também o spam.`,
      payment: null,
      is_free: false,
      signup_id: null,
    };
  };

  const findHolder = async () => {
    try {
      return await dataSources.eventandoIntegration.findSignupHolder(event.id, {
        cpf,
        emails: [...new Set([signupEmail, typedEmail])],
      });
    } catch (err) {
      // The Eventando still refuses the repeated CPF inside its lock (ALREADY_SIGNED_UP).
      console.error('[GuestSignup] holder lookup failed:', err.message);
      return null;
    }
  };

  const holder = await findHolder();
  if (holder) return resendToHolder(holder);

  let response;
  try {
    response = await dataSources.eventandoIntegration.signup(event.id, {
      name: signupName,
      email: signupEmail,
      batch_id: parseInt(batchId, 10),
      coupon_code: couponCode,
      is_student: isStudent,
      phone_number: signupPhone,
      cpf,
      kind,
    });
  } catch (err) {
    if (err.code === 'ALREADY_SIGNED_UP') {
      const raced = await findHolder();
      if (raced) return resendToHolder(raced);
    }
    return failure(err.message || MESSAGES.FAILED);
  }
  if (response?.status === 'error' || response?.error) {
    return failure(response.message || response.error?.message || MESSAGES.FAILED);
  }

  const data = response?.data || response;
  const isFree = Boolean(data?.is_free);
  const signupId = signupIdOf(data);
  const isNew = outcome === OUTCOMES.NEW_ACCOUNT;

  // The account and its CPF: only an account created now gets the CPF typed here.
  if (isFree) {
    sendConfirmation({
      dataSources,
      eventSlug,
      eventandoEvent: event,
      signupId,
      name: signupName,
      email: signupEmail,
      phone: signupPhone,
      cpf: isNew ? cpf : undefined,
      isFree: true,
    }).catch((err) => console.error('[GuestSignup] confirmation failed:', err.message));
  } else {
    (async () => {
      if (isNew) {
        try {
          await dataSources.managerIntegration.accountSetup({ email: signupEmail, name: signupName, phone: signupPhone });
          await saveMissingCpf(dataSources, signupEmail, cpf);
        } catch (err) {
          console.error('[GuestSignup] account setup failed (non-blocking):', err.message);
        }
      }
      await sendPaymentPending({
        email: signupEmail,
        name: signupName,
        eventTitle,
        eventSlug,
        signupId,
        expiresAt: data?.expires_at,
      });
    })().catch((err) => console.error('[GuestSignup] payment e-mail failed:', err.message));
  }

  if (isCpfOwner) {
    const sentTo = maskEmail(signupEmail);
    return {
      success: true,
      outcome,
      confirmation_sent_to: sentTo,
      message: isFree
        ? `Este CPF já tem cadastro. A inscrição foi feita nessa conta e a confirmação foi enviada para ${sentTo}.`
        : `Este CPF já tem cadastro. A inscrição foi feita nessa conta e o Pix para pagamento foi enviado para ${sentTo}.`,
      payment: null,
      is_free: isFree,
      signup_id: null,
    };
  }

  const { cpf: _cpf, signup: rawSignup, ...payment } = data || {};
  if (rawSignup && typeof rawSignup === 'object') {
    const { cpf: _signupCpf, ...signup } = rawSignup;
    payment.signup = signup;
  }
  return {
    success: true,
    outcome,
    confirmation_sent_to: typedEmail,
    message: 'Inscrição realizada com sucesso!',
    payment,
    is_free: isFree,
    signup_id: signupId,
  };
};

export default guestSignupToEvent;
