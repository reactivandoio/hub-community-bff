import { describe, it, expect } from 'vitest';
import { dailyLimit, estimatedDays, remainingToday, startOfDaySaoPaulo } from './quota';

describe('quota', () => {
  it('uses 70 a day by default (Mailgun free = 100, the rest is for transactional e-mails)', () => {
    expect(dailyLimit({})).toBe(70);
    expect(dailyLimit({ EMAIL_CAMPAIGN_DAILY_LIMIT: '40' })).toBe(40);
    expect(dailyLimit({ EMAIL_CAMPAIGN_DAILY_LIMIT: 'x' })).toBe(70);
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
