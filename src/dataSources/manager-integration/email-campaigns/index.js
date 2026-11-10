import axios from 'axios';
import dotenv from 'dotenv';
import managerNetworkUtils from '../../../utils/network/manager';

dotenv.config();

const { fetch, buildQuery } = managerNetworkUtils;

// REA-29: event e-mail campaigns, their deliveries (one per campaign × e-mail, `key` unique) and
// the suppression list (unsubscribed). Collections granted to no role: integration token only.

// Strapi caps pageSize at 100; `$in` is sent indexed (buildQuery joins arrays with commas).
const IN_CHUNK = 50;

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const findIn = async (route, field, values, headers, fields = []) => {
  const results = [];
  for (const part of chunk([...new Set(values)].filter(Boolean), IN_CHUNK)) {
    const params = new URLSearchParams();
    part.forEach((value, index) => params.append(`filters[${field}][$in][${index}]`, value));
    params.append('pagination[pageSize]', '100');
    fields.forEach((f, index) => params.append(`fields[${index}]`, f));
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`${route}?${params.toString()}`, 'GET', headers);
    results.push(...(response?.data || []));
  }
  return results;
};

const findEmailCampaignsByEvent = async (eventDocumentId, headers) => {
  const query = buildQuery({ event_document_id: { eq: eventDocumentId } }, [{ createdAt: 'desc' }], { pageSize: 50 });
  const response = await fetch(`/email-campaigns?${query}`, 'GET', headers);
  return response?.data || [];
};

const findEmailCampaign = async (documentId, headers) => {
  const response = await fetch(`/email-campaigns/${encodeURIComponent(documentId)}`, 'GET', headers);
  return response?.data || null;
};

// Oldest first: a campaign started earlier finishes before the next one takes the quota.
const findSendingEmailCampaigns = async (headers) => {
  const query = buildQuery({ status: { eq: 'sending' } }, [{ createdAt: 'asc' }], { pageSize: 10 });
  const response = await fetch(`/email-campaigns?${query}`, 'GET', headers);
  return response?.data || [];
};

const createEmailCampaign = async (data, headers) => {
  const response = await fetch('/email-campaigns', 'POST', headers, { data });
  return response?.data || null;
};

const updateEmailCampaign = async (documentId, data, headers) => {
  const response = await fetch(`/email-campaigns/${encodeURIComponent(documentId)}`, 'PUT', headers, { data });
  return response?.data || null;
};

/** Campaign e-mails handed to the SMTP since `date` (skipped ones never reached it). */
const countEmailDeliveriesSince = async (date, headers) => {
  const query = buildQuery(
    { createdAt: { gte: date.toISOString() }, status: { ne: 'skipped' } },
    [],
    { pageSize: 1 },
  );
  const response = await fetch(`/email-campaign-deliveries?${query}`, 'GET', headers);
  return Number(response?.meta?.total) || 0;
};

const findEmailDeliveriesByKeys = (keys, headers) =>
  findIn('/email-campaign-deliveries', 'key', keys, headers, ['key', 'email', 'status']);

/** Throws when the key already exists (the unique index is what makes a send happen once). */
const createEmailDelivery = async (data, headers) => {
  const response = await fetch('/email-campaign-deliveries', 'POST', headers, { data });
  return response?.data || null;
};

const updateEmailDelivery = async (documentId, data, headers) => {
  const response = await fetch(`/email-campaign-deliveries/${encodeURIComponent(documentId)}`, 'PUT', headers, { data });
  return response?.data || null;
};

const findSuppressedEmails = async (emails, headers) => {
  const rows = await findIn('/email-suppressions', 'email', emails, headers, ['email']);
  return new Set(rows.map((row) => row.email));
};

const findEmailSuppression = async (email, headers) => {
  const query = buildQuery({ email: { eq: email } }, [], { pageSize: 1 });
  const response = await fetch(`/email-suppressions?${query}`, 'GET', headers);
  return response?.data?.[0] || null;
};

const createEmailSuppression = async (data, headers) => {
  const response = await fetch('/email-suppressions', 'POST', headers, { data });
  return response?.data || null;
};

const USER_FIELDS = ['id', 'email', 'name', 'username', 'blocked'];

/** The next `limit` users after id `afterId` (the invite campaign walks the base by id). */
const findUsersAfterId = async (afterId, limit, headers) => {
  const params = new URLSearchParams();
  params.append('filters[id][$gt]', String(afterId || 0));
  // The users-permissions /users ignores pagination[...]; it reads start/limit.
  params.append('start', '0');
  params.append('limit', String(limit));
  params.append('sort[0]', 'id:asc');
  USER_FIELDS.forEach((field, index) => params.append(`fields[${index}]`, field));
  const response = await fetch(`/users?${params.toString()}`, 'GET', headers);
  return response?.data || [];
};

// /users/count answers a bare number (the shared fetch drops it) and reads bare `where` params.
const countReachableUsers = async (headers) => {
  const params = new URLSearchParams();
  params.append('$or[0][blocked][$eq]', 'false');
  params.append('$or[1][blocked][$null]', 'true');
  const response = await axios.get(`${process.env.MANAGER_URL}/api/users/count?${params.toString()}`, {
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  return Number(response.data) || 0;
};

const countEmailSuppressions = async (headers) => {
  const response = await fetch(`/email-suppressions?${buildQuery({}, [], { pageSize: 1 })}`, 'GET', headers);
  return Number(response?.meta?.total) || 0;
};

const emailCampaigns = ({ headers }) => ({
  findEmailCampaignsByEvent: (eventDocumentId) => findEmailCampaignsByEvent(eventDocumentId, headers),
  findEmailCampaign: (documentId) => findEmailCampaign(documentId, headers),
  findSendingEmailCampaigns: () => findSendingEmailCampaigns(headers),
  createEmailCampaign: (data) => createEmailCampaign(data, headers),
  updateEmailCampaign: (documentId, data) => updateEmailCampaign(documentId, data, headers),
  countEmailDeliveriesSince: (date) => countEmailDeliveriesSince(date, headers),
  findEmailDeliveriesByKeys: (keys) => findEmailDeliveriesByKeys(keys, headers),
  createEmailDelivery: (data) => createEmailDelivery(data, headers),
  updateEmailDelivery: (documentId, data) => updateEmailDelivery(documentId, data, headers),
  findSuppressedEmails: (emails) => findSuppressedEmails(emails, headers),
  findEmailSuppression: (email) => findEmailSuppression(email, headers),
  createEmailSuppression: (data) => createEmailSuppression(data, headers),
  findUsersAfterId: (afterId, limit) => findUsersAfterId(afterId, limit, headers),
  countReachableUsers: () => countReachableUsers(headers),
  countEmailSuppressions: () => countEmailSuppressions(headers),
});

export default emailCampaigns;
