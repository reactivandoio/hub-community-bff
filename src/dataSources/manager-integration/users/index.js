import { createStrapiFetch } from '../../../utils/network/strapi/helpers';
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

const users = ({ headers }) => ({
  updateUser: (id, data) => updateUser(id, data, headers),
  findUserByIdIntegration: (id) => findUserById(id, headers),
});

export default users;
