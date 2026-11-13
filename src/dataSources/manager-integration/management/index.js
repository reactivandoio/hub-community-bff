import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

// REA-48: invites to organize a community or manage an event, and the links they create
// (`community.organizers`, `event.managers`). Run with the integration token, only after the
// resolvers checked who may (services/management-invite).

const INVITE_POPULATE = ['community', 'event', 'accepted_by', 'invited_by'];
const PERSON_FIELDS = ['documentId', 'username', 'email', 'name'];

const createInvite = async (data, headers) => {
  const response = await fetch(`/management-invites?${buildQuery({}, [], {}, '', INVITE_POPULATE)}`, 'POST', headers, { data });
  return response?.data || null;
};

const updateInvite = (documentId, data, headers) =>
  fetch(`/management-invites/${encodeURIComponent(documentId)}`, 'PUT', headers, { data });

const findInvites = async (filters, headers) => {
  const query = buildQuery(filters, [{ createdAt: 'desc' }], { pageSize: 100 }, '', INVITE_POPULATE);
  const response = await fetch(`/management-invites?${query}`, 'GET', headers);
  return response?.data || [];
};

const findInviteByHash = async (tokenHash, headers) => {
  const [invite] = await findInvites({ token_hash: { eq: tokenHash } }, headers);
  return invite || null;
};

const findInvite = async (documentId, headers) => {
  const query = buildQuery({}, [], {}, '', INVITE_POPULATE);
  const response = await fetch(`/management-invites/${encodeURIComponent(documentId)}?${query}`, 'GET', headers);
  return response?.data || null;
};

const peopleQuery = (relation) => {
  const params = new URLSearchParams();
  PERSON_FIELDS.forEach((field, index) => params.append(`populate[${relation}][fields][${index}]`, field));
  return params;
};

const findCommunityOrganizers = async (documentId, headers) => {
  const params = peopleQuery('organizers');
  ['documentId', 'title', 'slug'].forEach((field, index) => params.append(`fields[${index}]`, field));
  const response = await fetch(`/communities/${encodeURIComponent(documentId)}?${params.toString()}`, 'GET', headers);
  return response?.data || null;
};

const findEventManagers = async (slugOrId, headers) => {
  const filters = { or: [{ slug: { eq: slugOrId } }, { documentId: { eq: slugOrId } }] };
  const query = buildQuery(filters, [], { pageSize: 1 }, '', []);
  const params = peopleQuery('managers');
  const response = await fetch(`/events?${query}&${params.toString()}`, 'GET', headers);
  return response?.data?.[0] || null;
};

// Strapi 5 relations: connect / disconnect by documentId, so nothing else in the list changes.
const linkRelation = (collection, documentId, field, action, userDocumentId, headers) =>
  fetch(`/${collection}/${encodeURIComponent(documentId)}`, 'PUT', headers, {
    data: { [field]: { [action]: [userDocumentId] } },
  });

// Events a user manages (REA-48), for the admin's access and the users screen.
const findManagedEvents = async (userId, headers) => {
  const params = new URLSearchParams();
  params.append('filters[managers][id][$eq]', String(userId));
  params.append('filters[deleted_at][$null]', 'true');
  ['documentId', 'title', 'slug'].forEach((field, index) => params.append(`fields[${index}]`, field));
  params.append('pagination[pageSize]', '100');
  params.append('sort[0]', 'start_date:desc');
  const response = await fetch(`/events?${params.toString()}`, 'GET', headers);
  return response?.data || [];
};

const management = ({ headers }) => ({
  createManagementInvite: (data) => createInvite(data, headers),
  updateManagementInvite: (documentId, data) => updateInvite(documentId, data, headers),
  findManagementInvites: (filters) => findInvites(filters, headers),
  findManagementInviteByHash: (tokenHash) => findInviteByHash(tokenHash, headers),
  findManagementInvite: (documentId) => findInvite(documentId, headers),
  findCommunityOrganizers: (documentId) => findCommunityOrganizers(documentId, headers),
  findEventManagers: (slugOrId) => findEventManagers(slugOrId, headers),
  addCommunityOrganizer: (communityId, userDocumentId) =>
    linkRelation('communities', communityId, 'organizers', 'connect', userDocumentId, headers),
  removeCommunityOrganizer: (communityId, userDocumentId) =>
    linkRelation('communities', communityId, 'organizers', 'disconnect', userDocumentId, headers),
  addEventManager: (eventId, userDocumentId) =>
    linkRelation('events', eventId, 'managers', 'connect', userDocumentId, headers),
  removeEventManager: (eventId, userDocumentId) =>
    linkRelation('events', eventId, 'managers', 'disconnect', userDocumentId, headers),
  findManagedEvents: (userId) => findManagedEvents(userId, headers),
});

export default management;
