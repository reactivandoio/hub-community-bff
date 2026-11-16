import crypto from 'crypto';

// REA-51: the personal termhub token of an admin user is stored in hub-community-backend only as
// ciphertext. The key (TERMHUB_TOKEN_KEY, 32 bytes in base64 or hex) exists only here, so a copy of
// the database does not open it. AES-256-GCM, bound to the user id (AAD): a ciphertext copied to
// another user's row does not decrypt. The token itself never goes back to the frontend nor to a log.

const VERSION = 'v1';

export class TermhubKeyError extends Error {}

const keyFrom = (env = process.env) => {
  const raw = String(env.TERMHUB_TOKEN_KEY || '').trim();
  if (!raw) throw new TermhubKeyError('TERMHUB_TOKEN_KEY não está definida no servidor.');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new TermhubKeyError('TERMHUB_TOKEN_KEY precisa ter 32 bytes (base64 ou hex).');
  return key;
};

export const hasTokenKey = (env = process.env) => {
  try {
    keyFrom(env);
    return true;
  } catch {
    return false;
  }
};

const aad = (userId) => Buffer.from(`termhub-token:${userId}`);

export const encryptToken = (token, userId, env = process.env) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(env), iv);
  cipher.setAAD(aad(userId));
  const data = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
};

/** Throws when the ciphertext is not of this key and user (key rotated, row tampered). */
export const decryptToken = (ciphertext, userId, env = process.env) => {
  const [version, iv, tag, data] = String(ciphertext || '').split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new TermhubKeyError('Token salvo em formato desconhecido.');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(env), Buffer.from(iv, 'base64'));
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof TermhubKeyError) throw err;
    throw new TermhubKeyError('Não foi possível abrir o token salvo (a chave do servidor mudou?). Cadastre o token de novo.');
  }
};

/** What the screen shows of a saved token: its last 4 characters. */
export const tokenHint = (token) => {
  const t = String(token || '');
  return t.length > 8 ? `…${t.slice(-4)}` : '…';
};
