import { describe, it, expect, vi } from 'vitest';
import Analytics from './index';

// These tests cover what each resolver does once allowed; who is allowed is covered
// in utils/auth/index.test.js and in the authorization tests below.
const ADMIN = { documentId: 'u-admin', email: 'admin@x.io', role: { type: 'admin' } };

const rawSignups = [
  { id: 1, name: 'ana-4f2k', email: 'ana@x.io', createdAt: '2026-09-01T10:00:00.000Z' },
  { id: 2, name: 'Bia Lima', email: 'bia@x.io', createdAt: '2026-09-02T10:00:00.000Z' },
];

const makeDataSources = ({ users = [], usersError = null, swForms = [] } = {}) => ({
  manager: { findEvents: vi.fn().mockResolvedValue({ data: [] }) },
  eventandoIntegration: {
    findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42, name: 'Ev', slug: 'ev', uuid: 'u', products: [] }] }),
    findSignupsByEvent: vi.fn().mockResolvedValue(rawSignups),
  },
  managerIntegration: {
    findParticipants: vi.fn().mockResolvedValue({ meta: { pagination: { total: 0 } } }),
    findUsersByEmails: usersError
      ? vi.fn().mockRejectedValue(usersError)
      : vi.fn().mockResolvedValue(users),
    findSwFormsByEmails: vi.fn().mockResolvedValue(swForms),
  },
});

describe('eventAnalytics.all_signups', () => {
  it('uses the HubCommunity user name when the account has one', async () => {
    const dataSources = makeDataSources({ users: [{ email: 'ana@x.io', name: 'Ana Souza' }] });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources, user: ADMIN });
    expect(out.all_signups.map((s) => s.name)).toEqual(['Ana Souza', 'Bia Lima']);
    expect(dataSources.managerIntegration.findUsersByEmails).toHaveBeenCalledWith(['ana@x.io', 'bia@x.io']);
  });

  it('keeps the signup names when the user lookup fails', async () => {
    const dataSources = makeDataSources({ usersError: new Error('strapi down') });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources, user: ADMIN });
    expect(out.all_signups.map((s) => s.name)).toEqual(['ana-4f2k', 'Bia Lima']);
  });

  it('carries the CPF from the account, or from the Startup Weekend form', async () => {
    const dataSources = makeDataSources({
      users: [{ email: 'ana@x.io', name: 'Ana Souza', cpf: '123.456.789-09' }],
      swForms: [{ email: 'bia@x.io', cpf: '98765432100' }],
    });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources, user: ADMIN });
    expect(out.all_signups.map((s) => s.cpf)).toEqual(['12345678909', '98765432100']);
  });

  it('still answers without CPFs when the sw-form lookup fails', async () => {
    const dataSources = makeDataSources();
    dataSources.managerIntegration.findSwFormsByEmails = vi.fn(() => {
      throw new Error('boom');
    });
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources, user: ADMIN });
    expect(out.all_signups.map((s) => s.cpf)).toEqual([null, null]);
  });
});

describe('eventAnalytics.products_breakdown (REA-19)', () => {
  const batch = { id: 7, documentId: 'b7', batch_number: 1, value: 2000, max_quantity: 100 };
  const freeBatch = { id: 8, documentId: 'b8', batch_number: 1, value: 0, max_quantity: 50 };
  const products = [
    { id: 3, documentId: 'p3', name: 'Ingresso', batches: [batch] },
    { id: 4, documentId: 'p4', name: 'Gratuito', batches: [freeBatch] },
  ];
  const paid = (status, value, extra = {}) => ({
    status,
    value,
    batch: { id: 7, documentId: 'b7', product: { id: 3, documentId: 'p3', name: 'Ingresso' } },
    ...extra,
  });
  const signups = [
    { id: 1, email: 'pendente@x.io', payment: paid('PEDING_PAYMENT', 2000, { expires_at: '2999-01-01T00:00:00.000Z' }) },
    { id: 2, email: 'expirado@x.io', payment: paid('EXPIRED', 2000) },
    { id: 3, email: 'vencido@x.io', payment: paid('PEDING_PAYMENT', 2000, { expires_at: '2020-01-01T00:00:00.000Z' }) },
    { id: 4, email: 'cancelado@x.io', payment: paid('CANCELED', 2000) },
    { id: 5, email: 'reembolsado@x.io', payment: paid('REFUND', 2000) },
    { id: 6, email: 'cheio@x.io', payment: paid('CONFIRMED', 2000, { original_value: 2000 }) },
    { id: 7, email: 'cupom@x.io', payment: paid('CONFIRMED', 1500, { original_value: 2000, discount_cents: 500 }) },
    { id: 8, email: 'meia@x.io', payment: paid('CONFIRMED', 1000, { original_value: 2000, half_price: true }) },
    // Old Pix Aí payment: CONFIRMED, value in cents, no original_value nor provider.
    { id: 9, email: 'pixai@x.io', payment: paid('CONFIRMED', 2000) },
    {
      id: 10,
      email: 'gratis@x.io',
      payment: { status: 'CONFIRMED', value: 0, batch: { id: 8, documentId: 'b8', product: { id: 4, documentId: 'p4' } } },
    },
  ];

  const run = async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.findEvents = vi
      .fn()
      .mockResolvedValue({ data: [{ id: 42, name: 'Ev', slug: 'ev', uuid: 'u', products }] });
    dataSources.eventandoIntegration.findSignupsByEvent = vi.fn().mockResolvedValue(signups);
    const out = await Analytics.Query.eventAnalytics(null, { slugOrId: 'ev' }, { dataSources, user: ADMIN });
    return out.products_breakdown;
  };

  it('counts as sold only confirmed payments: not pending, expired, canceled or refunded', async () => {
    const [ingresso] = await run();
    expect(ingresso.batches[0].sold_quantity).toBe(4);
    expect(ingresso.total_signups).toBe(4);
  });

  it('sums what was paid, in cents, with coupon and half price, old Pix Aí included', async () => {
    const [ingresso] = await run();
    expect(ingresso.batches[0].value).toBe(2000);
    expect(ingresso.batches[0].revenue).toBe(2000 + 1500 + 1000 + 2000);
  });

  it('counts a confirmed free signup as sold with no revenue', async () => {
    const [, gratuito] = await run();
    expect(gratuito.batches[0]).toMatchObject({ sold_quantity: 1, revenue: 0, value: 0 });
    expect(gratuito.total_signups).toBe(1);
  });

  it('hides a deleted batch with no sale even if it had expired signups', async () => {
    const deleted = { ...batch, deleted: true };
    products[0].batches = [deleted];
    const saved = signups.splice(5, 4);
    try {
      const [ingresso] = await run();
      expect(ingresso.batches).toEqual([]);
    } finally {
      signups.splice(5, 0, ...saved);
      products[0].batches = [batch];
    }
  });
});
