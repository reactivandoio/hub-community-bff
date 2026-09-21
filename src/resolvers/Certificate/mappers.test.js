import { describe, it, expect } from 'vitest';
import {
  mediaUrl,
  mapConfig,
  mapCertificate,
  mapRequestForm,
  maskPublicCertificate,
  mediaIdFromInput,
} from './mappers';
import { buildConfigData, resolveIssueIdentifier } from './index';

const BASE = 'https://manager.test';

describe('mediaUrl', () => {
  it('prefixes relative strapi urls', () => {
    expect(mediaUrl({ url: '/uploads/a.png' }, BASE)).toBe('https://manager.test/uploads/a.png');
  });
  it('keeps absolute urls', () => {
    expect(mediaUrl({ url: 'https://cdn/x.png' }, BASE)).toBe('https://cdn/x.png');
  });
  it('accepts plain strings and nulls', () => {
    expect(mediaUrl('/uploads/b.png', BASE)).toBe('https://manager.test/uploads/b.png');
    expect(mediaUrl(null, BASE)).toBeNull();
    expect(mediaUrl(undefined, BASE)).toBeNull();
  });
});

describe('mapConfig', () => {
  it('returns null for null', () => {
    expect(mapConfig(null, BASE)).toBeNull();
  });
  it('maps media in nested components', () => {
    const raw = {
      documentId: 'cfg1',
      enabled: true,
      allow_self_request: false,
      title: 'T',
      body_template: 'B',
      workload_hours: 8,
      issuer_name: 'R',
      primary_color: '#10B981',
      logo: { id: 7, url: '/uploads/logo.png' },
      background: null,
      sponsors: [{ name: 'S', url: 'https://s', logo: { id: 8, url: '/uploads/s.png' } }],
      signatures: [
        { name: 'A', role: 'CEO', image: null },
        { name: 'B', role: 'Org', image: null, text: 'Bia Lima', font: 'allura' },
      ],
    };
    expect(mapConfig(raw, BASE)).toEqual({
      id: 'cfg1',
      enabled: true,
      allow_self_request: false,
      title: 'T',
      body_template: 'B',
      workload_hours: 8,
      issuer_name: 'R',
      primary_color: '#10B981',
      logo: 'https://manager.test/uploads/logo.png',
      logo_id: '7',
      background: null,
      background_id: null,
      sponsors: [{ name: 'S', url: 'https://s', logo: 'https://manager.test/uploads/s.png', logo_id: '8' }],
      signatures: [
        { name: 'A', role: 'CEO', image: null, image_id: null, text: null, font: 'great_vibes' },
        { name: 'B', role: 'Org', image: null, image_id: null, text: 'Bia Lima', font: 'allura' },
      ],
    });
  });
  it('defaults booleans and arrays', () => {
    const mapped = mapConfig({ documentId: 'c' }, BASE);
    expect(mapped.enabled).toBe(false);
    expect(mapped.allow_self_request).toBe(true);
    expect(mapped.sponsors).toEqual([]);
    expect(mapped.signatures).toEqual([]);
  });
});

describe('buildConfigData', () => {
  it('carries cursive signature fields to strapi and defaults the font', () => {
    const data = buildConfigData({
      signatures: [
        { name: 'A', role: 'CEO', image: '12' },
        { name: 'B', text: 'Bia Lima', font: 'allura' },
      ],
    });
    expect(data.signatures).toEqual([
      { name: 'A', role: 'CEO', image: 12, text: null, font: 'great_vibes' },
      { name: 'B', role: null, image: null, text: 'Bia Lima', font: 'allura' },
    ]);
  });
});

describe('mapCertificate', () => {
  it('maps fields and passes event through', () => {
    const event = { documentId: 'ev', title: 'Evento' };
    const raw = {
      documentId: 'c1', code: 'RCT-AAAAAAAA', name: 'N', identifier: '12345678909',
      email: 'e@e.com', source: 'ADMIN', issued_at: '2026-01-01', sent_at: null,
      revoked_at: null, event,
    };
    expect(mapCertificate(raw)).toEqual({
      id: 'c1', code: 'RCT-AAAAAAAA', name: 'N', identifier: '12345678909',
      email: 'e@e.com', source: 'ADMIN', category: 'Participante', issued_at: '2026-01-01',
      sent_at: null, revoked_at: null, event,
    });
  });
  it('reads a certificate issued before categories existed as a participante one', () => {
    expect(mapCertificate({ documentId: 'c1', category: null }).category).toBe('Participante');
  });
  it('keeps the category it was issued with', () => {
    expect(mapCertificate({ documentId: 'c1', category: 'Mentor' }).category).toBe('Mentor');
  });
  it('returns null for null', () => {
    expect(mapCertificate(null)).toBeNull();
  });
});

