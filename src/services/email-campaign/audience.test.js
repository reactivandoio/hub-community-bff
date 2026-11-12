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
    // REA-36: everyone is an adult unless a test says otherwise.
    findUsersByEmails: vi.fn(async (emails) => emails.map((email) => ({ email, date_of_birth: '1990-01-01' }))),
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
        { id: 11, email: 'Eva@x.io', name: 'Eva', date_of_birth: '1990-01-01' },
        { id: 12, email: 'fred@x.io', username: 'fred', blocked: true },
      ]),
    });
    const out = await loadCandidates({ dataSources: ds, campaign: { type: 'invite', cursor: 10 } });
    expect(ds.managerIntegration.findUsersAfterId).toHaveBeenCalledWith(10, USERS_PAGE);
    expect(out).toEqual({
      candidates: [
        { email: 'eva@x.io', name: 'Eva', cursor: 11, adult: true },
        { email: '', name: 'fred', cursor: 12, adult: false },
      ],
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
    const candidates = ['ana@x.io', 'gil@x.io', 'hugo@x.io', 'ivo@x.io', ''].map((email) => ({ email, adult: true }));
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

describe('screenCandidates: only adults (REA-36)', () => {
  it('skips invite users without a date of birth or under 18, read with the user', async () => {
    const ds = makeDataSources();
    const candidates = [{ email: 'a@x.io', adult: true }, { email: 'b@x.io', adult: false }];
    const out = await screenCandidates({ dataSources: ds, campaign: { documentId: 'c1', type: 'invite' }, candidates, signups: [] });
    expect(out.map((c) => c.skip)).toEqual([null, 'no-birth-date']);
    expect(ds.managerIntegration.findUsersByEmails).not.toHaveBeenCalled();
  });

  it('looks up the account of each signup: no account, no date, minor or blocked are skipped', async () => {
    const ds = makeDataSources({
      findUsersByEmails: vi.fn().mockResolvedValue([
        { email: 'ok@x.io', date_of_birth: '1990-01-01' },
        { email: 'nodate@x.io', date_of_birth: null },
        { email: 'minor@x.io', date_of_birth: '2015-01-01' },
        { email: 'blocked@x.io', date_of_birth: '1990-01-01', blocked: true },
      ]),
    });
    const candidates = ['ok@x.io', 'nodate@x.io', 'minor@x.io', 'blocked@x.io', 'noaccount@x.io'].map((email) => ({ email }));
    const out = await screenCandidates({ dataSources: ds, campaign: { documentId: 'c1', type: 'share' }, candidates, signups: [] });
    expect(out.map((c) => c.skip)).toEqual([null, 'no-birth-date', 'no-birth-date', 'no-birth-date', 'no-birth-date']);
  });
});

describe('countAudience', () => {
  it('estimates the base minus the suppression list', async () => {
    expect(await countAudience({ dataSources: makeDataSources(), eventSlug: 'm', type: 'invite' }))
      .toEqual({ total: 100, approximate: true });
  });

  it('REA-36: counts only adults of the base (date of birth up to 18 years ago)', async () => {
    const ds = makeDataSources();
    await countAudience({ dataSources: ds, eventSlug: 'm', type: 'invite' });
    expect(ds.managerIntegration.countReachableUsers).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('REA-36: counts only signups whose account is an adult', async () => {
    const ds = makeDataSources({ findUsersByEmails: vi.fn().mockResolvedValue([{ email: 'ana@x.io', date_of_birth: '1990-01-01' }]) });
    expect(await countAudience({ dataSources: ds, eventSlug: 'm', type: 'share' })).toEqual({ total: 1, approximate: false });
  });

  it('counts the signups exactly, without the unsubscribed', async () => {
    const ds = makeDataSources({ findSuppressedEmails: vi.fn().mockResolvedValue(new Set(['bia@x.io'])) });
    expect(await countAudience({ dataSources: ds, eventSlug: 'm', type: 'share' })).toEqual({ total: 1, approximate: false });
  });
});
