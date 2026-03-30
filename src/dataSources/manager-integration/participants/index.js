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

const participants = ({ headers }) => ({
  findParticipants: (eventDocumentId) => findParticipants(eventDocumentId, headers),
});

export default participants;
