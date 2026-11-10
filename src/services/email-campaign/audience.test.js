import { describe, it, expect, vi } from 'vitest';
import {
  USERS_PAGE, countAudience, deliveryKey, loadCandidates, screenCandidates, signupRecipients,
} from './audience';

const signups = [
  { email: 'Ana@x.io', name: 'Ana' }, // free
  { email: 'ana@x.io ', name: 'Ana 2' }, // same person again
  { email: 'bia@x.io', name: 'Bia', payment: { status: 'CONFIRMED' } },
  { email: 'caio@x.io', name: 'Caio', payment: { status: 'PEDING_PAYMENT' } },
  { email: 'duda@x.io', name: 'Duda', payment: { status: 'EXPIRED' } },
];

const makeDataSources = (over = {}) => ({
  eventandoIntegration: {
    findEvents: vi.fn().mockResolvedValue({ data: [{ id: 9 }] }),
    findSignupsByEvent: vi.fn().mockResolvedValue(signups),
  },
  managerIntegration: {
    findUsersAfterId: vi.fn().mockResolvedValue([]),
    findSuppressedEmails: vi.fn().mockResolvedValue(new Set()),
    findEmailDeliveriesByKeys: vi.fn().mockResolvedValue([]),
    countReachableUsers: vi.fn().mockResolvedValue(120),
    countEmailSuppressions: vi.fn().mockResolvedValue(20),
    ...over,
  },
});

describe('signupRecipients', () => {
  it('keeps those who hold a place, once per normalized e-mail', () => {
    expect(signupRecipients(signups)).toEqual([
      { email: 'ana@x.io', name: 'Ana' },
      { email: 'bia@x.io', name: 'Bia' },
    ]);
  });
});

describe('deliveryKey', () => {
  it('is campaign and normalized e-mail', () => {
    expect(deliveryKey('c1', ' Ana@X.io')).toBe('c1:ana@x.io');
  });
});

describe('loadCandidates', () => {
  it('walks the base by id after the cursor, blocked users without e-mail', async () => {
    const ds = makeDataSources({
      findUsersAfterId: vi.fn().mockResolvedValue([
        { id: 11, email: 'Eva@x.io', name: 'Eva' },
        { id: 12, email: 'fred@x.io', username: 'fred', blocked: true },
      ]),
    });
    const out = await loadCandidates({ dataSources: ds, campaign: { type: 'invite', cursor: 10 } });
    expect(ds.managerIntegration.findUsersAfterId).toHaveBeenCalledWith(10, USERS_PAGE);
    expect(out).toEqual({
      candidates: [{ email: 'eva@x.io', name: 'Eva', cursor: 11 }, { email: '', name: 'fred', cursor: 12 }],
      exhausted: true,
    });
  });

  it('is not exhausted while a page comes back full', async () => {
    const page = Array.from({ length: USERS_PAGE }, (_, i) => ({ id: i + 1, email: `u${i}@x.io` }));
    const ds = makeDataSources({ findUsersAfterId: vi.fn().mockResolvedValue(page) });
    expect((await loadCandidates({ dataSources: ds, campaign: { type: 'invite' } })).exhausted).toBe(false);
  });

  it('gives the signups to share and reminder', async () => {
    const out = await loadCandidates({ dataSources: makeDataSources(), campaign: { type: 'reminder' }, signups });
    expect(out.candidates.map((c) => c.email)).toEqual(['ana@x.io', 'bia@x.io']);
    expect(out.exhausted).toBe(true);
  });
});

describe('screenCandidates', () => {
  it('skips unsubscribed, already delivered, signed up (invite) and blocked', async () => {
    const ds = makeDataSources({
      findSuppressedEmails: vi.fn().mockResolvedValue(new Set(['gil@x.io'])),
      findEmailDeliveriesByKeys: vi.fn().mockResolvedValue([{ email: 'hugo@x.io' }]),
    });
    const candidates = ['ana@x.io', 'gil@x.io', 'hugo@x.io', 'ivo@x.io', ''].map((email) => ({ email }));
    const out = await screenCandidates({ dataSources: ds, campaign: { documentId: 'c1', type: 'invite' }, candidates, signups });
    expect(out.map((c) => c.skip)).toEqual(['signed-up', 'unsubscribed', 'delivered', null, 'no-email']);
    expect(ds.managerIntegration.findEmailDeliveriesByKeys).toHaveBeenCalledWith(
      ['c1:ana@x.io', 'c1:gil@x.io', 'c1:hugo@x.io', 'c1:ivo@x.io'],
    );
  });

  it('does not skip signups of a reminder', async () => {
    const out = await screenCandidates({
      dataSources: makeDataSources(), campaign: { documentId: 'c1', type: 'reminder' }, candidates: [{ email: 'ana@x.io' }], signups,
    });
    expect(out[0].skip).toBeNull();
  });
});

describe('countAudience', () => {
  it('estimates the base minus the suppression list', async () => {
    expect(await countAudience({ dataSources: makeDataSources(), eventSlug: 'm', type: 'invite' }))
      .toEqual({ total: 100, approximate: true });
  });

  it('counts the signups exactly, without the unsubscribed', async () => {
    const ds = makeDataSources({ findSuppressedEmails: vi.fn().mockResolvedValue(new Set(['bia@x.io'])) });
    expect(await countAudience({ dataSources: ds, eventSlug: 'm', type: 'share' })).toEqual({ total: 1, approximate: false });
  });
});
