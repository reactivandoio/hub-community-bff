// Payment statuses of the Eventando (the typo PEDING is the stored value).
export const PENDING = 'PEDING_PAYMENT';
export const CONFIRMED = 'CONFIRMED';
export const EXPIRED = 'EXPIRED';
export const OPAPINGOU = 'opapingou';

const isPast = (date, now) => Boolean(date) && new Date(date).getTime() <= now.getTime();

/**
 * The status to show: a pending Opa Pingou charge past its expires_at is shown as
 * EXPIRED even before the Eventando records it (its vacancy is already free).
 */
export const effectiveStatus = (payment, now = new Date()) => {
  const status = payment?.status || null;
  if (status === PENDING && payment?.provider === OPAPINGOU && isPast(payment.expires_at, now)) {
    return EXPIRED;
  }
  return status;
};

/**
 * Whether a signup holds its place (check-in list, badge, raffle, "already signed up").
 * No payment or a zero-value one: yes (free, imported, manual). CONFIRMED: yes.
 * Opa Pingou: only CONFIRMED. PixAI pending: yes, as before REA-6.
 * EXPIRED, CANCELED and REFUND: no.
 */
export const holdsPlace = (signup) => {
  const payment = signup?.payment;
  if (!payment || !payment.status) return true;
  if (payment.status === CONFIRMED) return true;
  if (payment.status === PENDING) return payment.provider !== OPAPINGOU;
  return false;
};

// Coupon use that counts against max_uses and the one-per-CPF rule (spec §3.4).
export const countsAsCouponUse = (payment, now = new Date()) => {
  if (payment?.status === CONFIRMED) return true;
  if (payment?.status !== PENDING) return false;
  return !payment.expires_at || !isPast(payment.expires_at, now);
};
