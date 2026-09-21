import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const PAGE_SIZE = 100;
const POPULATE = ['event'];

const findCertificateRequestFormsByEvent = async (eventDocumentId, headers) => {
  const filters = { event: { documentId: { eq: eventDocumentId } } };
  const query = buildQuery(filters, [{ createdAt: 'asc' }], { pageSize: PAGE_SIZE }, '', POPULATE);
  return fetch(`/certificate-request-forms?${query}`, 'GET', headers);
};

const findCertificateRequestFormBySlug = async (slug, headers) => {
  const filters = { slug: { eq: slug } };
  const query = buildQuery(filters, [], { pageSize: 1 }, '', ['event', 'event.location', 'event.communities']);
  return fetch(`/certificate-request-forms?${query}`, 'GET', headers);
};

const createCertificateRequestForm = (data, headers) => {
  const query = buildQuery({}, [], {}, '', POPULATE);
  return fetch(`/certificate-request-forms?${query}`, 'POST', headers, { data });
};

const updateCertificateRequestForm = (documentId, data, headers) => {
  const query = buildQuery({}, [], {}, '', POPULATE);
  return fetch(`/certificate-request-forms/${encodeURIComponent(documentId)}?${query}`, 'PUT', headers, { data });
};

const deleteCertificateRequestForm = (documentId, headers) =>
  fetch(`/certificate-request-forms/${encodeURIComponent(documentId)}`, 'DELETE', headers);

const certificateRequestForms = ({ headers }) => ({
  findCertificateRequestFormsByEvent: (eventDocumentId) =>
    findCertificateRequestFormsByEvent(eventDocumentId, headers),
  findCertificateRequestFormBySlug: (slug) => findCertificateRequestFormBySlug(slug, headers),
  createCertificateRequestForm: (data) => createCertificateRequestForm(data, headers),
  updateCertificateRequestForm: (documentId, data) =>
    updateCertificateRequestForm(documentId, data, headers),
  deleteCertificateRequestForm: (documentId) => deleteCertificateRequestForm(documentId, headers),
});

export default certificateRequestForms;
