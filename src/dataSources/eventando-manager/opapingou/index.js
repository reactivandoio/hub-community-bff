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

// A 4xx of the connection routes (REA-12): code and a message meant for the person. Never the key.
export class OpaPingouConnectionError extends Error {
  constructor({ code = 'UNKNOWN', message, status = null, missing = null, count = null } = {}) {
    super(message || 'Não foi possível concluir a operação com o Opa Pingou.');
    this.name = 'OpaPingouConnectionError';
    this.code = code;
    this.status = status;
    this.missing = Array.isArray(missing) ? missing.map(String) : null;
    this.count = Number.isInteger(count) ? count : null;
  }
}

// Saving a key calls the Opa Pingou up to six times from the Eventando (each with its own deadline).
const CONNECT_TIMEOUT_MS = 60000;

const unwrap = (body) => (body && body.data !== undefined && !Array.isArray(body) ? body.data : body);

export const createOpaPingouEventando = ({
  baseUrl = process.env.EVENTANDO_MANAGER_URL,
  token = process.env.EVENTANDO_MANAGER_TOKEN_INTEGRATION,
  http = axios,
  timeoutMs = 8000,
} = {}) => {
  const send = async (method, route, data, timeout = timeoutMs) => {
    try {
      return await http.request({
        method,
        url: `${baseUrl}/api${route}`,
        data,
        timeout,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      });
    } catch (err) {
      throw new EventandoRequestError(method, route, null);
    }
  };

  // Connection routes: 4xx with { error: { code, message } } becomes OpaPingouConnectionError.
  const connectionRequest = async (method, route, data, timeout) => {
    const response = await send(method, route, data, timeout);
    if (response.status >= 200 && response.status < 300) return response.data;
    const error = response.data?.error;
    if (response.status >= 400 && response.status < 500 && error?.code) {
      throw new OpaPingouConnectionError({ ...error, status: response.status });
    }
    if (response.status === 503 && error?.code) {
      throw new OpaPingouConnectionError({ ...error, status: response.status });
    }
    throw new EventandoRequestError(method, route.replace(/\?.*$/, ''), response.status);
  };

  const request = async (method, route, data) => {
    const response = await send(method, route, data);
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

    // REA-12: is `signature` (Opa-Signature) valid for this raw body with the secret of the
    // connection `publicId`? The secret stays in the Eventando. → { found, valid, reason?, test_mode? }
    verifyWebhook: async (publicId, rawBody, signature) => {
      const body = await request('POST', `/opapingou/connections/${encodeURIComponent(publicId)}/verify`, {
        raw_body: Buffer.from(rawBody).toString('base64'),
        signature: signature || '',
      });
      return unwrap(body) || {};
    },

    // → { connection: summary | null, legacy }
    eventConnection: async (eventUuid) =>
      connectionRequest('GET', `/opapingou/connections/event/${encodeURIComponent(eventUuid)}`),

    // → [summary + event_uuids + created_by] of every active connection
    listConnections: async () => {
      const body = await connectionRequest('GET', '/opapingou/connections');
      return Array.isArray(body?.data) ? body.data : [];
    },

    // The key goes only in this body: never in a log line or an error message.
    connect: async ({ eventUuid, apiKey, createdBy, createdByName }) => {
      const body = await connectionRequest('POST', '/opapingou/connections', {
        event_uuid: eventUuid,
        api_key: apiKey,
        created_by: createdBy,
        created_by_name: createdByName,
      }, CONNECT_TIMEOUT_MS);
      return body?.connection || null;
    },

    attach: async (eventUuid, publicId) => {
      const body = await connectionRequest(
        'PUT',
        `/opapingou/connections/${encodeURIComponent(publicId)}/events/${encodeURIComponent(eventUuid)}`,
      );
      return body?.connection || null;
    },

    detach: async (eventUuid) =>
      connectionRequest('DELETE', `/opapingou/connections/event/${encodeURIComponent(eventUuid)}`),

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
