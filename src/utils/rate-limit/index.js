// REA-22: in-memory fixed-window limiter. The BFF runs as a single pm2 process, so
// memory is enough; a restart only resets the counters. Keys are hashed by the
// caller when they carry personal data (see guest-signup).

export const createRateLimiter = ({ limit, windowMs, now = () => Date.now(), maxKeys = 50000 }) => {
  const hits = new Map(); // key → { count, resetAt }

  const sweep = (at) => {
    hits.forEach((entry, key) => {
      if (entry.resetAt <= at) hits.delete(key);
    });
  };

  /** Counts one attempt; false once the key went past `limit` in the window. */
  const hit = (key) => {
    const at = now();
    if (hits.size >= maxKeys) sweep(at);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= at) {
      hits.set(key, { count: 1, resetAt: at + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };

  return { hit, size: () => hits.size, reset: () => hits.clear() };
};

export default createRateLimiter;
