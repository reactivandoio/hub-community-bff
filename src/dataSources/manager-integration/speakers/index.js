import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createSpeaker = (data, headers) =>
  fetch('/speakers', 'POST', headers, { data });

const updateSpeaker = (id, data, headers) =>
  fetch(`/speakers/${id}`, 'PUT', headers, { data });

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

const findSpeakerById = (id, headers) =>
  fetch(`/speakers/${id}`, 'GET', headers);

const speakers = ({ headers }) => ({
  findSpeakers: (args) => findSpeakers(args, headers),
  findSpeakerById: (id) => findSpeakerById(id, headers),
  createSpeaker: (data) => createSpeaker(data, headers),
  updateSpeaker: (id, data) => updateSpeaker(id, data, headers),
  deleteSpeaker: (args) => deleteSpeaker(args, headers),
  deleteSpeakerById: (id) => fetch(`/speakers/${id}`, 'DELETE', headers),
});

export default speakers;
