import { describe, it, expect } from 'vitest';
import { MAX_DAYS, forecastQueue, remainingOf, ymdSaoPaulo } from './forecast';

const env = { EMAIL_DAILY_LIMIT: '300', EMAIL_DAILY_RESERVE: '80', EMAIL_MONTHLY_LIMIT: '3000' };
const NOW = new Date('2026-11-16T15:00:00Z'); // 12:00 in São Paulo
const c = (id, total, extra = {}) => ({ id, status: 'sending', total, sent: 0, failed: 0, ...extra });

describe('forecastQueue (REA-59)', () => {
  it('today gets what is left of today, the next days the daily share (300 - 80)', () => {
    const { schedule, finishes, truncated } = forecastQueue({
      campaigns: [c('a', 500)], sentToday: 250, sentThisMonth: 1000, env, now: NOW,
    });
    // today: 220 - 250 already sent → 0, so it starts tomorrow: 220, 220, 60.
    expect(schedule).toEqual([
      { date: '2026-11-17', count: 220, campaigns: [{ id: 'a', count: 220 }] },
      { date: '2026-11-18', count: 220, campaigns: [{ id: 'a', count: 220 }] },
      { date: '2026-11-19', count: 60, campaigns: [{ id: 'a', count: 60 }] },
    ]);
    expect(finishes.get('a')).toBe('2026-11-19');
    expect(truncated).toBe(false);
  });

  it('sends the oldest campaign first, as the queue does', () => {
    const { schedule, finishes } = forecastQueue({
      campaigns: [c('old', 100, { sent: 20, failed: 10 }), c('new', 200)], sentToday: 0, sentThisMonth: 0, env, now: NOW,
    });
    expect(schedule[0]).toEqual({ date: '2026-11-16', count: 220, campaigns: [{ id: 'old', count: 70 }, { id: 'new', count: 150 }] });
    expect(finishes.get('old')).toBe('2026-11-16');
    expect(finishes.get('new')).toBe('2026-11-17');
  });

  it('stops at the month limit minus the reserve and starts again on day 1', () => {
    const { schedule } = forecastQueue({
      campaigns: [c('a', 400)], sentToday: 0, sentThisMonth: 2800, env, now: new Date('2026-11-29T15:00:00Z'),
    });
    // 3000 - 80 - 2800 = 120 left in November, nothing on the 30th, the rest on 1 December.
    expect(schedule).toEqual([
      { date: '2026-11-29', count: 120, campaigns: [{ id: 'a', count: 120 }] },
      { date: '2026-12-01', count: 220, campaigns: [{ id: 'a', count: 220 }] },
      { date: '2026-12-02', count: 60, campaigns: [{ id: 'a', count: 60 }] },
    ]);
  });

  it('does not schedule paused campaigns, nor anything while the queue is off', () => {
    const paused = forecastQueue({ campaigns: [c('p', 100, { status: 'paused' })], env, now: NOW });
    expect(paused.schedule).toEqual([]);
    expect(paused.finishes.get('p')).toBeNull();
    const off = forecastQueue({ campaigns: [c('a', 100)], env, now: NOW, enabled: false });
    expect(off.schedule).toEqual([]);
  });

  it('says when the forecast does not reach the end', () => {
    const { schedule, truncated, finishes } = forecastQueue({
      campaigns: [c('huge', 1000000)], env: { EMAIL_DAILY_LIMIT: '100', EMAIL_DAILY_RESERVE: '30' }, now: NOW,
    });
    expect(schedule).toHaveLength(MAX_DAYS);
    expect(truncated).toBe(true);
    expect(finishes.get('huge')).toBeNull();
  });

  it('helpers', () => {
    expect(remainingOf({ total: 10, sent: 3, failed: 2 })).toBe(5);
    expect(remainingOf({ total: 5, sent: 9 })).toBe(0);
    expect(ymdSaoPaulo(new Date('2026-11-17T02:59:00Z'))).toBe('2026-11-16');
  });
});
