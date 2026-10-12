import { describe, it, expect } from 'vitest';
import { withUserNames } from '../../utils/signup-names';
import mapSignup from './mappers';

describe('mapSignup', () => {
  it('maps an Eventando signup to the EventSignup shape', () => {
    expect(
      mapSignup({
        documentId: 'abc',
        id: 7,
        name: 'Ana Souza',
        email: 'ana@x.io',
        phone_number: '+55 62 9',
        checked_in: true,
        checked_in_at: '2026-09-01T10:00:00.000Z',
        payment: { batch: { product: { name: 'Lote 1' } } },
      }),
    ).toEqual({
      id: 'abc',
      name: 'Ana Souza',
      email: 'ana@x.io',
      phone_number: '+55 62 9',
      checked_in: true,
      checked_in_at: '2026-09-01T10:00:00.000Z',
      product_name: 'Lote 1',
      half_price: false,
    });
  });

  it('falls back to the numeric id and empty strings', () => {
    expect(mapSignup({ id: 7 })).toEqual({
      id: '7',
      name: '',
      email: '',
      phone_number: '',
      checked_in: false,
      checked_in_at: null,
      product_name: null,
      half_price: false,
    });
  });

  it('half_price only when the payment got the student discount', () => {
    expect(mapSignup({ id: 1, payment: { status: 'CONFIRMED', discount_kind: 'student', original_value: '5000', value: '2500' } }).half_price).toBe(true);
    // Free batch with the box ticked: half of zero is not half price.
    expect(mapSignup({ id: 1, payment: { status: 'CONFIRMED', discount_kind: 'student', original_value: 0, value: 0 } }).half_price).toBe(false);
    // Marked half price, but the coupon gave more discount.
    expect(mapSignup({ id: 1, payment: { status: 'CONFIRMED', discount_kind: 'coupon' } }).half_price).toBe(false);
    expect(mapSignup({ id: 1, payment: { status: 'CONFIRMED', discount_kind: null } }).half_price).toBe(false);
    expect(mapSignup({ id: 1 }).half_price).toBe(false);
  });
});

describe('withUserNames', () => {
  const signups = [
    { id: '1', name: 'ana-4f2k', email: 'Ana@x.io' },
    { id: '2', name: 'Bia Lima', email: 'bia@x.io' },
    { id: '3', name: 'caio-9z', email: 'caio@x.io' },
  ];

  it('replaces the signup name with the HubCommunity user name, matching e-mail case-insensitively', () => {
    const users = [
      { email: 'ana@x.io', name: 'Ana Souza' },
      { email: 'bia@x.io', name: 'Beatriz Lima' },
    ];
    expect(withUserNames(signups, users).map((s) => s.name)).toEqual(['Ana Souza', 'Beatriz Lima', 'caio-9z']);
  });

  it('keeps the signup name when the user has no name', () => {
    const users = [
      { email: 'ana@x.io', name: null },
      { email: 'caio@x.io', name: '   ' },
    ];
    expect(withUserNames(signups, users).map((s) => s.name)).toEqual(['ana-4f2k', 'Bia Lima', 'caio-9z']);
  });

  it('is a no-op without users and does not mutate the input', () => {
    const out = withUserNames(signups, []);
    expect(out).toEqual(signups);
    expect(out).not.toBe(signups);
    expect(withUserNames(signups, null)).toEqual(signups);
  });
});
