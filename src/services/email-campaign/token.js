import crypto from 'crypto';

// REA-29: the unsubscribe link of every campaign e-mail carries the e-mail itself, signed, so
// nobody can unsubscribe somebody else and no lookup table is needed:
// base64url(email) + "." + base64url(hmacSha256(EMAIL_UNSUBSCRIBE_SECRET, email)).

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const secretOf = (env) => env.EMAIL_UNSUBSCRIBE_SECRET || '';

const sign = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

export const unsubscribeToken = (email, env = process.env) => {
  const secret = secretOf(env);
  if (!secret) throw new Error('EMAIL_UNSUBSCRIBE_SECRET is not set');
  const value = normalizeEmail(email);
  return `${Buffer.from(value).toString('base64url')}.${sign(value, secret)}`;
};

/** The e-mail of a valid token, or null. */
export const readUnsubscribeToken = (token, env = process.env) => {
  const secret = secretOf(env);
  if (!secret || typeof token !== 'string') return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const email = normalizeEmail(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!email.includes('@')) return null;
  const expected = Buffer.from(sign(email, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return email;
};

/** The `?ref=` of a signup's share link: who invited, without showing the e-mail. */
export const shareRef = (email, eventSlug, env = process.env) =>
  sign(`share:${eventSlug}:${normalizeEmail(email)}`, secretOf(env) || 'share').slice(0, 10);
