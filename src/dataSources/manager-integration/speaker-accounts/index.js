import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

// REA-53 — the account a speaker is (`speaker.users_permissions_user`, oneToOne). Run with the
// integration token, only after services/speaker-account checked the request user is an admin.

const ACCOUNT_FIELDS = ['documentId', 'username', 'email', 'name'];
const PAGE_SIZE = 100;
// Safety net: 100 pages of 100.
const MAX_PAGES = 100;

const speakerParams = () => {
  const params = new URLSearchParams();
  ['documentId', 'name', 'email', 'biography', 'deleted_at'].forEach((field, index) =>
    params.append(`fields[${index}]`, field));
  ACCOUNT_FIELDS.forEach((field, index) =>
    params.append(`populate[users_permissions_user][fields][${index}]`, field));
  params.append('populate[talks][fields][0]', 'documentId');
  params.append('populate[avatar][fields][0]', 'id');
  return params;
};

const findSpeakerWithAccount = async (documentId, headers) => {
  const response = await fetch(`/speakers/${encodeURIComponent(documentId)}?${speakerParams().toString()}`, 'GET', headers);
  return response?.data || null;
};

/** The (not deleted) speakers linked to one account: one, unless old data broke the oneToOne. */
const findSpeakersOfAccount = async (userDocumentId, headers) => {
  const params = speakerParams();
  params.append('filters[users_permissions_user][documentId][$eq]', userDocumentId);
  params.append('filters[deleted_at][$null]', 'true');
  params.append('pagination[pageSize]', '10');
  const response = await fetch(`/speakers?${params.toString()}`, 'GET', headers);
  return response?.data || [];
};

/** Every speaker not deleted, with its account and talk ids (for the review counts). */
const findAllSpeakersForReview = async (headers) => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const params = speakerParams();
    params.append('filters[deleted_at][$null]', 'true');
    params.append('sort[0]', 'id:asc');
    params.append('pagination[page]', String(page));
    params.append('pagination[pageSize]', String(PAGE_SIZE));
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`/speakers?${params.toString()}`, 'GET', headers);
    const data = response?.data || [];
    all.push(...data);
    const pageCount = response?.meta?.pageCount;
    if (pageCount ? page >= pageCount : data.length < PAGE_SIZE) break;
  }
  return all;
};

/** Every account, only what the suggestions compare (the users-permissions /users reads start/limit). */
const findAllAccountsForReview = async (headers) => {
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    ['id', ...ACCOUNT_FIELDS, 'blocked'].forEach((field, index) => params.append(`fields[${index}]`, field));
    params.append('sort[0]', 'id:asc');
    params.append('start', String(page * PAGE_SIZE));
    params.append('limit', String(PAGE_SIZE));
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`/users?${params.toString()}`, 'GET', headers);
    const data = response?.data || [];
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
};

/** Links (`userDocumentId`) or unlinks (null) the account, with any other speaker fields in `data`. */
const setSpeakerAccount = (documentId, userDocumentId, data, headers) =>
  fetch(`/speakers/${encodeURIComponent(documentId)}`, 'PUT', headers, {
    data: { ...data, users_permissions_user: { set: userDocumentId ? [userDocumentId] : [] } },
  });

const speakerAccounts = ({ headers }) => ({
  findSpeakerWithAccount: (documentId) => findSpeakerWithAccount(documentId, headers),
  findSpeakersOfAccount: (userDocumentId) => findSpeakersOfAccount(userDocumentId, headers),
  findAllSpeakersForReview: () => findAllSpeakersForReview(headers),
  findAllAccountsForReview: () => findAllAccountsForReview(headers),
  setSpeakerAccount: (documentId, userDocumentId, data = {}) =>
    setSpeakerAccount(documentId, userDocumentId, data, headers),
});

export default speakerAccounts;
