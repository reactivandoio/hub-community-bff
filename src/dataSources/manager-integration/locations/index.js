import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

const createLocation = (data, headers) =>
  fetch('/locations', 'POST', headers, { data });

const updateLocation = (id, data, headers) =>
  fetch(`/locations/${id}`, 'PUT', headers, { data });

const deleteLocation = (id, headers) =>
  fetch(`/locations/${id}`, 'DELETE', headers);

const locations = ({ headers }) => ({
  createLocation: (data) => createLocation(data, headers),
  updateLocation: (id, data) => updateLocation(id, data, headers),
  deleteLocation: (id) => deleteLocation(id, headers),
});

export default locations;
