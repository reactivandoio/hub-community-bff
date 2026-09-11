// Maps raw Strapi payloads (already flattened by graphqlUtils) into the GraphQL shapes.

export const mediaUrl = (media, baseUrl = process.env.MANAGER_URL) => {
  if (!media) return null;
  const url = typeof media === 'string' ? media : media.url;
  if (!url) return null;
  return url.startsWith('http') ? url : `${baseUrl}${url}`;
};

export const mediaIdFromInput = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mediaId = (media) => (media && media.id != null ? String(media.id) : null);

export const mapConfig = (raw, baseUrl = process.env.MANAGER_URL) => {
  if (!raw) return null;
  return {
    id: raw.documentId,
    enabled: Boolean(raw.enabled),
    allow_self_request: raw.allow_self_request !== false,
    title: raw.title ?? null,
    body_template: raw.body_template ?? null,
    workload_hours: raw.workload_hours ?? null,
    issuer_name: raw.issuer_name ?? null,
    primary_color: raw.primary_color ?? null,
    logo: mediaUrl(raw.logo, baseUrl),
    logo_id: mediaId(raw.logo),
    background: mediaUrl(raw.background, baseUrl),
    background_id: mediaId(raw.background),
    sponsors: (raw.sponsors || []).map((s) => ({
      name: s.name,
      url: s.url ?? null,
      logo: mediaUrl(s.logo, baseUrl),
      logo_id: mediaId(s.logo),
    })),
    signatures: (raw.signatures || []).map((s) => ({
      name: s.name,
      role: s.role ?? null,
      image: mediaUrl(s.image, baseUrl),
      image_id: mediaId(s.image),
    })),
  };
};

export const mapCertificate = (raw) => {
  if (!raw) return null;
  return {
    id: raw.documentId,
    code: raw.code,
    name: raw.name,
    identifier: raw.identifier,
    email: raw.email,
    source: raw.source,
    issued_at: raw.issued_at ?? null,
    sent_at: raw.sent_at ?? null,
    revoked_at: raw.revoked_at ?? null,
    event: raw.event ?? null,
  };
};
