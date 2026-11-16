import {
  dailyLimit, dailyReserve, monthlyLimit, remainingToday, startOfDaySaoPaulo,
} from '../email-campaign/quota';

// REA-59: what the campaign queue still has to send and when. The queue (email-campaign/sender)
// sends, every minute, what today's quota allows, oldest campaign first; this replays that day by
// day: today gets what is left of today (remainingToday), each next day the daily share
// (EMAIL_DAILY_LIMIT - EMAIL_DAILY_RESERVE) without passing the month's (EMAIL_MONTHLY_LIMIT -
// reserve). A forecast: future transactional e-mails eat into the reserve, not the campaigns' share,
// so it holds unless a day goes past its reserve. Paused campaigns are not scheduled.

export const MAX_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "2026-11-16" — the São Paulo calendar day of an instant. */
export const ymdSaoPaulo = (date) => new Date(date.getTime() - SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);

const monthOf = (date) => ymdSaoPaulo(date).slice(0, 7);

/** What a campaign still has to send (its total is approximate for an invite). */
export const remainingOf = (campaign) =>
  Math.max(0, (Number(campaign.total) || 0) - (Number(campaign.sent) || 0) - (Number(campaign.failed) || 0));

/**
 * @param {object} p
 * @param {Array} p.campaigns queued campaigns, oldest first ({ id, status, total, sent, failed })
 * @returns {{ schedule: Array<{ date, count, campaigns: Array<{ id, count }> }>,
 *   finishes: Map<string, string|null>, truncated: boolean }}
 */
export const forecastQueue = ({
  campaigns, sentToday = 0, sentThisMonth = 0, env = process.env, now = new Date(), enabled = true,
}) => {
  const queue = (campaigns || [])
    .filter((c) => c.status === 'sending')
    .map((c) => ({ id: c.id, left: remainingOf(c) }))
    .filter((c) => c.left > 0);
  const finishes = new Map((campaigns || []).map((c) => [c.id, null]));
  const schedule = [];
  if (!enabled || queue.length === 0) return { schedule, finishes, truncated: false };

  const perDay = dailyLimit(env);
  const month = monthlyLimit(env);
  const reserve = dailyReserve(env);
  let day = startOfDaySaoPaulo(now);
  let usedThisMonth = sentThisMonth || 0;
  let currentMonth = monthOf(day);

  for (let i = 0; i < MAX_DAYS && queue.length > 0; i += 1) {
    if (monthOf(day) !== currentMonth) {
      currentMonth = monthOf(day);
      usedThisMonth = 0;
    }
    const capacity = i === 0
      ? remainingToday({ sentToday, sentThisMonth: usedThisMonth, env })
      : Math.max(0, Math.min(perDay, month === null ? Infinity : month - reserve - usedThisMonth));

    let left = capacity;
    const parts = [];
    while (left > 0 && queue.length > 0) {
      const head = queue[0];
      const count = Math.min(left, head.left);
      head.left -= count;
      left -= count;
      parts.push({ id: head.id, count });
      if (head.left === 0) {
        finishes.set(head.id, ymdSaoPaulo(day));
        queue.shift();
      }
    }
    const count = capacity - left;
    if (count > 0) schedule.push({ date: ymdSaoPaulo(day), count, campaigns: parts });
    usedThisMonth += count;
    day = new Date(day.getTime() + DAY_MS);
  }
  return { schedule, finishes, truncated: queue.length > 0 };
};
