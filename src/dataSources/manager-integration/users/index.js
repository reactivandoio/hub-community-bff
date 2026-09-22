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

// Strapi caps pageSize at 100; keep chunks well under it so every match comes back.
const EMAILS_PER_REQUEST = 50;

// Users-permissions only reads `$in` in indexed form (filters[email][$in][0]=...),
// which buildQuery does not produce (it joins arrays with commas).
const findUsersByEmails = async (emails, headers) => {
  const unique = [...new Set(emails.map((e) => (e || '').trim().toLowerCase()).filter(Boolean))];
  const results = [];
  for (let i = 0; i < unique.length; i += EMAILS_PER_REQUEST) {
    const params = new URLSearchParams();
    unique.slice(i, i + EMAILS_PER_REQUEST).forEach((email, index) => {
      params.append(`filters[email][$in][${index}]`, email);
    });
    params.append('pagination[pageSize]', '100');
    ['id', 'email', 'name', 'username', 'cpf'].forEach((f, index) => params.append(`fields[${index}]`, f));
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`/users?${params.toString()}`, 'GET', headers);
    results.push(...(response?.data || []));
  }
  return results;
};

const users = ({ headers }) => ({
  updateUser: (id, data) => updateUser(id, data, headers),
  findUserByIdIntegration: (id) => findUserById(id, headers),
  findUserByEmail: (email) => findUserByEmail(email, headers),
  findUsersByEmails: (emails) => findUsersByEmails(emails, headers),
});

export default users;
