import crypto from 'crypto';

// Opa-Signature: t=<unix s>,v1=<hex>[,v1=<hex>…]
// v1 = HMAC-SHA256(secret, "<t>.<raw body>") in lowercase hex. The raw body is the
// exact bytes received: any re-serialized JSON makes the signature fail.
export const verifyOpaSignature = ({ rawBody, header, secret, nowS, toleranceS = 300 }) => {
  if (!header || !secret) return { ok: false, reason: 'missing' };
  const parts = String(header).split(',').map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  });
  const rawT = parts.find(([k]) => k === 't')?.[1];
  const t = /^\d+$/.test(rawT || '') ? Number(rawT) : NaN;
  const v1s = parts.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/.test(v)).map(([, v]) => v);
  if (!Number.isSafeInteger(t) || v1s.length === 0) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowS - t) > toleranceS) return { ok: false, reason: 'stale' };
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  // Every candidate is compared (no early exit), each in constant time.
  const match = v1s.reduce(
    (acc, v) => crypto.timingSafeEqual(Buffer.from(v, 'hex'), expected) || acc,
    false,
  );
  return match ? { ok: true } : { ok: false, reason: 'mismatch' };
};

export default verifyOpaSignature;
