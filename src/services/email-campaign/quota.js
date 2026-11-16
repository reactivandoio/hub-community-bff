// The Mailgun account is shared by every e-mail the Hub sends. REA-26: login codes and the other
// transactional e-mails (signup confirmation, certificates…) come first and are never held back;
// campaigns and the admin's age-review e-mails only use what is left under
// EMAIL_DAILY_LIMIT - EMAIL_DAILY_RESERVE, counting every e-mail already sent today
// (each one is recorded as an `email-campaign-delivery`, see services/email). Both numbers come
// from the environment so a bigger Mailgun plan is only a config change; the defaults are the
// free plan (100 a day) with 30 kept for codes and transactional e-mails.
// REA-50: EMAIL_MONTHLY_LIMIT caps the month too (the Mailgun account is shared with other
// systems): campaigns and age-review e-mails also stop at EMAIL_MONTHLY_LIMIT - EMAIL_DAILY_RESERVE,
// counting every e-mail of the month. Login codes and transactional e-mails are never held back,
// not even past the monthly limit. Unset = no monthly limit.

export const DEFAULT_DAILY_LIMIT = 100;
export const DEFAULT_DAILY_RESERVE = 30;

const nonNegativeInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** Every e-mail of the day, all kinds together (the Mailgun plan). */
export const totalDailyLimit = (env = process.env) => nonNegativeInt(env.EMAIL_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);

/** Kept for login codes and transactional e-mails: campaigns never touch it. */
export const dailyReserve = (env = process.env) => nonNegativeInt(env.EMAIL_DAILY_RESERVE, DEFAULT_DAILY_RESERVE);

/** What campaigns and age-review e-mails may use in a day, at most. */
export const dailyLimit = (env = process.env) => Math.max(0, totalDailyLimit(env) - dailyReserve(env));

/** Every e-mail of the month, all kinds together; null when there is no monthly limit. */
export const monthlyLimit = (env = process.env) => {
  if (env.EMAIL_MONTHLY_LIMIT === undefined || String(env.EMAIL_MONTHLY_LIMIT).trim() === '') return null;
  const parsed = nonNegativeInt(env.EMAIL_MONTHLY_LIMIT, -1);
  return parsed >= 0 ? parsed : null;
};

/**
 * What campaigns and age-review e-mails may still send now. `sentToday` / `sentThisMonth` = every
 * e-mail sent today / this month (transactional included); the reserve is kept out of both limits.
 */
export const remainingToday = ({ sentToday, sentThisMonth = 0, env = process.env }) => {
  const today = dailyLimit(env) - (sentToday || 0);
  const month = monthlyLimit(env);
  const thisMonth = month === null ? Infinity : month - dailyReserve(env) - (sentThisMonth || 0);
  return Math.max(0, Math.min(today, thisMonth));
};

// Brazil has had no daylight saving time since 2019: the day starts at 03:00 UTC.
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

export const startOfDaySaoPaulo = (now = new Date()) => {
  const local = new Date(now.getTime() - SAO_PAULO_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + SAO_PAULO_OFFSET_MS);
};

export const startOfMonthSaoPaulo = (now = new Date()) => {
  const local = new Date(now.getTime() - SAO_PAULO_OFFSET_MS);
  local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + SAO_PAULO_OFFSET_MS);
};

/** Reads today's and this month's counts and answers what campaigns may send now. */
export const emailsLeftNow = async (integration, { env = process.env, now = new Date() } = {}) => {
  const month = monthlyLimit(env);
  const [sentToday, sentThisMonth] = await Promise.all([
    integration.countEmailDeliveriesSince(startOfDaySaoPaulo(now)),
    month === null ? 0 : integration.countEmailDeliveriesSince(startOfMonthSaoPaulo(now)),
  ]);
  return remainingToday({ sentToday, sentThisMonth, env });
};

export const estimatedDays = (total, env = process.env) => {
  const limit = dailyLimit(env);
  if (!total) return 0;
  return limit > 0 ? Math.ceil(total / limit) : null;
};
