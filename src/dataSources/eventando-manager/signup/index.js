import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch, buildQuery } = eventandoNetworkUtils;

const signup = (eventId, data, headers) =>
  fetch(`/signup/${eventId}`, 'POST', headers, data);

const findSignupByEmail = (eventId, email, headers) => {
  const filters = {
    email: { eq: email },
    event: { id: { eq: eventId } },
  };
  // The payment tells whether the signup holds its place (utils/payment-status).
  const query = buildQuery(filters, [], {}, '', ['payment']);
  const route = `/signups${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const findSignupsByEvent = async (eventId, headers) => {
  let allSignups = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const filters = {
      event: { id: { eq: eventId } },
    };
    const pagination = { page, pageSize: 100 };
    const populate = [
      'payment',
      'payment.batch.product',
      'payment.batch',
      'event',
      'event.products',
      'event.products.batches',
    ];
    const query = buildQuery(
      filters,
      [{ createdAt: 'desc' }],
      pagination,
      '',
      populate,
    );
    const route = `/signups${query ? `?${query}` : ''}`;
    const response = await fetch(route, 'GET', headers);

    const data = response?.data || [];
    allSignups = [...allSignups, ...data];

    // response.meta already IS the pagination object (extracted by createStrapiFetch)
    const meta = response?.meta;
    if (meta && page < meta.pageCount) {
      page++;
    } else {
      hasMore = false;
    }
  }

  return allSignups;
};

// One signup by documentId, with its event; resolves null when Eventando answers 404.
const findSignupById = async (signupId, headers) => {
  try {
    return await fetch(`/signups/${signupId}?${buildQuery({}, [], {}, '', ['event'])}`, 'GET', headers);
  } catch (err) {
    if (/not found/i.test(err.message)) return null;
    throw err;
  }
};

// The signup with its payment and event, or null (404 or not a number).
const findSignupWithPayment = async (signupId, headers) => {
  if (!/^[1-9]\d*$/.test(String(signupId || ''))) return null;
  try {
    const query = buildQuery({}, [], {}, '', ['payment', 'event']);
    return (await fetch(`/signups/${signupId}?${query}`, 'GET', headers))?.data || null;
  } catch (err) {
    if (/not found/i.test(err.message)) return null;
    throw err;
  }
};

const updateSignup = (signupId, data, headers) =>
  fetch(`/signups/${signupId}`, 'PUT', headers, { data });

// REA-22: who already holds the event's signup, by CPF or by one of the e-mails
// (integration token only). Resolves { signup_id, email, name, payment_status, kind,
// value } or null. The CPF never comes back.
const findSignupHolder = async (eventId, { cpf, emails }, headers) => {
  const response = await fetch(`/signup-holder/${eventId}`, 'POST', headers, { cpf, emails });
  return response?.data?.holder || null;
};

const createSignupDirect = (data, headers) =>
  fetch('/signups', 'POST', headers, { data });

const signupDataSource = ({ headers }) => ({
  signup: (eventId, data) => signup(eventId, data, headers),
  findSignupByEmail: (eventId, email) =>
    findSignupByEmail(eventId, email, headers),
  findSignupsByEvent: (eventId) => findSignupsByEvent(eventId, headers),
  findSignupById: (signupId) => findSignupById(signupId, headers),
  findSignupWithPayment: (signupId) => findSignupWithPayment(signupId, headers),
  updateSignup: (signupId, data) => updateSignup(signupId, data, headers),
  createSignupDirect: (data) => createSignupDirect(data, headers),
  findSignupHolder: (eventId, query) => findSignupHolder(eventId, query, headers),
});

export default signupDataSource;

