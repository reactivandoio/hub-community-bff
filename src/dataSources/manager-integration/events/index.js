import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createEvent = (data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/events${query ? `?${query}` : ''}`;
  return fetch(route, 'POST', headers, { data });
};

const updateEvent = (id, data, headers, populate = []) => {
  const query = buildQuery({}, [], {}, '', populate);
  const route = `/events/${id}${query ? `?${query}` : ''}`;
  return fetch(route, 'PUT', headers, { data });
};

const events = ({ headers }) => ({
  createEvent: (data, populate) => createEvent(data, headers, populate),
  updateEvent: (id, data, populate) => updateEvent(id, data, headers, populate),
});

export default events;
