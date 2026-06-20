import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const findAttendances = async (eventDocumentId, headers) => {
  const filters = {
    event: { documentId: { eq: eventDocumentId } },
  };
  const pagination = { pageSize: 100 };
  const populate = ['users_permissions_user', 'event'];
  const query = buildQuery(filters, [], pagination, '', populate);
  const route = `/attendances${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const findAttendanceByUserAndEvent = async (userDocumentId, eventDocumentId, headers) => {
  const filters = {
    users_permissions_user: { documentId: { eq: userDocumentId } },
    event: { documentId: { eq: eventDocumentId } },
  };
  const pagination = { pageSize: 1 };
  const query = buildQuery(filters, [], pagination, '', []);
  const route = `/attendances${query ? `?${query}` : ''}`;
  return fetch(route, 'GET', headers);
};

const createAttendance = async (data, headers) => {
  const route = '/attendances';
  return fetch(route, 'POST', headers, { data });
};

const attendances = ({ headers }) => ({
  findAttendances: (eventDocumentId) => findAttendances(eventDocumentId, headers),
  findAttendanceByUserAndEvent: (userDocumentId, eventDocumentId) =>
    findAttendanceByUserAndEvent(userDocumentId, eventDocumentId, headers),
  createAttendance: (data) => createAttendance(data, headers),
});

export default attendances;
