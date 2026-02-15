/* eslint-disable import/no-extraneous-dependencies */
import dotenv from 'dotenv';
import { buildQuery, createStrapiFetch } from '../../utils/network/strapi/helpers';

dotenv.config();

// Create fetch function with MANAGER_URL
const fetch = createStrapiFetch(process.env.MANAGER_URL);

// Event methods
const findEvents = async (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
) => {
  const populate = [
    'talks.speakers',
    'talks.speakers.avatar',
    'images',
    'communities',
    'location',
    'tags',
    'products',
    'products.batches',
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
    'products',
    'products.batches',
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
  search = '',
) => {
  const populate = ['events', 'tags', 'location', 'organizers', 'images', 'links'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/communities${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findCommunityById = async (id) => {
  const populate = ['events', 'tags', 'location', 'organizers', 'images', 'links'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/communities/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

// Talk methods
const findTalks = async (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
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
  search = '',
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
  search = '',
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
  search = '',
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
// Strapi User: agenda = oneToMany relation with Agenda
const userPopulate = [
  'communities',
  'speaker',
  'speaker.avatar',
  'agenda',
  'agenda.event',
];

const findUsers = async (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
) => {
  const query = buildQuery(filters, sort, pagination, search, userPopulate);
  const route = `/users${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findUserById = async (id) => {
  const query = buildQuery({}, [], {}, '', userPopulate);
  const route = `/users/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findUserByUsername = async (username) => {
  const filters = { username: { eq: username } };
  const pagination = { pageSize: 1 };
  const query = buildQuery(filters, [], pagination, '', userPopulate);
  const route = `/users${query ? `?${query}` : ''}`;
  const response = await fetch(route, 'GET');
  const first = response?.data?.[0] ?? null;
  return first;
};

// Comment methods
const findComments = async (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
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

// Rate methods
const findRates = async (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
) => {
  const populate = ['user', 'event', 'talk'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/rates${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findRateById = async (id) => {
  const populate = ['user', 'event', 'talk'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/rates/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const createRate = async (input) => {
  const route = '/rates';
  return fetch(route, 'POST', {}, { data: input });
};

const updateRate = async (id, input) => {
  const route = `/rates/${id}`;
  return fetch(route, 'PUT', {}, { data: input });
};

const deleteRate = async (id) => {
  const route = `/rates/${id}`;
  return fetch(route, 'DELETE');
};

// CommentReply methods
const findCommentReplies = async (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
) => {
  const populate = ['parent_comment', 'user_creator', 'users_taggeds'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/comment-replies${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findCommentReplyById = async (id) => {
  const populate = ['parent_comment', 'user_creator', 'users_taggeds'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/comment-replies/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const createCommentReply = async (input) => {
  const route = '/comment-replies';
  return fetch(route, 'POST', {}, { data: input });
};

const updateCommentReply = async (id, input) => {
  const route = `/comment-replies/${id}`;
  return fetch(route, 'PUT', {}, { data: input });
};

const deleteCommentReply = async (id) => {
  const route = `/comment-replies/${id}`;
  return fetch(route, 'DELETE');
};

// Agenda methods
const findAgendas = async (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
) => {
  const populate = ['event', 'talks', 'comment'];

  const query = buildQuery(filters, sort, pagination, search, populate);
  const route = `/agendas${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const findAgendaById = async (id) => {
  const populate = ['event', 'talks', 'comment'];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/agendas/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET');
};

const createAgenda = async (input) => {
  const route = '/agendas';
  return fetch(route, 'POST', {}, { data: input });
};

const updateAgenda = async (id, input) => {
  const route = `/agendas/${id}`;
  return fetch(route, 'PUT', {}, { data: input });
};

const deleteAgenda = async (id) => {
  const route = `/agendas/${id}`;
  return fetch(route, 'DELETE');
};

export default () => ({
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
  findUserByUsername,
  // Comments
  findComments,
  findCommentById,
  // Rates
  findRates,
  findRateById,
  createRate,
  updateRate,
  deleteRate,
  // CommentReplies
  findCommentReplies,
  findCommentReplyById,
  createCommentReply,
  updateCommentReply,
  deleteCommentReply,
  // Agendas
  findAgendas,
  findAgendaById,
  createAgenda,
  updateAgenda,
  deleteAgenda,
});
