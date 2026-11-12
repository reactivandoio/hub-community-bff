import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRateLimiter } from '../../utils/rate-limit';
import { RESEND_SECONDS, linkSpeaker, requestLoginCode, verifyLoginCode } from './index';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const freshLimits = () => ({
  request: createRateLimiter({ limit: 20, windowMs: 60000 }),
  verify: createRateLimiter({ limit: 30, windowMs: 60000 }),
});

const makeDataSources = ({ request, verify } = {}) => ({
  managerIntegration: {
    requestLoginCode: vi.fn().mockResolvedValue(request ?? { status: 'sent', code: '012345', expiresAt: 'x' }),
    verifyLoginCode: vi.fn().mockResolvedValue(verify ?? { status: 'ok', jwt: 'jwt1', created: false, user: { id: 7, documentId: 'u7', email: 'ana@x.io' } }),
    findSpeakers: vi.fn().mockResolvedValue({ data: [] }),
    updateSpeaker: vi.fn().mockResolvedValue({}),
    createSpeaker: vi.fn().mockResolvedValue({}),
  },
});

const rejection = (promise) => promise.then(() => null, (e) => e);

describe('requestLoginCode (REA-26)', () => {
  it('e-mails the code as a transactional "login-code" e-mail', async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    const ds = makeDataSources();

    const out = await requestLoginCode({ dataSources: ds, email: ' Ana@X.io ', clientIp: '1.1.1.1', limiters: freshLimits(), send });

    expect(out).toEqual({ sent: true, resendIn: RESEND_SECONDS });
    expect(ds.managerIntegration.requestLoginCode).toHaveBeenCalledWith('ana@x.io');
    const mail = send.mock.calls[0][0];
    expect(mail).toMatchObject({ kind: 'login-code', to: 'ana@x.io' });
    expect(mail.subject).toContain('012345');
    expect(mail.html).toContain('012345');
  });

  it('refuses an invalid e-mail before calling the backend', async () => {
    const ds = makeDataSources();
    const err = await rejection(requestLoginCode({ dataSources: ds, email: 'ana', limiters: freshLimits(), send: vi.fn() }));
    expect(err.extensions.code).toBe('BAD_USER_INPUT');
    expect(ds.managerIntegration.requestLoginCode).not.toHaveBeenCalled();
  });

  it('tells the person when Mailgun refuses the e-mail, and logs it', async () => {
    const send = vi.fn().mockResolvedValue({ success: false, error: '421 daily limit' });
    const err = await rejection(requestLoginCode({ dataSources: makeDataSources(), email: 'ana@x.io', limiters: freshLimits(), send }));
    expect(err.extensions).toMatchObject({ code: 'LOGIN_CODE_NOT_SENT', retryAfter: RESEND_SECONDS });
    expect(err.message).toMatch(/Não conseguimos enviar o código/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[login-code] envio recusado'));
    expect(console.error.mock.calls[0][0]).not.toContain('ana@x.io');
  });

  it('passes on the cooldown with the seconds left', async () => {
    const ds = makeDataSources({ request: { status: 'cooldown', retryAfter: 42 } });
    const send = vi.fn();
    const err = await rejection(requestLoginCode({ dataSources: ds, email: 'ana@x.io', limiters: freshLimits(), send }));
    expect(err.extensions).toMatchObject({ code: 'LOGIN_CODE_COOLDOWN', retryAfter: 42 });
    expect(send).not.toHaveBeenCalled();
  });

  it('passes on the daily limit of the e-mail', async () => {
    const ds = makeDataSources({ request: { status: 'limit' } });
    const err = await rejection(requestLoginCode({ dataSources: ds, email: 'ana@x.io', limiters: freshLimits(), send: vi.fn() }));
    expect(err.extensions.code).toBe('LOGIN_CODE_LIMIT');
  });

  it('answers a blocked account like any other, without sending anything', async () => {
    const ds = makeDataSources({ request: { status: 'blocked' } });
    const send = vi.fn();
    const out = await requestLoginCode({ dataSources: ds, email: 'ana@x.io', limiters: freshLimits(), send });
    expect(out).toEqual({ sent: true, resendIn: RESEND_SECONDS });
    expect(send).not.toHaveBeenCalled();
  });

  it('limits requests per IP', async () => {
    const limiters = { ...freshLimits(), request: createRateLimiter({ limit: 1, windowMs: 60000 }) };
    const send = vi.fn().mockResolvedValue({ success: true });
    await requestLoginCode({ dataSources: makeDataSources(), email: 'ana@x.io', clientIp: '9.9.9.9', limiters, send });
    const err = await rejection(requestLoginCode({ dataSources: makeDataSources(), email: 'bia@x.io', clientIp: '9.9.9.9', limiters, send }));
    expect(err.extensions.code).toBe('RATE_LIMITED');
  });
});

