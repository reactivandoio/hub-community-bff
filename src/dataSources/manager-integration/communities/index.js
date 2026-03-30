import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const updateCommunity = (id, data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/communities/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'PUT', headers, { data });
};

const findCommunityById = (id, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/communities/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const createCommunity = (data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/communities${query ? `?${query}` : ''}`;
  return fetch(route, 'POST', headers, { data });
};

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
  findCommunityById: (id, populate) => findCommunityById(id, headers, populate),
  updateCommunity: (id, data, populate) =>
    updateCommunity(id, data, headers, populate),
  createCommunity: (data, populate) => createCommunity(data, headers, populate),
  deleteCommunity: (id) => deleteCommunity(id, headers),
});

export default communities;
