import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

// Minimal reads used by utils/auth to decide who may do what. They run with the
// integration token, only after the request token was verified.

const findUserWithRole = (id, headers) => {
  const query = buildQuery({}, [], {}, '', ['role']);
  return fetch(`/users/${encodeURIComponent(id)}?${query}`, 'GET', headers);
};

// An event is addressed by its slug or by its Hub documentId (the Eventando `uuid`).
const findEventWithOrganizers = async (slugOrId, headers) => {
  const filters = {
    or: [
      { slug: { eq: slugOrId } },
      { documentId: { eq: slugOrId } },
    ],
  };
  const query = buildQuery(filters, [], { pageSize: 1 }, '', ['communities.organizers']);
  const response = await fetch(`/events?${query}`, 'GET', headers);
  return response?.data?.[0] || null;
};

const findCommunityWithOrganizers = async (id, headers) => {
  const query = buildQuery({}, [], {}, '', ['organizers']);
  const response = await fetch(`/communities/${encodeURIComponent(id)}?${query}`, 'GET', headers);
  return response?.data || null;
};

const findOneWith = (collection, populate) => async (id, headers) => {
  const query = buildQuery({}, [], {}, '', populate);
  const response = await fetch(`/${collection}/${encodeURIComponent(id)}?${query}`, 'GET', headers);
  return response?.data || null;
};

const findTalkWithEvent = findOneWith('talks', ['event']);
const findCommentWithAuthor = findOneWith('comments', ['user_creator']);
const findCommentReplyWithAuthor = findOneWith('comment-replies', ['user_creator']);
const findRateWithAuthor = findOneWith('rates', ['users_permissions_user']);
const findCertificateRequestFormWithEvent = findOneWith('certificate-request-forms', ['event']);

// Writes that happen only after the author/admin check in the resolver.
const createCommentReply = (data, headers) => fetch('/comment-replies', 'POST', headers, { data });
const updateCommentReply = (id, data, headers) =>
  fetch(`/comment-replies/${encodeURIComponent(id)}`, 'PUT', headers, { data });
const deleteCommentReply = (id, headers) =>
  fetch(`/comment-replies/${encodeURIComponent(id)}`, 'DELETE', headers);

const createRate = (data, headers) => fetch('/rates', 'POST', headers, { data });
const updateRate = (id, data, headers) =>
  fetch(`/rates/${encodeURIComponent(id)}`, 'PUT', headers, { data });
const deleteRate = (id, headers) => fetch(`/rates/${encodeURIComponent(id)}`, 'DELETE', headers);

const authz = ({ headers }) => ({
  findUserWithRole: (id) => findUserWithRole(id, headers),
  findEventWithOrganizers: (slugOrId) => findEventWithOrganizers(slugOrId, headers),
  findCommunityWithOrganizers: (id) => findCommunityWithOrganizers(id, headers),
  findTalkWithEvent: (id) => findTalkWithEvent(id, headers),
  findCommentWithAuthor: (id) => findCommentWithAuthor(id, headers),
  findCommentReplyWithAuthor: (id) => findCommentReplyWithAuthor(id, headers),
  findRateWithAuthor: (id) => findRateWithAuthor(id, headers),
  findCertificateRequestFormWithEvent: (id) => findCertificateRequestFormWithEvent(id, headers),
  createCommentReplyAsIntegration: (data) => createCommentReply(data, headers),
  updateCommentReplyAsIntegration: (id, data) => updateCommentReply(id, data, headers),
  deleteCommentReplyAsIntegration: (id) => deleteCommentReply(id, headers),
  createRateAsIntegration: (data) => createRate(data, headers),
  updateRateAsIntegration: (id, data) => updateRate(id, data, headers),
  deleteRateAsIntegration: (id) => deleteRate(id, headers),
});

export default authz;
