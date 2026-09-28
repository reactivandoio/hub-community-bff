import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jsonwebtoken from 'jsonwebtoken';
import jwt from './index';

const SECRET = 'test-secret';

describe('jwt.verify', () => {
  let previous;
  beforeEach(() => {
    previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.JWT_SECRET = previous;
  });

  it('returns the payload of a token signed with JWT_SECRET, with or without "Bearer"', () => {
    const token = jsonwebtoken.sign({ id: 7 }, SECRET, { expiresIn: '1h' });
    expect(jwt.verify(`Bearer ${token}`)).toMatchObject({ id: 7 });
    expect(jwt.verify(token)).toMatchObject({ id: 7 });
  });

  it('rejects a token signed with another secret (a forged one)', () => {
    const token = jsonwebtoken.sign({ id: 7 }, 'another-secret');
    expect(jwt.verify(`Bearer ${token}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = jsonwebtoken.sign({ id: 7, exp: Math.floor(Date.now() / 1000) - 60 }, SECRET);
    expect(jwt.verify(`Bearer ${token}`)).toBeNull();
  });

  it('rejects an unsigned token (alg none) even with a valid-looking payload', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 7 })).toString('base64url');
    expect(jwt.verify(`Bearer ${header}.${payload}.`)).toBeNull();
  });

  it('rejects garbage, empty values and a token without id', () => {
    expect(jwt.verify('Bearer not-a-token')).toBeNull();
    expect(jwt.verify('')).toBeNull();
    expect(jwt.verify(undefined)).toBeNull();
    expect(jwt.verify(jsonwebtoken.sign({ sub: 'x' }, SECRET))).toBeNull();
  });

  it('treats everything as anonymous when JWT_SECRET is not configured', () => {
    const token = jsonwebtoken.sign({ id: 7 }, SECRET);
    delete process.env.JWT_SECRET;
    expect(jwt.verify(`Bearer ${token}`)).toBeNull();
  });
});
