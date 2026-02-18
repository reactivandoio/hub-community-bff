import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

const createEvent = (data, headers) =>
  fetch('/events', 'POST', headers, { data });

const updateEvent = (id, data, headers) =>
  fetch(`/events/${id}`, 'PUT', headers, { data });

const events = ({ headers }) => ({
  createEvent: (data) => createEvent(data, headers),
  updateEvent: (id, data) => updateEvent(id, data, headers),
});

export default events;
