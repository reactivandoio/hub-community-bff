// REA-29: the Mailgun account (free plan: 100 e-mails a day) is shared with the transactional
// e-mails (signup confirmation, certificates…), so campaigns use at most EMAIL_CAMPAIGN_DAILY_LIMIT
// a day, all campaigns together, and continue the next day.

export const DEFAULT_DAILY_LIMIT = 70;

export const dailyLimit = (env = process.env) => {
  const value = parseInt(env.EMAIL_CAMPAIGN_DAILY_LIMIT, 10);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_LIMIT;
};

export const remainingToday = ({ sentToday, env = process.env }) =>
  Math.max(0, dailyLimit(env) - (sentToday || 0));

// Brazil has had no daylight saving time since 2019: the day starts at 03:00 UTC.
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

export const startOfDaySaoPaulo = (now = new Date()) => {
  const local = new Date(now.getTime() - SAO_PAULO_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + SAO_PAULO_OFFSET_MS);
};

export const estimatedDays = (total, env = process.env) => {
  const limit = dailyLimit(env);
  if (!total) return 0;
  return limit > 0 ? Math.ceil(total / limit) : null;
};
