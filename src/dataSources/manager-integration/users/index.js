import { createStrapiFetch, buildQuery } from '../../../utils/network/strapi/helpers';
import dotenv from 'dotenv';

dotenv.config();

const fetch = createStrapiFetch(process.env.MANAGER_URL);

const updateUser = async (id, data, headers) => {
  const route = `/users/${id}`;
  return fetch(route, 'PUT', headers, data);
};

const findUserById = async (id, headers) => {
  const route = `/users/${id}`;
  return fetch(route, 'GET', headers);
};

const findUserByEmail = async (email, headers) => {
  const query = buildQuery({ email: { eq: email } }, [], { pageSize: 1 });
  const route = `/users${query ? `?${query}` : ''}`;
  const response = await fetch(route, 'GET', headers);
  return response?.data?.[0] ?? null;
};

const users = ({ headers }) => ({
  updateUser: (id, data) => updateUser(id, data, headers),
  findUserByIdIntegration: (id) => findUserById(id, headers),
  findUserByEmail: (email) => findUserByEmail(email, headers),
});

export default users;
