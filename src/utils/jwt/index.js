import jsonwebtoken from 'jsonwebtoken';

let warnedMissingSecret = false;

const stripBearer = (authorization) =>
  String(authorization || '').replace(/^Bearer\s+/i, '').trim();

// Checks the signature of a Strapi users-permissions JWT with the same secret the
// backend signs it with (JWT_SECRET). Returns the payload ({ id, iat, exp }) or null:
// a missing, malformed, forged or expired token is simply an anonymous request.
const verify = (authorization) => {
  const token = stripBearer(authorization);
  if (!token) return null;

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (!warnedMissingSecret) {
      // eslint-disable-next-line no-console
      console.error('[auth] JWT_SECRET não configurado: todos os tokens serão tratados como anônimos.');
      warnedMissingSecret = true;
    }
    return null;
  }

  try {
    const payload = jsonwebtoken.verify(token, secret, { algorithms: ['HS256'] });
    return payload && payload.id ? payload : null;
  } catch (_) {
    return null;
  }
};

const jwt = {
  stripBearer,
  verify,
};

export default jwt;
