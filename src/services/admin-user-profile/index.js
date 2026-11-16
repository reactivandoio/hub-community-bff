import { effectiveStatus, isManuallyApproved } from '../../utils/payment-status';

// REA-52: the admin's page of one user (admin only — resolvers/Admin checks it): the account, its
// role and what it manages, its signups (Eventando, by e-mail), certificates, attendances, and every
// e-mail sent to it with Mailgun's events. The CPF is masked: the page never needs it whole.

/** "529.982.247-25" / "52998224725" → "***.982.247-**". */
export const maskCpf = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) return digits ? '***' : null;
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
};

const ref = (event) => (event && (event.documentId || event.uuid || event.slug)
  ? {
    id: String(event.documentId || event.uuid || event.id),
    title: event.title || event.name || null,
    slug: event.slug || null,
  }
  : null);

/** One Eventando signup, as the page lists it. */
export const toUserSignup = (signup, now = new Date()) => {
  const payment = signup.payment || null;
  const event = signup.event?.data
    ? { id: signup.event.data.id, ...signup.event.data.attributes }
    : signup.event;
  return {
    id: String(signup.id),
    event: ref(event),
    created_at: signup.createdAt || signup.created_at || null,
    product_name: payment?.batch?.product?.name || null,
    // null = no payment (free, imported, added by hand): it holds its place.
    payment_status: payment ? effectiveStatus(payment, now) : null,
    paid_cents: payment && !isManuallyApproved(payment) && payment.status === 'CONFIRMED'
      ? Number(payment.value) || 0
      : null,
    manual_approved: isManuallyApproved(payment),
    checked_in: Boolean(signup.checked_in),
    checked_in_at: signup.checked_in_at || null,
  };
};

export const toUserCertificate = (certificate) => ({
  id: String(certificate.documentId || certificate.id),
  code: certificate.code || null,
  category: certificate.category || null,
  event: ref(certificate.event),
  issued_at: certificate.issued_at || null,
  sent_at: certificate.sent_at || null,
  revoked_at: certificate.revoked_at || null,
});

export const toUserAttendance = (attendance) => ({
  id: String(attendance.documentId || attendance.id),
  event: ref(attendance.event),
  created_at: attendance.createdAt || null,
});

// What a record's campaign_document_id says the e-mail was, when the row has no `kind` (older ones).
export const emailKindOf = (row) => {
  if (row.kind) return row.kind;
  const campaign = String(row.campaign_document_id || '');
  if (campaign.startsWith('transactional:')) return campaign.slice('transactional:'.length);
  if (campaign.startsWith('strapi:')) return campaign.slice('strapi:'.length);
  if (campaign.startsWith('age-review')) return 'age-review';
  return campaign ? 'campaign' : 'email';
};

export const toUserEmail = (row) => ({
  id: String(row.documentId || row.id),
  kind: emailKindOf(row),
  subject: row.subject || null,
  status: row.status || null,
  error: row.error || null,
  sent_at: row.sent_at || row.createdAt || null,
  message_id: row.message_id || null,
  last_event: row.last_event || null,
  last_event_at: row.last_event_at || null,
  events: (Array.isArray(row.events) ? row.events : []).map((event) => ({
    event: event.event,
    at: event.at || null,
    severity: event.severity || null,
    reason: event.reason || null,
    message: event.message || null,
    url: event.url || null,
  })),
});

// Each part may fail on its own (Eventando down…) without costing the page.
const safely = async (label, load, fallback) => {
  try {
    return await load();
  } catch (err) {
    console.error(`[AdminUserProfile] ${label}: ${err.message}`);
    return fallback;
  }
};

/**
 * The whole page but the e-mails. `user` is the users-permissions record (adminFindUserProfile).
 */
export const loadUserProfile = async ({ user, dataSources, toUser, now = new Date() }) => {
  const integration = dataSources.managerIntegration;
  const email = user.email || null;
  const [signups, certificates, attendances, status, emails] = await Promise.all([
    safely('signups', () => dataSources.eventandoIntegration.findSignupsByEmail(email), null),
    safely('certificates', () => integration.adminFindUserCertificates({
      documentId: user.documentId, email, cpf: String(user.cpf || '').replace(/\D/g, '') || null,
    }), null),
    safely('attendances', () => integration.adminFindUserAttendances(user.documentId), null),
    safely('account status', () => (email ? integration.accountStatus([email]) : []), []),
    safely('emails', () => (email ? integration.findEmailDeliveriesByEmail(email, { page: 1, pageSize: 1 }) : null), null),
  ]);
  const pending = (status || []).find((s) => String(s.email).toLowerCase() === String(email).toLowerCase());
  return {
    ...toUser(user),
    phone: user.phone || null,
    cpf_masked: maskCpf(user.cpf),
    date_of_birth: user.date_of_birth || null,
    created_at: user.createdAt || null,
    confirmed: Boolean(user.confirmed),
    // REA-26: never logged in with a code (null when the backend could not tell).
    registration_pending: pending ? Boolean(pending.pending) : null,
    adult_declaration: Boolean(user.adult_declaration),
    adult_declaration_at: user.adult_declaration_at || null,
    marketing_opt_in: Boolean(user.marketing_opt_in),
    marketing_opt_in_at: user.marketing_opt_in_at || null,
    age_review_status: user.age_review_status || null,
    age_review_requested_at: user.age_review_requested_at || null,
    age_review_blocked_at: user.age_review_blocked_at || null,
    signups: signups ? signups.map((s) => toUserSignup(s, now)) : null,
    certificates: certificates ? certificates.map(toUserCertificate) : null,
    attendances: attendances ? attendances.map(toUserAttendance) : null,
    email_count: emails ? emails.total : null,
  };
};
