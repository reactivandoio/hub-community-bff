import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, hasTokenKey, tokenHint } from './crypto';

const env = { TERMHUB_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') };
const TOKEN = 'thp_secret_token_value_1234';

describe('termhub token crypto', () => {
  it('round-trips for the same user, and the ciphertext does not contain the token', () => {
    const c = encryptToken(TOKEN, 42, env);
    expect(c).not.toContain(TOKEN);
    expect(c.startsWith('v1:')).toBe(true);
    expect(decryptToken(c, 42, env)).toBe(TOKEN);
  });

  it('uses a new IV each time', () => {
    expect(encryptToken(TOKEN, 42, env)).not.toBe(encryptToken(TOKEN, 42, env));
  });

  it('does not decrypt for another user (bound by AAD) nor with another key', () => {
    const c = encryptToken(TOKEN, 42, env);
    expect(() => decryptToken(c, 43, env)).toThrow(/Cadastre o token/);
    const other = { TERMHUB_TOKEN_KEY: Buffer.alloc(32, 8).toString('hex') };
    expect(() => decryptToken(c, 42, other)).toThrow(/Cadastre o token/);
  });

  it('never puts the token in an error message', () => {
    const c = encryptToken(TOKEN, 42, env);
    try { decryptToken(c, 1, env); } catch (err) { expect(err.message).not.toContain(TOKEN); }
  });

  it('requires a 32-byte key (base64 or hex)', () => {
    expect(hasTokenKey(env)).toBe(true);
    expect(hasTokenKey({ TERMHUB_TOKEN_KEY: Buffer.alloc(32).toString('hex') })).toBe(true);
    expect(hasTokenKey({})).toBe(false);
    expect(hasTokenKey({ TERMHUB_TOKEN_KEY: 'short' })).toBe(false);
    expect(() => encryptToken(TOKEN, 1, {})).toThrow(/TERMHUB_TOKEN_KEY/);
  });

  it('shows only the last 4 characters', () => {
    expect(tokenHint(TOKEN)).toBe('…1234');
    expect(tokenHint('short')).toBe('…');
  });
});
