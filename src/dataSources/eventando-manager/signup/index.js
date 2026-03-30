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

const signupDataSource = ({ headers }) => ({
    signup: (eventId, data) => signup(eventId, data, headers),
    findSignupByEmail: (eventId, email) => findSignupByEmail(eventId, email, headers),
});

export default signupDataSource;
