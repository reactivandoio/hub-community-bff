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

const payments = ({ headers }) => ({
  createPaymentDirect: (data) => createPayment(data, headers),
  findPaymentsByEvent: (eventId) => findPaymentsByEvent(eventId, headers),
});

export default payments;
