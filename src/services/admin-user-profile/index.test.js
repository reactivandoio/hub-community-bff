import { describe, it, expect, vi } from 'vitest';
import {
  emailKindOf, loadUserProfile, maskCpf, toUserEmail, toUserSignup,
} from './index';

const NOW = new Date('2026-11-16T12:00:00Z');

describe('maskCpf (REA-52)', () => {
  it('shows only the middle digits', () => {
    expect(maskCpf('529.982.247-25')).toBe('***.982.247-**');
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
    expect(maskCpf('123')).toBe('***');
    expect(maskCpf(null)).toBeNull();
  });
});

describe('toUserSignup', () => {
  it('reads the event, product, payment and check-in', () => {
    expect(toUserSignup({
      id: 42,
      createdAt: '2026-11-01T10:00:00Z',
      checked_in: true,
      event: { id: 5, uuid: 'ev-doc', name: 'Meetup', slug: 'meetup' },
      payment: { status: 'CONFIRMED', value: 5000, batch: { product: { name: 'Lote 1' } } },
    }, NOW)).toEqual({
      id: '42',
      event: { id: 'ev-doc', title: 'Meetup', slug: 'meetup' },
      created_at: '2026-11-01T10:00:00Z',
      product_name: 'Lote 1',
      payment_status: 'CONFIRMED',
      paid_cents: 5000,
      manual_approved: false,
      checked_in: true,
      checked_in_at: null,
    });
  });

  it('a free signup has no payment status; an approved one paid 0', () => {
    expect(toUserSignup({ id: 1, event: null, payment: null }, NOW)).toMatchObject({ payment_status: null, paid_cents: null });
    expect(toUserSignup({
      id: 2, payment: { status: 'CONFIRMED', value: 5000, manual_approved_at: '2026-11-01' },
    }, NOW)).toMatchObject({ manual_approved: true, paid_cents: null });
  });
});

describe('e-mails', () => {
  it('names the kind of older records from their campaign id', () => {
    expect(emailKindOf({ campaign_document_id: 'transactional:login-code' })).toBe('login-code');
    expect(emailKindOf({ campaign_document_id: 'strapi:sw-form' })).toBe('sw-form');
    expect(emailKindOf({ campaign_document_id: 'age-review-dob' })).toBe('age-review');
    expect(emailKindOf({ campaign_document_id: 'abc123' })).toBe('campaign');
    expect(emailKindOf({ kind: 'certificate', campaign_document_id: 'x' })).toBe('certificate');
  });

  it('maps a record with its Mailgun events', () => {
    expect(toUserEmail({
      documentId: 'd1', campaign_document_id: 'transactional:signup-confirmation', subject: 'Inscrição', status: 'sent',
      sent_at: '2026-11-15T10:00:00Z', message_id: 'abc@mg', last_event: 'opened',
      events: [{ id: 'e', event: 'delivered', at: '2026-11-15T10:00:05Z' }],
    })).toMatchObject({
      id: 'd1', kind: 'signup-confirmation', subject: 'Inscrição', last_event: 'opened',
      events: [{ event: 'delivered', at: '2026-11-15T10:00:05Z', severity: null }],
    });
  });
});

describe('loadUserProfile', () => {
  const user = {
    id: 9, documentId: 'u9', email: 'Ana@x.io', name: 'Ana', cpf: '52998224725', confirmed: true, createdAt: '2026-01-01',
  };
  const toUser = (u) => ({ id: String(u.id), documentId: u.documentId, email: u.email, name: u.name, communities: [], events: [] });
  const dataSources = () => ({
    eventandoIntegration: { findSignupsByEmail: vi.fn().mockResolvedValue([{ id: 1, payment: null }]) },
    managerIntegration: {
      adminFindUserCertificates: vi.fn().mockResolvedValue([{ documentId: 'c1', code: 'RCT-1' }]),
      adminFindUserAttendances: vi.fn().mockResolvedValue([]),
      accountStatus: vi.fn().mockResolvedValue([{ email: 'ana@x.io', pending: false }]),
      findEmailDeliveriesByEmail: vi.fn().mockResolvedValue({ items: [], total: 7 }),
    },
  });

  it('brings everything, with the CPF masked and looked up by digits', async () => {
    const ds = dataSources();
    const out = await loadUserProfile({ user, dataSources: ds, toUser, now: NOW });
    expect(out).toMatchObject({
      cpf_masked: '***.982.247-**', registration_pending: false, email_count: 7,
      signups: [{ id: '1' }], certificates: [{ code: 'RCT-1' }], attendances: [],
    });
    expect(JSON.stringify(out)).not.toContain('52998224725');
    expect(ds.managerIntegration.adminFindUserCertificates)
      .toHaveBeenCalledWith({ documentId: 'u9', email: 'Ana@x.io', cpf: '52998224725' });
  });

  it('a source that fails leaves its list null and the rest of the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = dataSources();
    ds.eventandoIntegration.findSignupsByEmail.mockRejectedValue(new Error('eventando down'));
    const out = await loadUserProfile({ user, dataSources: ds, toUser, now: NOW });
    expect(out.signups).toBeNull();
    expect(out.certificates).toHaveLength(1);
  });
});
