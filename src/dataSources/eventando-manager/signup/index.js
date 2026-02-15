import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch } = eventandoNetworkUtils;

const signup = (eventId, data, headers) =>
    fetch(`/signup/${eventId}`, 'POST', headers, { data });

const signupDataSource = ({ headers }) => ({
    signup: (eventId, data) => signup(eventId, data, headers),
});

export default signupDataSource;
