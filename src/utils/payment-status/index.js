// Payment statuses of the Eventando (the typo PEDING is the stored value).
export const PENDING = 'PEDING_PAYMENT';
export const CONFIRMED = 'CONFIRMED';
export const EXPIRED = 'EXPIRED';
export const OPAPINGOU = 'opapingou';

const isPast = (date, now) => Boolean(date) && new Date(date).getTime() <= now.getTime();

/**
 * The status to show: a pending charge past its expires_at is shown as EXPIRED even
 * before the Eventando records it (its vacancy is already free).
 */
export const effectiveStatus = (payment, now = new Date()) => {
  const status = payment?.status || null;
  if (status === PENDING && isPast(payment.expires_at, now)) return EXPIRED;
  return status;
};

/**
 * Whether a signup holds its place (check-in list, badge, raffle, "already signed up").
 * No payment (free, imported, manual): yes. CONFIRMED: yes, whichever provider took
 * it (old Pix Aí ones included). Pending, EXPIRED, CANCELED and REFUND: no — nothing
 * was paid.
 */
export const holdsPlace = (signup) => {
  const payment = signup?.payment;
  if (!payment || !payment.status) return true;
  return payment.status === CONFIRMED;
};

// Coupon use that counts against max_uses and the one-per-CPF rule (spec §3.4): paid,
// or a charge still within its deadline. An old Pix Aí pending one (no expires_at)
// will never be paid, so it does not count.
export const countsAsCouponUse = (payment, now = new Date()) => {
  if (payment?.status === CONFIRMED) return true;
  if (payment?.status !== PENDING) return false;
  return Boolean(payment.expires_at) && !isPast(payment.expires_at, now);
};

// REA-34: o admin aprovou a inscrição sem cobrança. O payment fica CONFIRMED com o
// value original (histórico), mas conta como R$ 0 e fica fora da receita.
export const isManuallyApproved = (payment) => Boolean(payment?.manual_approved_at);

// Quem aprovou, para mostrar: o nome, ou o e-mail ({ id, email, name } no Eventando).
export const manualApproverOf = (payment) => {
  const by = payment?.manual_approved_by;
  if (!by) return null;
  if (typeof by === 'string') return by;
  return by.name || by.email || null;
};
