import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const PAGE_SIZE = 100;

// Walks every page of a Strapi collection and returns a flat array.
const fetchAllPages = async (buildRoute, headers) => {
  let all = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const response = await fetch(buildRoute({ page, pageSize: PAGE_SIZE }), 'GET', headers);
    all = [...all, ...(response?.data || [])];
    const meta = response?.meta;
    if (meta && page < meta.pageCount) {
      page += 1;
    } else {
      hasMore = false;
    }
  }
  return all;
};

const CONFIG_POPULATE = ['logo', 'background', 'sponsors.logo', 'signatures.image', 'event'];
const CERTIFICATE_POPULATE = ['event', 'event.location', 'event.communities', 'users_permissions_user'];

const findEventByDocumentId = (documentId, headers) => {
  const query = buildQuery({}, [], {}, '', ['location', 'communities', 'images']);
  return fetch(`/events/${encodeURIComponent(documentId)}?${query}`, 'GET', headers);
};

const findCertificateConfigByEvent = (eventDocumentId, headers) => {
  const filters = { event: { documentId: { eq: eventDocumentId } } };
  const query = buildQuery(filters, [], { pageSize: 1 }, '', CONFIG_POPULATE);
  return fetch(`/certificate-configs?${query}`, 'GET', headers);
};

const createCertificateConfig = (data, headers) => {
  const query = buildQuery({}, [], {}, '', CONFIG_POPULATE);
  return fetch(`/certificate-configs?${query}`, 'POST', headers, { data });
};

const updateCertificateConfig = (documentId, data, headers) => {
  const query = buildQuery({}, [], {}, '', CONFIG_POPULATE);
  return fetch(`/certificate-configs/${documentId}?${query}`, 'PUT', headers, { data });
};

const findCertificateByCode = (code, headers) => {
  const filters = { code: { eq: code } };
  const query = buildQuery(filters, [], { pageSize: 1 }, '', CERTIFICATE_POPULATE);
  return fetch(`/certificates?${query}`, 'GET', headers);
};

const findCertificateByEventAndIdentifier = (
  eventDocumentId,
  identifier,
  headers,
  { includeRevoked = false } = {},
) => {
  const filters = {
    event: { documentId: { eq: eventDocumentId } },
    identifier: { eq: identifier },
    ...(includeRevoked ? {} : { revoked_at: { null: true } }),
  };
  const sort = includeRevoked ? [{ createdAt: 'desc' }] : [];
  const query = buildQuery(filters, sort, { pageSize: 1 }, '', CERTIFICATE_POPULATE);
  return fetch(`/certificates?${query}`, 'GET', headers);
};

const findCertificatesByEvent = (eventDocumentId, headers) =>
  fetchAllPages((pagination) => {
    const filters = {
      event: { documentId: { eq: eventDocumentId } },
      revoked_at: { null: true },
    };
    const query = buildQuery(filters, [{ createdAt: 'desc' }], pagination, '', ['users_permissions_user']);
    return `/certificates?${query}`;
  }, headers);

const createCertificate = (data, headers) => {
  const query = buildQuery({}, [], {}, '', CERTIFICATE_POPULATE);
  return fetch(`/certificates?${query}`, 'POST', headers, { data });
};

const updateCertificate = (documentId, data, headers) => {
  const query = buildQuery({}, [], {}, '', CERTIFICATE_POPULATE);
  return fetch(`/certificates/${documentId}?${query}`, 'PUT', headers, { data });
};

const findAttendancesByEvent = (eventDocumentId, headers) =>
  fetchAllPages((pagination) => {
    const filters = { event: { documentId: { eq: eventDocumentId } } };
    const query = buildQuery(filters, [], pagination, '', ['users_permissions_user']);
    return `/attendances?${query}`;
  }, headers);

const findParticipantsByEvent = (eventDocumentId, headers) =>
  fetchAllPages((pagination) => {
    const filters = { event: { documentId: { eq: eventDocumentId } } };
    const query = buildQuery(filters, [{ createdAt: 'desc' }], pagination, '', []);
    return `/participants?${query}`;
  }, headers);

const certificates = ({ headers }) => ({
  findEventByDocumentId: (documentId) => findEventByDocumentId(documentId, headers),
  findCertificateConfigByEvent: (eventDocumentId) =>
    findCertificateConfigByEvent(eventDocumentId, headers),
  createCertificateConfig: (data) => createCertificateConfig(data, headers),
  updateCertificateConfig: (documentId, data) =>
    updateCertificateConfig(documentId, data, headers),
  findCertificateByCode: (code) => findCertificateByCode(code, headers),
  findCertificateByEventAndIdentifier: (eventDocumentId, identifier, options) =>
    findCertificateByEventAndIdentifier(eventDocumentId, identifier, headers, options),
  findCertificatesByEvent: (eventDocumentId) => findCertificatesByEvent(eventDocumentId, headers),
  createCertificate: (data) => createCertificate(data, headers),
  updateCertificate: (documentId, data) => updateCertificate(documentId, data, headers),
  findAttendancesByEvent: (eventDocumentId) => findAttendancesByEvent(eventDocumentId, headers),
  findParticipantsByEvent: (eventDocumentId) => findParticipantsByEvent(eventDocumentId, headers),
});

export default certificates;
