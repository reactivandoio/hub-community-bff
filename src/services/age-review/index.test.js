import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  blockMinor, formatDateBr, listAgeReview, requestDateOfBirth, toAgeReviewUser,
} from '.';

vi.mock('../../utils/auth', () => ({ clearUserCache: vi.fn() }));

const now = new Date('2026-11-12T15:00:00.000Z');
const env = { FRONTEND_URL: 'https://hub.io', EMAIL_CAMPAIGN_DAILY_LIMIT: '70' };
const ADMIN = { id: 1 };

const makeIntegration = ({ users = {}, sentToday = 0, pending = [] } = {}) => {
  const keys = new Set();
  return {
    countEmailDeliveriesSince: vi.fn().mockResolvedValue(sentToday),
    adminFindAgeReviewUser: vi.fn(async (id) => users[id] || null),
    adminFindAgeReviewUsers: vi.fn().mockResolvedValue(Object.values(users)),
    adminCountAgeReviewUsers: vi.fn().mockResolvedValue(Object.keys(users).length),
    adminUpdateUserFields: vi.fn().mockResolvedValue({}),
    accountStatus: vi.fn(async ([email]) => [{ email, pending: pending.includes(email) }]),
    accountSetup: vi.fn().mockResolvedValue({ created: false, pending: true }),
    createEmailDelivery: vi.fn(async (data) => {
      if (keys.has(data.key)) throw new Error('This attribute must be unique');
      keys.add(data.key);
      return { documentId: `d-${data.key}` };
    }),
    updateEmailDelivery: vi.fn().mockResolvedValue({}),
  };
};

