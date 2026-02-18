import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createAgenda = (data, headers) =>
  fetch('/agendas', 'POST', headers, { data });

const updateAgenda = (
  id,
  data,
  headers,
  {
    filters = {},
    sort = [],
    populate = [],
    search = '',
    ...additionalProps
  } = {},
) => {
  const query = buildQuery(filters, sort, {}, search, populate);

  const route = `/agendas/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'PUT', headers, { data, ...additionalProps });
};

const deleteAgenda = (id, headers) =>
  fetch(`/agendas/${id}`, 'DELETE', headers);

const findAgenda = (
  id,
  headers,
  {
    filters = {},
    sort = [],
    populate = [],
    search = '',
    ...additionalProps
  } = {},
) => {
  const query = buildQuery(
    { ...filters }, // Include the ID in filters
    sort,
    {}, // pagination not applicable for single item
    search,
    populate,
  );

  const route = `/agendas/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers, additionalProps);
};

const findAgendas = async (
  { filters = {}, sort = [], pagination = {}, search = '', populate = [] },
  headers,
) => {
  const query = buildQuery(filters, sort, pagination, search, populate);

  const route = `/agendas${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const agendas = ({ headers }) => ({
  findAgendas: (args) => findAgendas(args, headers),
  findAgenda: (id, options = {}) => findAgenda(id, headers, options),
  createAgenda: (data) => createAgenda(data, headers),
  updateAgenda: (id, data, options = {}) =>
    updateAgenda(id, data, headers, options),
  deleteAgenda: (id) => deleteAgenda(id, headers),
});

export default agendas;
