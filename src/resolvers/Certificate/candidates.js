// Merges the three "who was there" sources into one deduplicated list. Pure — no I/O.
import { normalizeIdentifier, isValidCpf } from './eligibility';

export const normalizeEmail = (value) => (value || '').trim().toLowerCase();

// A candidate's `identifier` is always a CPF; certificates issued without one carry the e-mail as
// identifier, and that must never surface as a candidate CPF.
const cpfDigits = (value) => {
  const id = normalizeIdentifier(value);
  return id.includes('@') ? '' : id;
};

export const candidateKey = ({ identifier, email } = {}) =>
  normalizeIdentifier(identifier) || normalizeEmail(email) || null;

export const SOURCE_PRIORITY = { ATTENDANCE: 3, SIGNUP: 2, REQUEST: 1 };

const fromSignup = (s) => ({
  source: 'SIGNUP',
  name: s.name || '',
  email: normalizeEmail(s.email),
  identifier: cpfDigits(s.cpf || s.identifier),
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
    identifier: cpfDigits(u.cpf),
    phone: u.phone || '',
    checked_in: false,
  };
};

const fromParticipant = (p) => ({
  source: 'REQUEST',
  name: p.name || '',
  email: normalizeEmail(p.email),
  identifier: cpfDigits(p.identifier),
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

// Two passes so CPF authority never depends on iteration order: every CPF match is reserved
// first, and only then may an e-mail-only candidate claim a still-unreserved certificate (adopting
// its CPF). A certificate attaches to at most one candidate, whichever way it is matched.
const attachCertificates = (candidates, { certByIdentifier, certByEmail }) => {
  const attachedCertificates = new Set();
  const withCert = candidates.map((c) => ({ ...c, certificate: null }));

  withCert.forEach((c) => {
    if (!c.identifier) return;
    const certificate = certByIdentifier.get(c.identifier);
    if (!certificate) return;
    c.certificate = certificate;
    attachedCertificates.add(certificate);
  });

  withCert.forEach((c) => {
    if (c.identifier || !c.email) return;
    const certificate = certByEmail.get(c.email);
    if (!certificate || attachedCertificates.has(certificate)) return;
    c.certificate = certificate;
    c.identifier = cpfDigits(certificate.identifier);
    attachedCertificates.add(certificate);
  });

  return { candidates: withCert, attachedCertificates };
};

export const buildCandidates = ({ signups = [], attendances = [], participants = [], certificates = [] }) => {
  const rows = [
    ...attendances.map(fromAttendance).filter(Boolean),
    ...signups.map(fromSignup),
    ...participants.map(fromParticipant),
  ];

  // signups have no CPF (email-only) while attendances are CPF-keyed, so the same person can
  // surface under two different keys; keyByEmail lets a later row find an earlier one by email
  // and, when the earlier one lacked a CPF, re-key it once a CPF becomes known.
  const byKey = new Map();
  const keyByEmail = new Map();
  rows.forEach((row) => {
    const cpf = row.identifier;
    const email = row.email;
    const key = cpf || email;
    if (!key) return;

    let existing = byKey.get(key) ?? (email ? byKey.get(keyByEmail.get(email)) : undefined);

    // Two different CPFs sharing an email belong to different people.
    if (existing && existing.identifier && cpf && existing.identifier !== cpf) {
      existing = undefined;
    }

    // The earlier row only had an email; now we learn this person's CPF — re-key in place.
    if (existing && !existing.identifier && cpf) {
      byKey.delete(existing.key);
      existing.key = cpf;
      byKey.set(cpf, existing);
      if (email) keyByEmail.set(email, cpf);
    }

    const merged = existing ? merge(existing, row) : { key, ...row, sources: [row.source], topSource: row.source };
    byKey.set(merged.key, merged);
    if (email) keyByEmail.set(email, merged.key);
  });

  const certByIdentifier = new Map(
    certificates
      .map((c) => [normalizeIdentifier(c.identifier), c])
      .filter(([id]) => id),
  );

  // First-wins: if two certificates share an e-mail, only the first one is reachable by e-mail.
  const certByEmail = new Map();
  certificates.forEach((c) => {
    const email = normalizeEmail(c.email);
    if (email && !certByEmail.has(email)) certByEmail.set(email, c);
  });

  const { candidates: attachedCandidates, attachedCertificates } = attachCertificates(
    [...byKey.values()],
    { certByIdentifier, certByEmail },
  );

  const candidates = attachedCandidates.map((c) => ({
    key: c.key,
    name: c.name,
    email: c.email,
    identifier: c.identifier,
    phone: c.phone,
    sources: [...c.sources].sort((a, b) => SOURCE_PRIORITY[b] - SOURCE_PRIORITY[a]),
    checked_in: c.checked_in,
    certificate: c.certificate,
  }));

  // Orphan certificates (no matching source row) become candidates of their own, keyed like the
  // rest: by CPF, or by e-mail when they were issued without one.
  const seenKeys = new Set(candidates.flatMap((c) => [c.identifier, c.key]).filter(Boolean));
  certificates.forEach((cert) => {
    if (attachedCertificates.has(cert)) return;
    const id = normalizeIdentifier(cert.identifier);
    if (!id || seenKeys.has(id)) return;
    seenKeys.add(id);
    attachedCertificates.add(cert);
    candidates.push({
      key: id,
      name: cert.name || '',
      email: normalizeEmail(cert.email),
      identifier: cpfDigits(id),
      phone: '',
      sources: [],
      checked_in: false,
      certificate: cert,
    });
  });

  return candidates.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
};

// Fills the CPF of candidates that lack one from `sw-form` rows (matched by e-mail, case-insensitive)
// Pure. Never overwrites a valid CPF; ignores rows whose CPF is invalid.
export const enrichIdentifiersFromForms = (candidates, forms) => {
  const cpfByEmail = new Map();
  (forms || []).forEach((form) => {
    const email = normalizeEmail(form?.email);
    if (!email || cpfByEmail.has(email) || !isValidCpf(form?.cpf)) return;
    cpfByEmail.set(email, normalizeIdentifier(form.cpf));
  });
  if (cpfByEmail.size === 0) return candidates;

  return candidates.map((c) => {
    if (isValidCpf(c.identifier)) return c;
    const cpf = cpfByEmail.get(normalizeEmail(c.email));
    return cpf ? { ...c, identifier: cpf } : c;
  });
};
