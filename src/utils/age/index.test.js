import { describe, expect, it } from 'vitest';
import {
  adultCutoff, adultDateOfBirth, ageOn, isAdultDate, isMinorDate, requireAdultDeclaration,
} from '.';

const noon = new Date('2026-11-12T15:00:00.000Z');
// 02:00 UTC on the 12th is still the 11th in São Paulo.
const lateNight = new Date('2026-11-12T02:00:00.000Z');

describe('ageOn', () => {
  it('turns a year older on the birthday, in São Paulo', () => {
    expect(ageOn('2008-11-12', noon)).toBe(18);
    expect(ageOn('2008-11-13', noon)).toBe(17);
    expect(ageOn('2008-11-12', lateNight)).toBe(17);
  });
  it('is null for anything but YYYY-MM-DD', () => {
    expect(ageOn('', noon)).toBeNull();
    expect(ageOn(null, noon)).toBeNull();
    expect(ageOn('12/11/2008', noon)).toBeNull();
  });
});

describe('adultCutoff', () => {
  it('is today minus 18 years', () => {
    expect(adultCutoff(noon)).toBe('2008-11-12');
    expect(adultCutoff(lateNight)).toBe('2008-11-11');
  });
  it('moves 29/02 to 28/02 of a common year', () => {
    expect(adultCutoff(new Date('2028-02-29T15:00:00.000Z'))).toBe('2010-02-28');
  });
});

describe('isAdultDate / isMinorDate', () => {
  it('split valid dates at 18', () => {
    expect(isAdultDate('1990-01-01', noon)).toBe(true);
    expect(isMinorDate('2010-01-01', noon)).toBe(true);
    expect(isAdultDate(null, noon)).toBe(false);
    expect(isMinorDate(null, noon)).toBe(false);
  });
});

describe('adultDateOfBirth', () => {
  it('returns null when nothing was given', () => {
    expect(adultDateOfBirth(undefined, noon)).toBeNull();
    expect(adultDateOfBirth('  ', noon)).toBeNull();
  });
  it('returns the date of an adult', () => {
    expect(adultDateOfBirth('2008-11-12', noon)).toBe('2008-11-12');
  });
  it('refuses minors and invalid dates', () => {
    expect(() => adultDateOfBirth('2008-11-13', noon)).toThrow('É preciso ter 18 anos ou mais.');
    expect(() => adultDateOfBirth('2001-02-30', noon)).toThrow('Informe uma data de nascimento válida.');
    expect(() => adultDateOfBirth('2030-01-01', noon)).toThrow('Informe uma data de nascimento válida.');
  });
});

describe('requireAdultDeclaration', () => {
  it('passes only for true', () => {
    expect(() => requireAdultDeclaration(true)).not.toThrow();
    expect(() => requireAdultDeclaration(undefined)).toThrow('Confirme que você tem 18 anos ou mais.');
    expect(() => requireAdultDeclaration('true')).toThrow();
  });
});
