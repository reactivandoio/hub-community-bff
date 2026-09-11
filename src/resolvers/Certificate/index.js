import { mapConfig, mapCertificate, mediaIdFromInput } from './mappers';
import {
  normalizeIdentifier,
  isValidCpf,
  hasEventEnded,
  selfRequestStatus,
  findAttendanceForIdentifier,
  REVOKED_MESSAGE,
} from './eligibility';
import { buildCandidates } from './candidates';
import { sendCertificateEmail } from './email';

export const requireUser = (user) => {
  if (!user) throw new Error('Não autenticado.');
};

export const loadEventAndConfig = async (dataSources, eventId) => {
  let eventResponse;
  try {
    eventResponse = await dataSources.managerIntegration.findEventByDocumentId(eventId);
  } catch (_) {
    throw new Error('Evento não encontrado.');
  }
  const event = eventResponse?.data;
  if (!event) throw new Error('Evento não encontrado.');
  const configResponse = await dataSources.managerIntegration.findCertificateConfigByEvent(eventId);
  const config = configResponse?.data?.[0] || null;
  return { event, config };
};

// Turns the GraphQL input into the Strapi payload (media as numeric ids).
export const buildConfigData = (input) => {
  const data = {};
  const scalars = ['enabled', 'allow_self_request', 'title', 'body_template',
    'workload_hours', 'issuer_name', 'primary_color'];
  scalars.forEach((key) => {
    if (input[key] !== undefined) data[key] = input[key];
  });
  if (input.logo !== undefined) data.logo = mediaIdFromInput(input.logo);
  if (input.background !== undefined) data.background = mediaIdFromInput(input.background);
  if (input.sponsors !== undefined) {
    data.sponsors = input.sponsors.map((s) => ({
      name: s.name,
      url: s.url || null,
      logo: mediaIdFromInput(s.logo),
    }));
  }
  if (input.signatures !== undefined) {
    data.signatures = input.signatures.map((s) => ({
      name: s.name,
      role: s.role || null,
      image: mediaIdFromInput(s.image),
    }));
  }
  return data;
};

const upsertConfig = async (dataSources, eventId, input) => {
  const { config } = await loadEventAndConfig(dataSources, eventId);
  const data = { ...buildConfigData(input), event: eventId };
  const response = config
    ? await dataSources.managerIntegration.updateCertificateConfig(config.documentId, data)
    : await dataSources.managerIntegration.createCertificateConfig(data);
  return mapConfig(response?.data);
};

// Raw Strapi config → input shape, so it can be re-applied to another event.
const configToInput = (raw) => ({
  enabled: false, // never enable the copy automatically
  allow_self_request: raw.allow_self_request !== false,
  title: raw.title,
  body_template: raw.body_template,
  workload_hours: raw.workload_hours,
  issuer_name: raw.issuer_name,
  primary_color: raw.primary_color,
  logo: raw.logo?.id ?? null,
  background: raw.background?.id ?? null,
  sponsors: (raw.sponsors || []).map((s) => ({ name: s.name, url: s.url, logo: s.logo?.id })),
  signatures: (raw.signatures || []).map((s) => ({ name: s.name, role: s.role, image: s.image?.id })),
});

const BATCH_SIZE = 10;

