import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createComment = (data, headers) =>
  fetch('/comments', 'POST', headers, { data });

const deleteComment = (id, headers) =>
  fetch(`/comments/${id}`, 'DELETE', headers);

const findComments = async (
  { filters = {}, sort = [], pagination = {}, search = '', populate = [] },
  headers,
) => {
  let query;

  try {
    query = buildQuery(filters, sort, pagination, search, populate);
  } catch (err) {
    throw new Error(`Error building query: ${err.message}`);
  }

  const route = `/comments${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const comments = ({ headers }) => ({
  findComments: (args) => findComments(args, headers),
  createComment: (data) => createComment(data, headers),
  deleteComment: (id) => deleteComment(id, headers),
});

export default comments;
