/* eslint-disable import/no-extraneous-dependencies */
import axios from 'axios';

// Eventando routes of the Opa Pingou webhook (REA-6, plan task E6), all with the
// integration token. Unlike utils/network/strapi this keeps the HTTP status, which
// the webhook needs (404 = not a signup charge, 5xx = retry later). Errors carry
// only method, route and status — never the body nor the token.

export class EventandoRequestError extends Error {
  constructor(method, route, status) {
    super(`Eventando ${method} ${route} falhou${status ? ` (HTTP ${status})` : ' (sem resposta)'}`);
    this.name = 'EventandoRequestError';
    this.status = status || null;
  }
}

const unwrap = (body) => (body && body.data !== undefined && !Array.isArray(body) ? body.data : body);

export const createOpaPingouEventando = ({
  baseUrl = process.env.EVENTANDO_MANAGER_URL,
  token = process.env.EVENTANDO_MANAGER_TOKEN_INTEGRATION,
  http = axios,
  timeoutMs = 8000,
} = {}) => {
  const request = async (method, route, data) => {
    let response;
    try {
      response = await http.request({
        method,
        url: `${baseUrl}/api${route}`,
        data,
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      });
    } catch (err) {
      throw new EventandoRequestError(method, route, null);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new EventandoRequestError(method, route, response.status);
    }
    return response.data;
  };

  return {
    // { event_id, type, test_mode, charge_id, payload } → { duplicate: boolean }
    saveEvent: async (event) => {
      const body = await request('POST', '/opapingou/events', event);
      return { duplicate: Boolean(unwrap(body)?.duplicate ?? body?.duplicate) };
    },

    // → { transitioned, status, payment } | { ignored: true } when the charge is not ours.
    processEvent: async (eventId) => {
      try {
        return unwrap(await request('POST', `/opapingou/events/${encodeURIComponent(eventId)}/process`)) || {};
      } catch (err) {
        if (err.status === 404) return { ignored: true, reason: 'not-found' };
        throw err;
      }
    },

    // → [{ eventId, type }] of events saved but not processed yet.
    pendingEvents: async (olderThanSeconds = 60) => {
      const body = await request('GET', `/opapingou/events/pending?olderThanSeconds=${Number(olderThanSeconds) || 0}`);
      const list = unwrap(body);
      return (Array.isArray(list) ? list : [])
        .map((item) => (typeof item === 'object' && item !== null
          ? { eventId: item.event_id || item.eventId || item.id, type: item.type || null }
          : { eventId: item, type: null }))
        .filter((item) => item.eventId);
    },
  };
};

export default createOpaPingouEventando;