let send;
beforeEach(() => {
  send = vi.fn().mockResolvedValue({ success: true });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('toAgeReviewUser', () => {
  it('gives the age and the deadline 7 days after the request', () => {
    const out = toAgeReviewUser({ id: 3, date_of_birth: '2010-01-01', age_review_requested_at: '2026-11-10T12:00:00.000Z' }, now);
    expect(out).toMatchObject({ id: '3', age: 16, deadline: '2026-11-17T12:00:00.000Z', blocked: false });
  });
  it('formats dates in São Paulo', () => {
    expect(formatDateBr(new Date('2026-11-19T02:00:00.000Z'))).toBe('18/11/2026');
  });
});

describe('listAgeReview', () => {
  it('filters minors by the adult cutoff and reports the e-mails left today', async () => {
    const integration = makeIntegration({ users: { 3: { id: 3, date_of_birth: '2010-01-01' } }, sentToday: 50 });
    const out = await listAgeReview({ integration, kind: 'MINOR', page: 1, pageSize: 20, env, now });
    expect(integration.adminFindAgeReviewUsers).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MINOR', cutoff: '2008-11-12' }));
    expect(out).toMatchObject({ total: 1, emailsLeftToday: 20 });
  });
  it('refuses an unknown list or status', async () => {
    await expect(listAgeReview({ integration: makeIntegration(), kind: 'X', page: 1, pageSize: 20, env, now })).rejects.toThrow('Lista inválida.');
    await expect(listAgeReview({ integration: makeIntegration(), kind: 'MINOR', status: 'x', page: 1, pageSize: 20, env, now })).rejects.toThrow('Situação inválida.');
  });
});

describe('requestDateOfBirth', () => {
  const users = {
    10: { id: 10, email: 'Ana@x.io', name: 'Ana', date_of_birth: null },
    11: { id: 11, email: 'bia@x.io', date_of_birth: '1990-01-01' },
    12: { id: 12, email: 'caio@x.io', date_of_birth: null, blocked: true },
    13: { id: 13, email: 'duda@x.io', date_of_birth: null, age_review_status: 'dob_requested' },
    14: { id: 14, email: 'eva@x.io', date_of_birth: null },
  };

  it('e-mails only accounts without a date, then marks them dob_requested from now', async () => {
    const integration = makeIntegration({ users });
    const out = await requestDateOfBirth({ integration, userIds: ['10', '11', '12', '13', '99'], actor: ADMIN, env, now, send });
    expect(out.results.map((r) => r.outcome)).toEqual(['sent', 'has-birth-date', 'blocked', 'already-requested', 'not-found']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'ana@x.io' });
    expect(send.mock.calls[0][0].html).toContain('19/11/2026');
    expect(send.mock.calls[0][0].html).toContain('https://hub.io/completar-cadastro');
    expect(integration.adminUpdateUserFields).toHaveBeenCalledWith('10', {
      age_review_status: 'dob_requested', age_review_requested_at: now.toISOString(),
    });
    expect(integration.createEmailDelivery).toHaveBeenCalledWith(expect.objectContaining({
      key: 'age-review:dob:10:2026-11-12', campaign_document_id: 'age-review-dob',
    }));
  });

  it('stops at the e-mails left today; the rest waits for another day', async () => {
    const integration = makeIntegration({ users, sentToday: 69 });
    const out = await requestDateOfBirth({ integration, userIds: ['10', '14'], actor: ADMIN, env, now, send });
    expect(out.results.map((r) => r.outcome)).toEqual(['sent', 'quota']);
    expect(out.emailsLeftToday).toBe(0);
    expect(integration.adminUpdateUserFields).toHaveBeenCalledTimes(1);
  });

  it('does not start the 7 days when the e-mail fails', async () => {
    send.mockResolvedValue({ success: false, error: 'smtp' });
    const integration = makeIntegration({ users });
    const out = await requestDateOfBirth({ integration, userIds: ['10'], actor: ADMIN, env, now, send });
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(integration.adminUpdateUserFields).not.toHaveBeenCalled();
  });

  it('sends the complete-profile link (login by code) even to a never-logged-in account (REA-26)', async () => {
    const integration = makeIntegration({ users, pending: ['ana@x.io'] });
    await requestDateOfBirth({ integration, userIds: ['10'], actor: ADMIN, env, now, send });
    const { html } = send.mock.calls[0][0];
    expect(html).toContain('https://hub.io/completar-cadastro');
    expect(html).not.toContain('criar-senha');
    expect(html).toContain('código de acesso');
    expect(integration.accountSetup).not.toHaveBeenCalled();
  });

  it('honors the redirect address of tests and staging', async () => {
    const integration = makeIntegration({ users });
    await requestDateOfBirth({ integration, userIds: ['10'], actor: ADMIN, env: { ...env, EMAIL_CAMPAIGN_REDIRECT_TO: 'qa@hub.io' }, now, send });
    expect(send.mock.calls[0][0]).toMatchObject({ to: 'qa@hub.io' });
  });

  it('refuses empty, invalid or too many ids', async () => {
    const integration = makeIntegration();
    await expect(requestDateOfBirth({ integration, userIds: [], env, now, send })).rejects.toThrow('Selecione ao menos um usuário.');
    await expect(requestDateOfBirth({ integration, userIds: ['a'], env, now, send })).rejects.toThrow('Usuário inválido.');
    const many = Array.from({ length: 51 }, (_, i) => String(i + 1));
    await expect(requestDateOfBirth({ integration, userIds: many, env, now, send })).rejects.toThrow('no máximo 50');
  });
});

describe('blockMinor', () => {
  const minor = { id: 20, email: 'teen@x.io', name: 'Teen', date_of_birth: '2010-05-05' };

  it('deactivates the account and e-mails the reason', async () => {
    const integration = makeIntegration({ users: { 20: minor } });
    const out = await blockMinor({ integration, userId: '20', actor: ADMIN, env, now, send });
    expect(integration.adminUpdateUserFields).toHaveBeenCalledWith('20', {
      blocked: true, age_review_status: 'minor_blocked', age_review_blocked_at: now.toISOString(),
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'teen@x.io', subject: 'Sua conta no Hub Community foi desativada' }));
    expect(out).toMatchObject({ emailSent: true, message: 'Conta desativada. E-mail com o motivo enviado.' });
    expect(out.user).toMatchObject({ blocked: true, status: 'minor_blocked' });
  });

  it('only re-sends the e-mail for an account already deactivated as a minor', async () => {
    const integration = makeIntegration({ users: { 20: { ...minor, blocked: true, age_review_status: 'minor_blocked' } } });
    const out = await blockMinor({ integration, userId: '20', actor: ADMIN, env, now, send });
    expect(integration.adminUpdateUserFields).not.toHaveBeenCalled();
    expect(out.message).toBe('A conta já estava desativada. E-mail com o motivo enviado.');
  });

  it('still deactivates when there is no e-mail left today, and says so', async () => {
    const integration = makeIntegration({ users: { 20: minor }, sentToday: 70 });
    const out = await blockMinor({ integration, userId: '20', actor: ADMIN, env, now, send });
    expect(integration.adminUpdateUserFields).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(out.emailSent).toBe(false);
  });

  it('refuses an adult, an account without a date and the admin themself', async () => {
    const integration = makeIntegration({ users: { 21: { id: 21, date_of_birth: '1990-01-01' }, 22: { id: 22, date_of_birth: null } } });
    await expect(blockMinor({ integration, userId: '21', actor: ADMIN, env, now, send })).rejects.toThrow('não é de menor');
    await expect(blockMinor({ integration, userId: '22', actor: ADMIN, env, now, send })).rejects.toThrow('não é de menor');
    await expect(blockMinor({ integration, userId: '1', actor: ADMIN, env, now, send })).rejects.toThrow('sua própria conta');
    expect(integration.adminUpdateUserFields).not.toHaveBeenCalled();
  });
});
