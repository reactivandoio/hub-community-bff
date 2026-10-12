import axios from 'axios';
import dotenv from 'dotenv';
import managerNetworkUtils from '../../../utils/network/manager';

dotenv.config();

const { fetch } = managerNetworkUtils;

// Reads and writes of the Hub admin's user and role screen (REA-10). They run with the
// integration token, only after resolvers/Admin checked the request user is an admin.

const USER_FIELDS = ['id', 'documentId', 'username', 'email', 'name', 'blocked'];

// Free text over username, e-mail and name, and role. /users reads them under `filters`;
// /users/count passes its whole query to the database as `where`, so there they go bare.
const userFilterParams = ({ search, roleType } = {}, prefix = 'filters') => {
  const key = (path) => (prefix ? `${prefix}${path}` : path.replace(/^\[([^\]]+)\]/, '$1'));
  const params = new URLSearchParams();
  if (search) {
    ['username', 'email', 'name'].forEach((field, index) => {
      params.append(key(`[$or][${index}][${field}][$containsi]`), search);
    });
  }
  if (roleType) params.append(key('[role][type][$eq]'), roleType);
  return params;
};

// /users/count answers a bare number, which the shared fetch (it reshapes objects) drops.
const count = async (route, headers) => {
  const response = await axios.get(`${process.env.MANAGER_URL}/api${route}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  return Number(response.data) || 0;
};

const findUsers = async ({ search, roleType, page, pageSize }, headers) => {
  const params = userFilterParams({ search, roleType });
  // The users-permissions /users ignores pagination[...]; it reads start/limit.
  params.append('start', String((page - 1) * pageSize));
  params.append('limit', String(pageSize));
  params.append('sort[0]', 'id:asc');
  USER_FIELDS.forEach((field, index) => params.append(`fields[${index}]`, field));
  params.append('populate[role][fields][0]', 'type');
  params.append('populate[role][fields][1]', 'name');
  ['documentId', 'title', 'slug'].forEach((field, index) => {
    params.append(`populate[communities][fields][${index}]`, field);
  });
  const response = await fetch(`/users?${params.toString()}`, 'GET', headers);
  return response?.data || [];
};

const countUsers = ({ search, roleType } = {}, headers) => {
  const query = userFilterParams({ search, roleType }, '').toString();
  return count(`/users/count${query ? `?${query}` : ''}`, headers);
};

// Admins who can still sign in (blocked is false or was never set).
const countActiveAdmins = (headers) => {
  const params = userFilterParams({ roleType: 'admin' }, '');
  params.append('$or[0][blocked][$eq]', 'false');
  params.append('$or[1][blocked][$null]', 'true');
  return count(`/users/count?${params.toString()}`, headers);
};

const findUser = async (id, headers) => {
  const params = new URLSearchParams();
  USER_FIELDS.forEach((field, index) => params.append(`fields[${index}]`, field));
  params.append('populate[role][fields][0]', 'type');
  params.append('populate[role][fields][1]', 'name');
  ['documentId', 'title', 'slug'].forEach((field, index) => {
    params.append(`populate[communities][fields][${index}]`, field);
  });
  const response = await fetch(`/users/${encodeURIComponent(id)}?${params.toString()}`, 'GET', headers);
  return response?.data || null;
};

const findRoles = async (headers) => {
  const response = await fetch('/users-permissions/roles', 'GET', headers);
  return response?.data?.roles || [];
};

const setUserRoleId = (id, roleId, headers) =>
  fetch(`/users/${encodeURIComponent(id)}`, 'PUT', headers, { role: roleId });

// Communities a user organizes (what a community-manager manages).
const findOrganizedCommunities = async (userId, headers) => {
  const params = new URLSearchParams();
  params.append('filters[organizers][id][$eq]', String(userId));
  ['documentId', 'title', 'slug'].forEach((field, index) => params.append(`fields[${index}]`, field));
  params.append('pagination[pageSize]', '100');
  params.append('sort[0]', 'title:asc');
  const response = await fetch(`/communities?${params.toString()}`, 'GET', headers);
  return response?.data || [];
};

const createRoleChange = (data, headers) => fetch('/role-changes', 'POST', headers, { data });

const findRoleChanges = async ({ targetId, page, pageSize }, headers) => {
  const params = new URLSearchParams();
  if (targetId) params.append('filters[target][id][$eq]', String(targetId));
  params.append('pagination[page]', String(page));
  params.append('pagination[pageSize]', String(pageSize));
  params.append('sort[0]', 'createdAt:desc');
  params.append('populate[actor][fields][0]', 'id');
  params.append('populate[target][fields][0]', 'id');
  const response = await fetch(`/role-changes?${params.toString()}`, 'GET', headers);
  return { data: response?.data || [], total: response?.meta?.total || 0 };
};

const adminUsers = ({ headers }) => ({
  adminFindUsers: (args) => findUsers(args, headers),
  adminCountUsers: (args) => countUsers(args, headers),
  adminCountActiveAdmins: () => countActiveAdmins(headers),
  adminFindUser: (id) => findUser(id, headers),
  adminFindRoles: () => findRoles(headers),
  adminSetUserRoleId: (id, roleId) => setUserRoleId(id, roleId, headers),
  adminFindOrganizedCommunities: (userId) => findOrganizedCommunities(userId, headers),
  adminCreateRoleChange: (data) => createRoleChange(data, headers),
  adminFindRoleChanges: (args) => findRoleChanges(args, headers),
});

export default adminUsers;
