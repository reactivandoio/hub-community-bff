import { describe, it, expect } from 'vitest';
import {
  normalizeIdentifier,
  isValidCpf,
  hasEventEnded,
  selfRequestStatus,
  SELF_REQUEST_MESSAGES,
  findAttendanceForIdentifier,
} from './eligibility';

const NOW = new Date('2026-09-11T12:00:00Z');

describe('isValidCpf', () => {
  it('accepts a valid cpf with or without mask', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });
  it('rejects wrong check digits, repeated digits and wrong length', () => {
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });
});

describe('hasEventEnded', () => {
  it('is true when end_date is in the past', () => {
    expect(hasEventEnded({ end_date: '2026-09-10T00:00:00Z' }, NOW)).toBe(true);
  });
  it('is false when end_date is in the future or missing', () => {
    expect(hasEventEnded({ end_date: '2026-09-12T00:00:00Z' }, NOW)).toBe(false);
    expect(hasEventEnded({}, NOW)).toBe(false);
  });
});

describe('selfRequestStatus', () => {
  const ended = { end_date: '2026-09-01T00:00:00Z' };
  it('ok when enabled, allowed and ended', () => {
    expect(selfRequestStatus({ enabled: true, allow_self_request: true }, ended, NOW)).toEqual({ ok: true });
  });
  it('DISABLED when config missing or disabled', () => {
    expect(selfRequestStatus(null, ended, NOW)).toEqual({
      ok: false, reason: 'DISABLED', message: SELF_REQUEST_MESSAGES.DISABLED,
    });
    expect(selfRequestStatus({ enabled: false, allow_self_request: true }, ended, NOW).reason).toBe('DISABLED');
  });
  it('NOT_ALLOWED when self request is off', () => {
    expect(selfRequestStatus({ enabled: true, allow_self_request: false }, ended, NOW).reason).toBe('NOT_ALLOWED');
  });
  it('NOT_ENDED when event still running', () => {
    const running = { end_date: '2026-09-30T00:00:00Z' };
    expect(selfRequestStatus({ enabled: true, allow_self_request: true }, running, NOW).reason).toBe('NOT_ENDED');
  });
});

describe('findAttendanceForIdentifier', () => {
  const attendances = [
    { documentId: 'a1', users_permissions_user: { documentId: 'u1', cpf: '529.982.247-25' } },
    { documentId: 'a2', users_permissions_user: null },
  ];
  it('matches by normalized cpf', () => {
    expect(findAttendanceForIdentifier(attendances, '52998224725').documentId).toBe('a1');
  });
  it('returns null when absent', () => {
    expect(findAttendanceForIdentifier(attendances, '00000000000')).toBeNull();
    expect(findAttendanceForIdentifier([], '52998224725')).toBeNull();
  });
});
