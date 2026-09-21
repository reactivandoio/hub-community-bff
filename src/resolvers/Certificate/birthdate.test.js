import { describe, it, expect } from 'vitest';
import { normalizeDateOfBirth } from './birthdate';

const NOW = new Date('2026-09-21T12:00:00.000Z');

describe('normalizeDateOfBirth', () => {
  it('keeps a real date, trimmed', () => {
    expect(normalizeDateOfBirth(' 1990-04-07 ', NOW)).toBe('1990-04-07');
  });

  it('is null when nothing was informed', () => {
    expect(normalizeDateOfBirth('', NOW)).toBeNull();
    expect(normalizeDateOfBirth(null, NOW)).toBeNull();
    expect(normalizeDateOfBirth(undefined, NOW)).toBeNull();
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(normalizeDateOfBirth('07/04/1990', NOW)).toBeNull();
    expect(normalizeDateOfBirth('1990-4-7', NOW)).toBeNull();
    expect(normalizeDateOfBirth('1990-04-07T00:00:00Z', NOW)).toBeNull();
  });

  it('rejects a day the calendar does not have', () => {
    expect(normalizeDateOfBirth('2026-02-31', NOW)).toBeNull();
    expect(normalizeDateOfBirth('1990-13-01', NOW)).toBeNull();
    expect(normalizeDateOfBirth('1990-00-10', NOW)).toBeNull();
  });

  it('accepts a leap day that exists and rejects one that does not', () => {
    expect(normalizeDateOfBirth('2000-02-29', NOW)).toBe('2000-02-29');
    expect(normalizeDateOfBirth('1900-02-29', NOW)).toBeNull();
  });

  it('rejects the future and anything before 1900', () => {
    expect(normalizeDateOfBirth('2026-09-22', NOW)).toBeNull();
    expect(normalizeDateOfBirth('2026-09-21', NOW)).toBe('2026-09-21');
    expect(normalizeDateOfBirth('1899-12-31', NOW)).toBeNull();
  });
});
