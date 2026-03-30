import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createTalk = (data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/talks${query ? `?${query}` : ''}`;
  return fetch(route, 'POST', headers, { data });
};

const updateTalk = (id, data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/talks/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'PUT', headers, { data });
};

const deleteTalk = (id, headers) => fetch(`/talks/${id}`, 'DELETE', headers);

const findTalks = (args, headers) => {
  const {
    filters = {},
    sort = [],
    pagination = {},
    search = '',
    populate = [],
  } = args;
  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/talks${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const findTalkById = (id, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/talks/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const talks = ({ headers }) => ({
  findTalks: (args) => findTalks(args, headers),
  findTalkById: (id, populate) => findTalkById(id, headers, populate),
  createTalk: (data, populate) => createTalk(data, headers, populate),
  updateTalk: (id, data, populate) => updateTalk(id, data, headers, populate),
  deleteTalk: (id) => deleteTalk(id, headers),
});

export default talks;
