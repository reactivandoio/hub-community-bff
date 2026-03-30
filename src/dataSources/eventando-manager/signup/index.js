import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch, buildQuery } = eventandoNetworkUtils;

const signup = (eventId, data, headers) =>
    fetch(`/signup/${eventId}`, 'POST', headers, data);

const findSignupByEmail = (eventId, email, headers) => {
    const filters = {
        email: { eq: email },
        event: { id: { eq: eventId } },
    };
    const query = buildQuery(filters);
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
        const populate = ['payment', 'payment.batch.product', 'payment.batch', 'event', 'event.products', 'event.products.batches'];
        const query = buildQuery(filters, [{ createdAt: 'desc' }], pagination, '', populate);
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

const signupDataSource = ({ headers }) => ({
    signup: (eventId, data) => signup(eventId, data, headers),
    findSignupByEmail: (eventId, email) => findSignupByEmail(eventId, email, headers),
    findSignupsByEvent: (eventId) => findSignupsByEvent(eventId, headers),
});

export default signupDataSource;
