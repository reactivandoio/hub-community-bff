import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch, buildQuery } = eventandoNetworkUtils;

const createEvent = (data, headers) =>
  fetch('/events', 'POST', headers, { data });

const updateEvent = (id, data, headers) =>
  fetch(`/events/${id}`, 'PUT', headers, { data });

const deleteEvent = (id, headers) => fetch(`/events/${id}`, 'DELETE', headers);

const findEvent = async (id, headers) => {
  const populate = [
    'products',
    'products.batches',
    'talks.speakers',
    'talks.speakers.avatar',
    'images',
    'communities',
    'location',
    'tags',
  ];

  const query = buildQuery({}, [], {}, '', populate);
  const route = `/events/${id}${query ? `?${query}` : ''}`;

  return fetch(route, 'GET', headers);
};

const events = ({ headers }) => ({
  createEvent: (data) => createEvent(data, headers),
  updateEvent: (id, data) => updateEvent(id, data, headers),
  deleteEvent: (id) => deleteEvent(id, headers),
  findEvent: (id) => findEvent(id, headers),
});

export default events;
