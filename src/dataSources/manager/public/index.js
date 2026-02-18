import makeRequest from '../makeRequest';

const { fetch, buildQuery } = makeRequest;

// Event methods
const findEvents = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = [
    'talks.speakers',
    'talks.speakers.avatar',
    'images',
    'communities',
    'location',
    'tags',
  ];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/events${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findEventById = async (id) => {
  const populate = [
    'talks.speakers',
    'talks.speakers.avatar',
    'images',
    'communities',
    'location',
    'tags',
  ];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/events/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// Community methods
const findCommunities = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = ['events', 'tags', 'location', 'organizers', 'images'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/communities${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findCommunityById = async (id) => {
  const populate = ['events', 'tags', 'location', 'organizers', 'images'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/communities/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// Talk methods
const findTalks = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = ['speakers', 'speakers.avatar', 'event'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/talks${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findTalkById = async (id) => {
  const populate = ['speakers', 'speakers.avatar', 'event'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/talks/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// Speaker methods
const findSpeakers = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = ['talks', 'avatar'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/speakers${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findSpeakerById = async (id) => {
  const populate = ['talks', 'avatar'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/speakers/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// Location methods
const findLocations = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = ['events', 'communities'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/locations${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findLocationById = async (id) => {
  const populate = ['events', 'communities'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/locations/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// Tag methods
const findTags = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = ['events', 'communities'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/tags${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findTagById = async (id) => {
  const populate = ['events', 'communities'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/tags/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// User methods
const findUsers = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = ['communities'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/users${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findUserById = async (id) => {
  const populate = ['communities'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/users/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// Comment methods
const findComments = async (
  filters = {},
  sort = [],
  pagination = {},
  search = ''
) => {
  const populate = ['user', 'event'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/comments${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findCommentById = async (id) => {
  const populate = ['user', 'event'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/comments/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

export default ({ headers }) => ({
  // Events
  findEvents,
  findEventById,
  // Communities
  findCommunities,
  findCommunityById,
  // Talks
  findTalks,
  findTalkById,
  // Speakers
  findSpeakers,
  findSpeakerById,
  // Locations
  findLocations,
  findLocationById,
  // Tags
  findTags,
  findTagById,
  // Users
  findUsers,
  findUserById,
  // Comments
  findComments,
  findCommentById,
});
