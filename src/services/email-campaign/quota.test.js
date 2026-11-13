import { describe, it, expect } from 'vitest';
import {
  dailyLimit, dailyReserve, estimatedDays, remainingToday, startOfDaySaoPaulo, totalDailyLimit,
} from './quota';

describe('quota', () => {
  it('defaults to the Mailgun free plan: 100 a day, 30 kept for codes and transactional e-mails', () => {
    expect(totalDailyLimit({})).toBe(100);
    expect(dailyReserve({})).toBe(30);
    expect(dailyLimit({})).toBe(70);
  });

  it('reads the plan and the reserve from the environment (REA-26)', () => {
    const env = { EMAIL_DAILY_LIMIT: '1000', EMAIL_DAILY_RESERVE: '200' };
    expect(totalDailyLimit(env)).toBe(1000);
    expect(dailyReserve(env)).toBe(200);
    expect(dailyLimit(env)).toBe(800);
    expect(dailyLimit({ EMAIL_DAILY_LIMIT: 'x', EMAIL_DAILY_RESERVE: '-1' })).toBe(70);
  });

  it('leaves nothing to campaigns when the reserve takes the whole plan', () => {
    expect(dailyLimit({ EMAIL_DAILY_LIMIT: '50', EMAIL_DAILY_RESERVE: '80' })).toBe(0);
    expect(remainingToday({ sentToday: 0, env: { EMAIL_DAILY_LIMIT: '50', EMAIL_DAILY_RESERVE: '80' } })).toBe(0);
  });

  it('counts every e-mail of the day against the campaigns share', () => {
    // 25 transactional + 40 campaign e-mails already sent: 70 - 65 = 5 left for campaigns.
    expect(remainingToday({ sentToday: 65, env: {} })).toBe(5);
  });

  it('ignores the old EMAIL_CAMPAIGN_DAILY_LIMIT', () => {
    expect(dailyLimit({ EMAIL_CAMPAIGN_DAILY_LIMIT: '10' })).toBe(70);
  });

  it('never goes below zero', () => {
    expect(remainingToday({ sentToday: 10, env: {} })).toBe(60);
    expect(remainingToday({ sentToday: 90, env: {} })).toBe(0);
  });

  it('counts the day in America/Sao_Paulo', () => {
    expect(startOfDaySaoPaulo(new Date('2026-11-10T12:00:00Z')).toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(startOfDaySaoPaulo(new Date('2026-11-10T02:00:00Z')).toISOString()).toBe('2026-11-09T03:00:00.000Z');
  });

  it('estimates the days a campaign takes', () => {
    expect(estimatedDays(0, {})).toBe(0);
    expect(estimatedDays(70, {})).toBe(1);
    expect(estimatedDays(71, {})).toBe(2);
  });
});
