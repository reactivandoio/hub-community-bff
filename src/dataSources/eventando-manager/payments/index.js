import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch, buildQuery } = eventandoNetworkUtils;

const createPayment = (data, headers) =>
  fetch('/payments', 'POST', headers, { data });

// Every payment of the event (with its signup and coupon), 100 per page.
const findPaymentsByEvent = async (eventId, headers) => {
  let all = [];
  let page = 1;
  let pageCount = 1;
  do {
    const query = buildQuery(
      { event: { id: { eq: eventId } } },
      [{ createdAt: 'desc' }],
      { page, pageSize: 100 },
      '',
      ['signup', 'coupon'],
    );
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`/payments?${query}`, 'GET', headers);
    all = [...all, ...(response?.data || [])];
    pageCount = response?.meta?.pageCount || 1;
    page += 1;
  } while (page <= pageCount);
  return all;
};

// REA-34: aprovação manual de uma inscrição sem cobrança. O Eventando valida que a
// inscrição é do evento e que o pagamento pode ser aprovado; um erro vem com `code`
// (NOT_FOUND 404; NO_PAYMENT, ALREADY_CONFIRMED, REFUNDED 409).
const manualApprovalPreview = async ({ eventId, signupId }, headers) => {
  const query = new URLSearchParams({ event_id: String(eventId), signup_id: String(signupId) });
  const response = await fetch(`/payment/manual-approval/preview?${query}`, 'GET', headers);
  return response?.data || null;
};

const approveSignupManually = async ({ eventId, signupId, approvedBy }, headers) => {
  const response = await fetch('/payment/manual-approval', 'POST', headers, {
    event_id: eventId,
    signup_id: signupId,
    approved_by: approvedBy,
  });
  return response?.data || null;
};

const payments = ({ headers }) => ({
  createPaymentDirect: (data) => createPayment(data, headers),
  findPaymentsByEvent: (eventId) => findPaymentsByEvent(eventId, headers),
  manualApprovalPreview: (params) => manualApprovalPreview(params, headers),
  approveSignupManually: (params) => approveSignupManually(params, headers),
});

export default payments;
