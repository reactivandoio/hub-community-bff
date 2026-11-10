import { describe, it, expect } from 'vitest';
import { normalizeEmail, readUnsubscribeToken, shareRef, unsubscribeToken } from './token';

const env = { EMAIL_UNSUBSCRIBE_SECRET: 's3cret' };

describe('unsubscribe token', () => {
  it('round-trips the e-mail, normalized', () => {
    const token = unsubscribeToken('  Ana@X.io ', env);
    expect(readUnsubscribeToken(token, env)).toBe('ana@x.io');
    expect(token).toBe(unsubscribeToken('ana@x.io', env));
  });

  it('refuses a tampered, foreign or empty token', () => {
    const token = unsubscribeToken('ana@x.io', env);
    const other = unsubscribeToken('bia@x.io', env);
    const forged = `${other.split('.')[0]}.${token.split('.')[1]}`;
    expect(readUnsubscribeToken(forged, env)).toBeNull();
    expect(readUnsubscribeToken(token, { EMAIL_UNSUBSCRIBE_SECRET: 'other' })).toBeNull();
    expect(readUnsubscribeToken('', env)).toBeNull();
    expect(readUnsubscribeToken('abc', env)).toBeNull();
    expect(readUnsubscribeToken(null, env)).toBeNull();
  });

  it('needs a secret', () => {
    expect(() => unsubscribeToken('ana@x.io', {})).toThrow(/EMAIL_UNSUBSCRIBE_SECRET/);
    expect(readUnsubscribeToken('a.b', {})).toBeNull();
  });
});

describe('shareRef', () => {
  it('is short, url-safe, stable per person and event', () => {
    const ref = shareRef('Ana@x.io', 'meetup', env);
    expect(ref).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(shareRef('ana@x.io', 'meetup', env)).toBe(ref);
    expect(shareRef('ana@x.io', 'other', env)).not.toBe(ref);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail(' A@B.io ')).toBe('a@b.io');
    expect(normalizeEmail(null)).toBe('');
  });
});
