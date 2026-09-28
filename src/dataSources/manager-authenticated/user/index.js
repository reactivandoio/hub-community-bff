import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

const updateUser = async ({ id, data, headers }) => {
  const route = `/users/${id}`;
  return fetch(route, 'PUT', headers, data);
};

// Uncached read of the current user, for callers that need the profile as it is now.
// The request user (context) comes from utils/auth, which verifies the token first.
const fetchMe = async ({ headers }) => fetch('/users/me', 'GET', headers);

const user = ({ headers }) => ({
  fetchMe: () => fetchMe({ headers }),
  updateUser: (id, data) => updateUser({ id, data, headers }),
});

export default user;
