// Merges the three "who was there" sources into one deduplicated list. Pure — no I/O.
import { normalizeIdentifier } from './eligibility';

export const normalizeEmail = (value) => (value || '').trim().toLowerCase();

export const candidateKey = ({ identifier, email } = {}) =>
  normalizeIdentifier(identifier) || normalizeEmail(email) || null;

export const SOURCE_PRIORITY = { ATTENDANCE: 3, SIGNUP: 2, REQUEST: 1 };

const fromSignup = (s) => ({
  source: 'SIGNUP',
  name: s.name || '',
  email: normalizeEmail(s.email),
  identifier: normalizeIdentifier(s.cpf || s.identifier),
  phone: s.phone_number || '',
  checked_in: Boolean(s.checked_in),
});

const fromAttendance = (a) => {
  const u = a?.users_permissions_user;
  if (!u) return null;
  return {
    source: 'ATTENDANCE',
    name: u.name || u.username || '',
    email: normalizeEmail(u.email),
    identifier: normalizeIdentifier(u.cpf),
    phone: u.phone || '',
    checked_in: false,
  };
};

const fromParticipant = (p) => ({
  source: 'REQUEST',
  name: p.name || '',
  email: normalizeEmail(p.email),
  identifier: normalizeIdentifier(p.identifier),
  phone: p.phone_number || '',
  checked_in: false,
});

// Higher-priority source wins for name/email/phone; empty values never overwrite filled ones.
const merge = (existing, row) => {
  const incomingWins = SOURCE_PRIORITY[row.source] > SOURCE_PRIORITY[existing.topSource];
  const pick = (field) => {
    if (incomingWins) return row[field] || existing[field];
    return existing[field] || row[field];
  };
  return {
    ...existing,
    name: pick('name'),
    email: pick('email'),
    phone: pick('phone'),
    identifier: existing.identifier || row.identifier,
    checked_in: existing.checked_in || row.checked_in,
    sources: existing.sources.includes(row.source) ? existing.sources : [...existing.sources, row.source],
    topSource: incomingWins ? row.source : existing.topSource,
  };
};

export const buildCandidates = ({ signups = [], attendances = [], participants = [], certificates = [] }) => {
  const rows = [
    ...attendances.map(fromAttendance).filter(Boolean),
    ...signups.map(fromSignup),
    ...participants.map(fromParticipant),
  ];

  const byKey = new Map();
  rows.forEach((row) => {
    const key = candidateKey(row);
    if (!key) return;
    const existing = byKey.get(key);
    byKey.set(key, existing ? merge(existing, row) : { key, ...row, sources: [row.source], topSource: row.source });
  });

  const certByIdentifier = new Map(
    certificates.filter((c) => c.identifier).map((c) => [normalizeIdentifier(c.identifier), c]),
  );

  const candidates = [...byKey.values()].map((c) => ({
    key: c.key,
    name: c.name,
    email: c.email,
    identifier: c.identifier,
    phone: c.phone,
    sources: [...c.sources].sort((a, b) => SOURCE_PRIORITY[b] - SOURCE_PRIORITY[a]),
    checked_in: c.checked_in,
    certificate: certByIdentifier.get(c.identifier) || null,
  }));

  const seenIdentifiers = new Set(candidates.map((c) => c.identifier).filter(Boolean));
  certificates.forEach((cert) => {
    const id = normalizeIdentifier(cert.identifier);
    if (!id || seenIdentifiers.has(id)) return;
    candidates.push({
      key: id,
      name: cert.name || '',
      email: normalizeEmail(cert.email),
      identifier: id,
      phone: '',
      sources: [],
      checked_in: false,
      certificate: cert,
    });
  });

  return candidates.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
};
