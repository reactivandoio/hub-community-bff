import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const findParticipants = async (eventDocumentId, headers) => {
  const filters = {
    event: { documentId: { eq: eventDocumentId } },
  };
  const pagination = { pageSize: 1 }; // We only need the total count
  const query = buildQuery(filters, [], pagination, '', []);
  const route = `/participants${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

// A certificate request filled in by the person on the public form of an event.
const createParticipant = (data, headers) => fetch('/participants', 'POST', headers, { data });

const participants = ({ headers }) => ({
  findParticipants: (eventDocumentId) => findParticipants(eventDocumentId, headers),
  createParticipant: (data) => createParticipant(data, headers),
});

export default participants;
