import { toCampaign } from '../../resolvers/EmailCampaign';
import { isEnabled } from '../email-campaign/sender';
import {
  monthlyLimit, dailyReserve, remainingToday, startOfDaySaoPaulo, startOfMonthSaoPaulo, totalDailyLimit,
} from '../email-campaign/quota';
import { KINDS, listAgeReview } from '../age-review';
import { forecastQueue, remainingOf } from './forecast';

// REA-59 (admin only — resolvers/Admin checks it): everything the Hub still has to e-mail on its own
// schedule. Campaigns in the queue of every event with the forecast, the days it takes, the
// date-of-birth requests still within their 7 days, and today's and this month's usage.

const DOB_PAGE_SIZE = 50;

export const loadEmailQueue = async ({ integration, env = process.env, now = new Date() }) => {
  const month = monthlyLimit(env);
  const [rows, sentToday, sentThisMonth, dobRequests] = await Promise.all([
    integration.findQueuedEmailCampaigns(),
    integration.countEmailDeliveriesSince(startOfDaySaoPaulo(now)),
    integration.countEmailDeliveriesSince(startOfMonthSaoPaulo(now)),
    listAgeReview({
      integration, kind: KINDS.NO_BIRTH_DATE, status: 'dob_requested', page: 1, pageSize: DOB_PAGE_SIZE, env, now,
    }).catch((err) => {
      console.error(`[EmailQueue] date of birth requests: ${err.message}`);
      return null;
    }),
  ]);

  const enabled = isEnabled(env);
  const campaigns = rows.map((row) => ({
    ...toCampaign(row),
    event_slug: row.event_slug || null,
    event_title: row.event_title || null,
    remaining: remainingOf(row),
  }));
  const { schedule, finishes, truncated } = forecastQueue({
    campaigns: campaigns.map((c) => ({ ...c, id: c.id })), sentToday, sentThisMonth, env, now, enabled,
  });

  return {
    sending_enabled: enabled,
    redirect_to: (env.EMAIL_CAMPAIGN_REDIRECT_TO || '').trim() || null,
    usage: {
      sent_today: sentToday,
      sent_this_month: sentThisMonth,
      daily_limit: totalDailyLimit(env),
      monthly_limit: month,
      reserve: dailyReserve(env),
      campaigns_left_today: remainingToday({ sentToday, sentThisMonth: month === null ? 0 : sentThisMonth, env }),
    },
    campaigns: campaigns.map((c) => ({ ...c, finish_date: finishes.get(c.id) || null })),
    schedule,
    schedule_truncated: truncated,
    dob_requests: dobRequests,
  };
};
