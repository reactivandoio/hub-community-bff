import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createTalk = (data, headers) =>
  fetch('/talks', 'POST', headers, { data });

const updateTalk = (id, data, headers) =>
  fetch(`/talks/${id}`, 'PUT', headers, { data });

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

const findTalkById = (id, headers) => fetch(`/talks/${id}`, 'GET', headers);

const talks = ({ headers }) => ({
  findTalks: (args) => findTalks(args, headers),
  findTalkById: (id) => findTalkById(id, headers),
  createTalk: (data) => createTalk(data, headers),
  updateTalk: (id, data) => updateTalk(id, data, headers),
  deleteTalk: (id) => deleteTalk(id, headers),
});

export default talks;
