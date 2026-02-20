import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const updateCommunity = (id, data, headers) =>
  fetch(`/communities/${id}`, 'PUT', headers, { data });

const findCommunityById = (id, headers) =>
  fetch(`/communities/${id}`, 'GET', headers);

const createCommunity = (data, headers) =>
  fetch('/communities', 'POST', headers, { data });

const deleteCommunity = (id, headers) =>
  fetch(`/communities/${id}`, 'DELETE', headers);

const findCommunities = (args, headers) => {
  const {
    filters = {},
    sort = [],
    pagination = {},
    search = '',
    populate = [],
  } = args;
  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/communities${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const communities = ({ headers }) => ({
  findCommunities: (args) => findCommunities(args, headers),
  findCommunityById: (id) => findCommunityById(id, headers),
  updateCommunity: (id, data) => updateCommunity(id, data, headers),
  createCommunity: (data) => createCommunity(data, headers),
  deleteCommunity: (id) => deleteCommunity(id, headers),
});

export default communities;
