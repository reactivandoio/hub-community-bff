import { describe, it, expect } from 'vitest';
import { effectiveStatus, holdsPlace, countsAsCouponUse } from './index';

const now = new Date('2026-10-11T12:00:00Z');
const past = '2026-10-11T11:59:00Z';
const future = '2026-10-11T12:10:00Z';

describe('effectiveStatus', () => {
  it('pendente vencido aparece como EXPIRED', () => {
    expect(effectiveStatus({ status: 'PEDING_PAYMENT', expires_at: past }, now)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'PEDING_PAYMENT', provider: 'opapingou', expires_at: past }, now)).toBe('EXPIRED');
    expect(effectiveStatus({ status: 'PEDING_PAYMENT', provider: 'opapingou', expires_at: future }, now)).toBe('PEDING_PAYMENT');
  });
  it('confirmado continua confirmado mesmo depois do prazo', () => {
    expect(effectiveStatus({ status: 'CONFIRMED', provider: 'opapingou', expires_at: past }, now)).toBe('CONFIRMED');
  });
});

describe('holdsPlace', () => {
  it('gratuito, importado e confirmado contam', () => {
    expect(holdsPlace({})).toBe(true);
    expect(holdsPlace({ payment: { status: 'CONFIRMED', provider: 'opapingou' } })).toBe(true);
  });
  it('Opa Pingou pendente, expirado ou cancelado não conta', () => {
    expect(holdsPlace({ payment: { status: 'PEDING_PAYMENT', provider: 'opapingou' } })).toBe(false);
    expect(holdsPlace({ payment: { status: 'EXPIRED' } })).toBe(false);
    expect(holdsPlace({ payment: { status: 'CANCELED' } })).toBe(false);
    expect(holdsPlace({ payment: { status: 'REFUND' } })).toBe(false);
  });
  it('pagamento antigo do Pix Aí: confirmado conta, pendente não', () => {
    expect(holdsPlace({ payment: { status: 'CONFIRMED', provider: null } })).toBe(true);
    expect(holdsPlace({ payment: { status: 'PEDING_PAYMENT', provider: null } })).toBe(false);
  });
});

describe('countsAsCouponUse', () => {
  it('confirmado e pendente no prazo contam; vencido, cancelado e expirado não', () => {
    expect(countsAsCouponUse({ status: 'CONFIRMED' }, now)).toBe(true);
    expect(countsAsCouponUse({ status: 'PEDING_PAYMENT', expires_at: future }, now)).toBe(true);
    expect(countsAsCouponUse({ status: 'PEDING_PAYMENT', expires_at: past }, now)).toBe(false);
    expect(countsAsCouponUse({ status: 'CANCELED' }, now)).toBe(false);
    expect(countsAsCouponUse({ status: 'EXPIRED' }, now)).toBe(false);
    expect(countsAsCouponUse({ status: 'PEDING_PAYMENT', expires_at: null }, now)).toBe(false);
  });
});
