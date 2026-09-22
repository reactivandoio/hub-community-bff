import { describe, it, expect } from 'vitest';
import { signupOrigin, eventDays, checkinMetrics } from './index';

const signup = (overrides = {}) => ({
  name: 'Ana',
  createdAt: '2026-09-20T15:00:00.000Z',
  checked_in: false,
  checked_in_at: null,
  payment: { payment_identification: 'pay_123' },
  ...overrides,
});

describe('signupOrigin', () => {
  it('tells the spreadsheet import and the admin manual signup from the site', () => {
    expect(signupOrigin(signup({ payment: { payment_identification: 'IMPORT_1_ab' } }))).toBe('IMPORT');
    expect(signupOrigin(signup({ payment: { payment_identification: 'MANUAL_1_ab' } }))).toBe('MANUAL');
    expect(signupOrigin(signup())).toBe('SITE');
    expect(signupOrigin(signup({ payment: null }))).toBe('SITE');
  });
});

describe('eventDays', () => {
  it('lists every São Paulo calendar day from start to end', () => {
    // 23:00 in São Paulo on the 25th is already the 26th in UTC.
    expect(eventDays('2026-09-26T02:00:00.000Z', '2026-09-27T01:00:00.000Z')).toEqual([
      '2026-09-25',
      '2026-09-26',
    ]);
  });

  it('is a single day without an end, and empty without a start', () => {
    expect(eventDays('2026-09-25T12:00:00.000Z', null)).toEqual(['2026-09-25']);
    expect(eventDays(null, null)).toEqual([]);
  });
});

describe('checkinMetrics', () => {
  const days = ['2026-09-25'];

  it('counts check-ins and the attendance rate', () => {
    const m = checkinMetrics(
      [
        signup({ checked_in: true, checked_in_at: '2026-09-25T22:10:00.000Z' }),
        signup({ checked_in: true, checked_in_at: '2026-09-25T22:40:00.000Z' }),
        signup(),
      ],
      days,
    );

    expect(m.checked_in_count).toBe(2);
    expect(m.attendance_rate).toBe(66.67);
  });

  it('has no attendance rate without signups', () => {
    expect(checkinMetrics([], days).attendance_rate).toBeNull();
  });

  it('counts the signups made on the event day (São Paulo time), by origin', () => {
    const m = checkinMetrics(
      [
        signup({ createdAt: '2026-09-25T20:00:00.000Z' }),
        signup({ createdAt: '2026-09-25T21:00:00.000Z', payment: { payment_identification: 'MANUAL_x' } }),
        // 01:00 UTC on the 26th is still the 25th in São Paulo.
        signup({ createdAt: '2026-09-26T01:00:00.000Z' }),
        // The day before does not count.
        signup({ createdAt: '2026-09-24T20:00:00.000Z' }),
      ],
      days,
    );

    expect(m.day_of_signups).toBe(3);
    expect(m.day_of_signups_by_origin).toEqual([
      { origin: 'SITE', count: 2 },
      { origin: 'MANUAL', count: 1 },
      { origin: 'IMPORT', count: 0 },
    ]);
  });

  it('breaks signups and check-ins down by origin', () => {
    const m = checkinMetrics(
      [
        signup({ checked_in: true }),
        signup(),
        signup({ payment: { payment_identification: 'IMPORT_a' }, checked_in: true }),
      ],
      days,
    );

    expect(m.signups_by_origin).toEqual([
      { origin: 'SITE', total: 2, checked_in: 1 },
      { origin: 'MANUAL', total: 0, checked_in: 0 },
      { origin: 'IMPORT', total: 1, checked_in: 1 },
    ]);
  });

  it('groups check-ins by São Paulo hour, in order', () => {
    const m = checkinMetrics(
      [
        signup({ checked_in: true, checked_in_at: '2026-09-25T22:40:00.000Z' }),
        signup({ checked_in: true, checked_in_at: '2026-09-25T21:05:00.000Z' }),
        signup({ checked_in: true, checked_in_at: '2026-09-25T21:55:00.000Z' }),
        // Checked in but the device sent no time: counted, not on the chart.
        signup({ checked_in: true, checked_in_at: null }),
      ],
      days,
    );

    expect(m.checkins_timeline).toEqual([
      { date: '2026-09-25T18:00', count: 2 },
      { date: '2026-09-25T19:00', count: 1 },
    ]);
  });
});
