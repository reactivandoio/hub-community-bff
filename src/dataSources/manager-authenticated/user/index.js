import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

const cachedMe = new Map();

const me = async ({ headers, userId }) => {
  if (cachedMe.has(userId)) {
    const cachedUser = cachedMe.get(userId);
    return cachedUser;
  }

  try {
    const response = await fetch('/users/me', 'GET', headers);
    cachedMe.set(userId, response);
    return response;
  } catch (error) {
    throw new Error(error);
  }
};

const updateUser = async ({ id, data, headers }) => {
  const route = `/users/${id}`;
  return fetch(route, 'PUT', headers, data);
};

const user = ({ headers }) => ({
  me: ({ userId }) => me({ headers, userId }),
  updateUser: (id, data) => updateUser({ id, data, headers }),
});

export default user;
