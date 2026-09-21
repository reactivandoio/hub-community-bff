// The date of birth the public request form sends: "YYYY-MM-DD", what an <input type="date">
// produces and what Strapi's `date` column stores. Pure — no I/O.

export const MIN_BIRTH_YEAR = 1900;

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The normalized "YYYY-MM-DD", or null when there is nothing usable: empty, malformed, not a
 * real calendar day (2026-02-31), in the future, or older than any living person.
 * The caller decides whether null means "not informed" or "invalid".
 */
export const normalizeDateOfBirth = (value, now = new Date()) => {
  const raw = (value || '').trim();
  const match = PATTERN.exec(raw);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_BIRTH_YEAR) return null;

  // Date.UTC rolls 2026-02-31 over into March, so a round-trip is what proves the day exists.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  if (date.getTime() > now.getTime()) return null;

  return raw;
};
