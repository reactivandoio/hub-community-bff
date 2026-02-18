import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

const createEvent = (data, headers) =>
  fetch('/events', 'POST', headers, { data });

const events = ({ headers }) => ({
  createEvent: (data) => createEvent(data, headers),
});

export default events;