describe('verifyLoginCode (REA-26)', () => {
  it('returns the user with the session token', async () => {
    const ds = makeDataSources();
    const user = await verifyLoginCode({ dataSources: ds, email: 'Ana@x.io', code: '012345', limiters: freshLimits() });
    expect(user).toEqual({ id: 7, documentId: 'u7', email: 'ana@x.io', token: 'jwt1' });
    expect(ds.managerIntegration.verifyLoginCode).toHaveBeenCalledWith('ana@x.io', '012345');
    expect(ds.managerIntegration.findSpeakers).not.toHaveBeenCalled();
  });

  it('links a speaker to an account just created', async () => {
    const ds = makeDataSources({ verify: { status: 'ok', jwt: 'j', created: true, user: { id: 8, documentId: 'u8', email: 'nova@x.io' } } });
    await verifyLoginCode({ dataSources: ds, email: 'nova@x.io', code: '012345', limiters: freshLimits() });
    expect(ds.managerIntegration.createSpeaker).toHaveBeenCalledWith({
      email: 'nova@x.io', users_permissions_user: { set: ['u8'] },
    });
  });

  it('tells how many tries are left on a wrong code', async () => {
    const ds = makeDataSources({ verify: { status: 'invalid', attemptsLeft: 3 } });
    const err = await rejection(verifyLoginCode({ dataSources: ds, email: 'ana@x.io', code: '1', limiters: freshLimits() }));
    expect(err.extensions).toMatchObject({ code: 'LOGIN_CODE_INVALID', attemptsLeft: 3 });
    expect(err.message).toContain('3 tentativas');
  });

  it('asks for a new code after the last wrong try', async () => {
    const ds = makeDataSources({ verify: { status: 'invalid', attemptsLeft: 0 } });
    const err = await rejection(verifyLoginCode({ dataSources: ds, email: 'ana@x.io', code: '1', limiters: freshLimits() }));
    expect(err.extensions.code).toBe('LOGIN_CODE_EXPIRED');
  });

  it('refuses an expired code', async () => {
    const ds = makeDataSources({ verify: { status: 'expired' } });
    const err = await rejection(verifyLoginCode({ dataSources: ds, email: 'ana@x.io', code: '012345', limiters: freshLimits() }));
    expect(err.extensions.code).toBe('LOGIN_CODE_EXPIRED');
  });

  it('refuses a blocked account', async () => {
    const ds = makeDataSources({ verify: { status: 'blocked' } });
    const err = await rejection(verifyLoginCode({ dataSources: ds, email: 'ana@x.io', code: '012345', limiters: freshLimits() }));
    expect(err.extensions.code).toBe('ACCOUNT_BLOCKED');
  });

  it('limits tries per IP', async () => {
    const limiters = { ...freshLimits(), verify: createRateLimiter({ limit: 1, windowMs: 60000 }) };
    await verifyLoginCode({ dataSources: makeDataSources(), email: 'ana@x.io', code: '012345', clientIp: 'ip', limiters });
    const err = await rejection(verifyLoginCode({ dataSources: makeDataSources(), email: 'ana@x.io', code: '012345', clientIp: 'ip', limiters }));
    expect(err.extensions.code).toBe('RATE_LIMITED');
  });
});

describe('linkSpeaker', () => {
  it('takes over the speaker that already has the e-mail', async () => {
    const ds = makeDataSources();
    ds.managerIntegration.findSpeakers.mockResolvedValue({ data: [{ documentId: 'sp1' }] });
    await linkSpeaker(ds, { documentId: 'u8', email: 'nova@x.io' });
    expect(ds.managerIntegration.updateSpeaker).toHaveBeenCalledWith('sp1', { users_permissions_user: { set: ['u8'] } });
    expect(ds.managerIntegration.createSpeaker).not.toHaveBeenCalled();
  });

  it('never fails the login', async () => {
    const ds = makeDataSources();
    ds.managerIntegration.findSpeakers.mockRejectedValue(new Error('down'));
    await expect(linkSpeaker(ds, { documentId: 'u8', email: 'nova@x.io' })).resolves.toBeUndefined();
  });
});
