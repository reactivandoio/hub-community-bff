import { mapConfig, mapCertificate, maskPublicCertificate, mediaIdFromInput } from './mappers';
import {
  normalizeIdentifier,
  isValidCpf,
  hasEventEnded,
  selfRequestStatus,
  findAttendanceForIdentifier,
  REVOKED_MESSAGE,
} from './eligibility';
import { buildCandidates, enrichIdentifiersFromForms, normalizeEmail } from './candidates';
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
      text: s.text || null,
      font: s.font || 'great_vibes',
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
  signatures: (raw.signatures || []).map((s) => ({
    name: s.name, role: s.role, image: s.image?.id, text: s.text, font: s.font,
  })),
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

// Eventando signups carry no CPF; the SW signup form (`sw-form`) does. Best effort: a failure here
// must not take the whole candidate list down.
const enrichCandidatesFromSwForms = async (dataSources, candidates) => {
  const emails = candidates.filter((c) => !isValidCpf(c.identifier) && c.email).map((c) => c.email);
  if (emails.length === 0) return candidates;
  try {
    const forms = await dataSources.managerIntegration.findSwFormsByEmails(emails);
    return enrichIdentifiersFromForms(candidates, forms);
  } catch (err) {
    console.error('[certificates] sw-form lookup failed, skipping CPF enrichment:', err.message);
    return candidates;
  }
};

// Same shape the backend's `isEmailIdentifier` accepts.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Issue key: a valid CPF when there is one, otherwise the normalized e-mail.
export const resolveIssueIdentifier = (entry) => {
  if (isValidCpf(entry?.identifier)) return normalizeIdentifier(entry.identifier);
  const email = normalizeEmail(entry?.email);
  return EMAIL_PATTERN.test(email) ? email : '';
};

// Mirrored by the frontend's `labelFor` to match batch errors back to rows — keep the chain.
const entryLabel = (entry) =>
  (entry?.name || '').trim() || entry?.email || normalizeIdentifier(entry?.identifier);

const Certificate = {
  Query: {
    certificateConfig: async (_, { eventId }, { dataSources }) => {
      const { config } = await loadEventAndConfig(dataSources, eventId);
      return mapConfig(config);
    },

    // Models available to copy: every config that still has an event, newest event first.
    certificateConfigs: async (_, __, { user, dataSources }) => {
      requireUser(user);
      const configs = await dataSources.managerIntegration.findAllCertificateConfigs();
      return configs
        .filter((raw) => raw?.event?.documentId)
        .map((raw) => ({
          event: {
            id: raw.event.documentId,
            slug: raw.event.slug || null,
            title: raw.event.title || '',
            start_date: raw.event.start_date || null,
          },
          config: mapConfig(raw),
        }))
        .sort((a, b) => (b.event.start_date || '').localeCompare(a.event.start_date || ''));
    },

    certificateByCode: async (_, { code }, { dataSources }) => {
      const response = await dataSources.managerIntegration.findCertificateByCode(code.trim().toUpperCase());
      return maskPublicCertificate(mapCertificate(response?.data?.[0] || null));
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
      const candidates = buildCandidates({ signups, attendances, participants, certificates });
      const enriched = await enrichCandidatesFromSwForms(dataSources, candidates);
      return enriched.map((c) => ({
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
        const label = entryLabel(entry);
        const identifier = resolveIssueIdentifier(entry);
        if (!identifier) throw new Error(`${label}: CPF ou e-mail válido é obrigatório`);
        if (!entry.email?.trim()) throw new Error(`${label}: e-mail obrigatório`);
        if (!(entry.name || '').trim()) throw new Error(`${label}: nome obrigatório`);

        const created = await dataSources.managerIntegration.createCertificate({
          event: eventId,
          name: entry.name.trim(),
          identifier,
          email: normalizeEmail(entry.email),
          source: 'ADMIN',
        });
        const certificate = created?.data;
        result.issued += 1;
        result.certificates.push(mapCertificate({ ...certificate, event }));

        if (actions.email) {
          const sent = await sendCertificateEmail({ certificate, event });
          if (!sent.success) throw new Error(`${label}: falha ao enviar e-mail (${sent.error})`);
          const updated = await dataSources.managerIntegration.updateCertificate(certificate.documentId, {
            sent_at: new Date().toISOString(),
          });
          const updatedCertificate = updated?.data || certificate;
          result.emailed += 1;
          const mapped = mapCertificate({ ...updatedCertificate, event });
          const idx = result.certificates.findIndex((c) => c.code === certificate.code);
          if (idx >= 0) result.certificates[idx] = mapped;
          else result.certificates.push(mapped);
        }
      };

      for (const batch of chunk(entries, BATCH_SIZE)) {
        const settled = await Promise.allSettled(batch.map(issueOne));
        settled.forEach((s, i) => {
          if (s.status !== 'rejected') return;
          const msg = s.reason?.message || String(s.reason);
          const label = entryLabel(batch[i]);
          result.errors.push(msg.startsWith(`${label}:`) ? msg : `${label}: ${msg}`);
        });
      }
      return result;
    },
  },
};

export default Certificate;