describe('mapRequestForm', () => {
  const raw = {
    documentId: 'f1',
    title: 'Certificado de organização',
    category: 'Organizador',
    slug: 'evento-organizador',
    description: 'Para quem organizou',
    enabled: true,
  };

  it('maps the form and carries the submission count', () => {
    expect(mapRequestForm(raw, 3)).toEqual({
      id: 'f1',
      title: 'Certificado de organização',
      category: 'Organizador',
      slug: 'evento-organizador',
      description: 'Para quem organizou',
      enabled: true,
      submissions: 3,
    });
  });

  it('defaults enabled to true, description to null and submissions to zero', () => {
    const mapped = mapRequestForm({ documentId: 'f2', title: 'T', slug: 's' });
    expect(mapped).toMatchObject({
      category: 'Participante', description: null, enabled: true, submissions: 0,
    });
  });

  it('returns null for null', () => {
    expect(mapRequestForm(null)).toBeNull();
  });
});

describe('mediaIdFromInput', () => {
  it('parses numeric strings', () => {
    expect(mediaIdFromInput('12')).toBe(12);
    expect(mediaIdFromInput(12)).toBe(12);
  });
  it('returns null for empty', () => {
    expect(mediaIdFromInput('')).toBeNull();
    expect(mediaIdFromInput(null)).toBeNull();
    expect(mediaIdFromInput(undefined)).toBeNull();
  });
});

describe('maskPublicCertificate', () => {
  it('nulls identifier and e-mail but keeps everything else', () => {
    const certificate = mapCertificate({
      documentId: 'c1', code: 'RCT-AAAAAAAA', name: 'Ana', identifier: '52998224725',
      email: 'ana@x.com', source: 'ADMIN', issued_at: '2026-01-01T00:00:00Z', event: { title: 'Ev' },
    });
    expect(maskPublicCertificate(certificate)).toEqual({
      ...certificate, identifier: null, email: null,
    });
    expect(maskPublicCertificate(certificate).name).toBe('Ana');
    expect(maskPublicCertificate(certificate).event.title).toBe('Ev');
  });
  it('passes null through', () => {
    expect(maskPublicCertificate(null)).toBeNull();
  });
});

describe('resolveIssueIdentifier', () => {
  it('prefers a valid CPF, normalized to digits', () => {
    expect(resolveIssueIdentifier({ identifier: '529.982.247-25', email: 'Ana@X.com' })).toBe('52998224725');
  });
  it('falls back to the normalized e-mail when the CPF is missing', () => {
    expect(resolveIssueIdentifier({ email: ' Ana@X.com ' })).toBe('ana@x.com');
    expect(resolveIssueIdentifier({ identifier: '', email: 'ana@x.com' })).toBe('ana@x.com');
  });
  it('falls back to the e-mail when the CPF is invalid', () => {
    expect(resolveIssueIdentifier({ identifier: '123', email: 'ana@x.com' })).toBe('ana@x.com');
  });
  it('is empty when neither is usable', () => {
    expect(resolveIssueIdentifier({ identifier: '123', email: 'nope' })).toBe('');
    expect(resolveIssueIdentifier({ identifier: '123', email: 'foo@bar' })).toBe('');
    expect(resolveIssueIdentifier({})).toBe('');
  });
});

describe('certificateConfigs (resolver)', () => {
  it('lists every model with its event, newest event first, and requires a user', async () => {
    const { default: Certificate } = await import('./index');
    const raw = (title, startDate, documentId) => ({
      documentId: `cfg-${documentId}`,
      enabled: true,
      title: `Certificado ${title}`,
      event: {
        documentId, slug: title.toLowerCase(), title, start_date: startDate,
      },
    });
    const dataSources = {
      managerIntegration: {
        findAllCertificateConfigs: async () => [
          raw('Antigo', '2025-03-01T12:00:00.000Z', 'e1'),
          raw('Recente', '2026-08-01T12:00:00.000Z', 'e2'),
          {
            documentId: 'orphan', enabled: true, title: 'sem evento', event: null,
          },
        ],
      },
    };
    const ctx = { user: { id: 1 }, dataSources };
    const out = await Certificate.Query.certificateConfigs(null, {}, ctx);
    expect(out.map((c) => c.event.title)).toEqual(['Recente', 'Antigo']);
    expect(out[0].event).toEqual({
      id: 'e2',
      slug: 'recente',
      title: 'Recente',
      start_date: '2026-08-01T12:00:00.000Z',
    });
    expect(out[0].config.title).toBe('Certificado Recente');
    const anonymous = { user: null, dataSources };
    await expect(Certificate.Query.certificateConfigs(null, {}, anonymous)).rejects.toThrow();
  });
});
