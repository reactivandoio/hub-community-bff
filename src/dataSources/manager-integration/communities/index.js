import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

const updateCommunity = (id, data, headers) =>
  fetch(`/communities/${id}`, 'PUT', headers, { data });

const findCommunityById = (id, headers) =>
  fetch(`/communities/${id}`, 'GET', headers);

const communities = ({ headers }) => ({
  findCommunityById: (id) => findCommunityById(id, headers),
  updateCommunity: (id, data) => updateCommunity(id, data, headers),
});

export default communities;
