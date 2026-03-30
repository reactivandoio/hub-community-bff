import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createSpeaker = (data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/speakers${query ? `?${query}` : ''}`;
  return fetch(route, 'POST', headers, { data });
};

const updateSpeaker = (id, data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/speakers/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'PUT', headers, { data });
};

const deleteSpeaker = (args, headers) =>
  fetch('/speakers', 'DELETE', headers, { data: args });

const findSpeakers = (args, headers) => {
  const {
    filters = {},
    sort = [],
    pagination = {},
    search = '',
    populate = [],
  } = args;
  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/speakers${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const findSpeakerById = (id, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/speakers/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const speakers = ({ headers }) => ({
  findSpeakers: (args) => findSpeakers(args, headers),
  findSpeakerById: (id, populate) => findSpeakerById(id, headers, populate),
  createSpeaker: (data, populate) => createSpeaker(data, headers, populate),
  updateSpeaker: (id, data, populate) =>
    updateSpeaker(id, data, headers, populate),
  deleteSpeaker: (args) => deleteSpeaker(args, headers),
  deleteSpeakerById: (id) => fetch(`/speakers/${id}`, 'DELETE', headers),
});

export default speakers;