// Signups live in Eventando Manager, keyed by the hub event's slug.
const loadEventandoSignups = async (dataSources, event) => {
  if (!event?.slug) return [];
  try {
    const response = await dataSources.eventandoIntegration.findEvents({
      filters: { or: [{ slug: { eq: event.slug } }, { uuid: { eq: event.slug } }] },
    });
    const eventandoEvent = response?.data?.[0];
    if (!eventandoEvent) return [];
    return dataSources.eventandoIntegration.findSignupsByEvent(eventandoEvent.id);
  } catch (err) {
    console.error('[certificates] Eventando unreachable, ignoring signups:', err.message);
    return [];
  }
};

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const Certificate = {
  Query: {
    certificateConfig: async (_, { eventId }, { dataSources }) => {
      const { config } = await loadEventAndConfig(dataSources, eventId);
      return mapConfig(config);
    },

    certificateByCode: async (_, { code }, { dataSources }) => {
      const response = await dataSources.managerIntegration.findCertificateByCode(code.trim().toUpperCase());
      return mapCertificate(response?.data?.[0] || null);
    },

    lookupCertificate: async (_, { eventId, identifier }, { dataSources }) => {
      const cpf = normalizeIdentifier(identifier);
      if (!isValidCpf(cpf)) throw new Error('CPF inválido.');

      const { event, config } = await loadEventAndConfig(dataSources, eventId);
      const eventEnded = hasEventEnded(event);
      const selfRequestAllowed = selfRequestStatus(config, event).ok;

      const existing = await dataSources.managerIntegration.findCertificateByEventAndIdentifier(eventId, cpf);
      const existingCertificate = existing?.data?.[0];
      if (existingCertificate) {
        return {
          certificate: mapCertificate(existingCertificate),
          eligible_by_attendance: true,
          self_request_allowed: selfRequestAllowed,
          event_ended: eventEnded,
          revoked: false,
        };
      }

      const existingIncludingRevoked = await dataSources.managerIntegration
        .findCertificateByEventAndIdentifier(eventId, cpf, { includeRevoked: true });
      const revokedCertificate = existingIncludingRevoked?.data?.[0];
      if (revokedCertificate) {
        return {
          certificate: null,
          eligible_by_attendance: false,
          self_request_allowed: false,
          event_ended: eventEnded,
          revoked: true,
        };
      }

      const attendances = await dataSources.managerIntegration.findAttendancesByEvent(eventId);
      const attendance = findAttendanceForIdentifier(attendances, cpf);
      const eligible = Boolean(attendance);

      let certificate = null;
      if (eligible && config?.enabled && eventEnded) {
        const user = attendance.users_permissions_user;
        const created = await dataSources.managerIntegration.createCertificate({
          event: eventId,
          name: user.name || user.username,
          identifier: cpf,
          email: user.email,
          source: 'ATTENDANCE',
          users_permissions_user: user.documentId,
        });
        certificate = mapCertificate(created?.data);
      }

      return {
        certificate,
        eligible_by_attendance: eligible,
        self_request_allowed: selfRequestAllowed,
        event_ended: eventEnded,
        revoked: false,
      };
    },

    certificateCandidates: async (_, { eventId }, { user, dataSources }) => {
      requireUser(user);
      const { event } = await loadEventAndConfig(dataSources, eventId);
      const [signups, attendances, participants, certificates] = await Promise.all([
        loadEventandoSignups(dataSources, event),
        dataSources.managerIntegration.findAttendancesByEvent(eventId),
        dataSources.managerIntegration.findParticipantsByEvent(eventId),
        dataSources.managerIntegration.findCertificatesByEvent(eventId),
      ]);
      return buildCandidates({ signups, attendances, participants, certificates }).map((c) => ({
        ...c,
        certificate: mapCertificate(c.certificate ? { ...c.certificate, event } : null),
      }));
    },
  },

  Mutation: {
    upsertCertificateConfig: async (_, { eventId, data }, { user, dataSources }) => {
      requireUser(user);
      return upsertConfig(dataSources, eventId, data);
    },

    copyCertificateConfig: async (_, { fromEventId, toEventId }, { user, dataSources }) => {
      requireUser(user);
      const { config: source } = await loadEventAndConfig(dataSources, fromEventId);
      if (!source) throw new Error('O evento de origem não tem modelo de certificado.');
      return upsertConfig(dataSources, toEventId, configToInput(source));
    },

    requestCertificate: async (_, { eventId, name, identifier, email }, { dataSources }) => {
      const cpf = normalizeIdentifier(identifier);
      if (!isValidCpf(cpf)) throw new Error('CPF inválido.');
      if (!name?.trim()) throw new Error('Nome é obrigatório.');
      if (!email?.trim()) throw new Error('E-mail é obrigatório.');

      const { event, config } = await loadEventAndConfig(dataSources, eventId);
      const status = selfRequestStatus(config, event);
      if (!status.ok) throw new Error(status.message);

      const existing = await dataSources.managerIntegration
        .findCertificateByEventAndIdentifier(eventId, cpf, { includeRevoked: true });
      const existingCertificate = existing?.data?.[0];
      if (existingCertificate) {
        if (existingCertificate.revoked_at) throw new Error(REVOKED_MESSAGE);
        return mapCertificate(existingCertificate);
      }

      const created = await dataSources.managerIntegration.createCertificate({
        event: eventId,
        name: name.trim(),
        identifier: cpf,
        email: email.trim().toLowerCase(),
        source: 'SELF_REQUEST',
      });
      return mapCertificate(created?.data);
    },

    issueCertificates: async (_, { eventId, entries, actions }, { user, dataSources }) => {
      requireUser(user);
      if (actions.email && !actions.register) {
        throw new Error('Enviar e-mail exige registrar o certificado.');
      }
      if (!actions.register) {
        return { issued: 0, emailed: 0, certificates: [], errors: [] };
      }

      const { event } = await loadEventAndConfig(dataSources, eventId);
      const result = { issued: 0, emailed: 0, certificates: [], errors: [] };

      const issueOne = async (entry) => {
        const cpf = normalizeIdentifier(entry.identifier);
        const label = entry.name || entry.email || cpf;
        if (!isValidCpf(cpf)) throw new Error(`${label}: CPF inválido`);
        if (!entry.email?.trim()) throw new Error(`${label}: e-mail obrigatório`);

        const created = await dataSources.managerIntegration.createCertificate({
          event: eventId,
          name: entry.name.trim(),
          identifier: cpf,
          email: entry.email.trim().toLowerCase(),
          source: 'ADMIN',
        });
        let certificate = created?.data;
        result.issued += 1;

        if (actions.email) {
          const sent = await sendCertificateEmail({ certificate, event });
          if (!sent.success) throw new Error(`${label}: falha ao enviar e-mail (${sent.error})`);
          const updated = await dataSources.managerIntegration.updateCertificate(certificate.documentId, {
            sent_at: new Date().toISOString(),
          });
          certificate = updated?.data || certificate;
          result.emailed += 1;
        }
        result.certificates.push(mapCertificate({ ...certificate, event }));
      };

      for (const batch of chunk(entries, BATCH_SIZE)) {
        const settled = await Promise.allSettled(batch.map(issueOne));
        settled.forEach((s) => {
          if (s.status === 'rejected') result.errors.push(s.reason?.message || String(s.reason));
        });
      }
      return result;
    },
  },
};

export default Certificate;
