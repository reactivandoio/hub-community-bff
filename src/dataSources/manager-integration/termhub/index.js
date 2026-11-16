import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

// REA-51: api::termhub-credential (each admin user's termhub token, encrypted here in the bff, and
// project) and api::ai-text-run (AI drafts of e-mail campaign texts). Collections granted to no
// role: integration token only. The URLs logged by the shared fetch carry only ids, never a token.

const findTermhubCredential = async (userId, headers) => {
  const query = buildQuery({ user_id: { eq: Number(userId) } }, [], { pageSize: 1 });
  const response = await fetch(`/termhub-credentials?${query}`, 'GET', headers);
  return response?.data?.[0] || null;
};

const createTermhubCredential = async (data, headers) => {
  const response = await fetch('/termhub-credentials', 'POST', headers, { data });
  return response?.data || null;
};

const updateTermhubCredential = async (documentId, data, headers) => {
  const response = await fetch(`/termhub-credentials/${encodeURIComponent(documentId)}`, 'PUT', headers, { data });
  return response?.data || null;
};

const deleteTermhubCredential = async (documentId, headers) => {
  await fetch(`/termhub-credentials/${encodeURIComponent(documentId)}`, 'DELETE', headers);
  return true;
};

const findAiTextRun = async (documentId, headers) => {
  const response = await fetch(`/ai-text-runs/${encodeURIComponent(documentId)}`, 'GET', headers);
  return response?.data || null;
};

const findAiTextRunByKey = async (key, headers) => {
  const query = buildQuery({ idempotency_key: { eq: key } }, [], { pageSize: 1 });
  const response = await fetch(`/ai-text-runs?${query}`, 'GET', headers);
  return response?.data?.[0] || null;
};

/** The user's runs created since `date` (oldest first): the hourly and concurrent limits. */
const findAiTextRunsOfUserSince = async (userId, date, headers) => {
  const query = buildQuery(
    { user_id: { eq: Number(userId) }, createdAt: { gte: date.toISOString() } },
    [{ createdAt: 'asc' }],
    { pageSize: 100 },
  );
  const response = await fetch(`/ai-text-runs?${query}`, 'GET', headers);
  return response?.data || [];
};

const createAiTextRun = async (data, headers) => {
  const response = await fetch('/ai-text-runs', 'POST', headers, { data });
  return response?.data || null;
};

const updateAiTextRun = async (documentId, data, headers) => {
  const response = await fetch(`/ai-text-runs/${encodeURIComponent(documentId)}`, 'PUT', headers, { data });
  return response?.data || null;
};

const termhub = ({ headers }) => ({
  findTermhubCredential: (userId) => findTermhubCredential(userId, headers),
  createTermhubCredential: (data) => createTermhubCredential(data, headers),
  updateTermhubCredential: (documentId, data) => updateTermhubCredential(documentId, data, headers),
  deleteTermhubCredential: (documentId) => deleteTermhubCredential(documentId, headers),
  findAiTextRun: (documentId) => findAiTextRun(documentId, headers),
  findAiTextRunByKey: (key) => findAiTextRunByKey(key, headers),
  findAiTextRunsOfUserSince: (userId, date) => findAiTextRunsOfUserSince(userId, date, headers),
  createAiTextRun: (data) => createAiTextRun(data, headers),
  updateAiTextRun: (documentId, data) => updateAiTextRun(documentId, data, headers),
});

export default termhub;
