import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CATEGORY,
  normalizeCategory,
  categoryKey,
  isDefaultCategory,
  sameCategory,
  filterByCategory,
} from './categories';

describe('normalizeCategory', () => {
  it('keeps the typed label, trimmed', () => {
    expect(normalizeCategory('  Mentor ')).toBe('Mentor');
  });
  it('falls back to the default when empty', () => {
    expect(normalizeCategory('')).toBe(DEFAULT_CATEGORY);
    expect(normalizeCategory(null)).toBe(DEFAULT_CATEGORY);
    expect(normalizeCategory(undefined)).toBe(DEFAULT_CATEGORY);
  });
});

describe('categoryKey', () => {
  it('ignores case, accents and spacing', () => {
    expect(categoryKey('Voluntário')).toBe('voluntario');
    expect(categoryKey('EQUIPE DE APOIO')).toBe('equipe-de-apoio');
  });
});

describe('isDefaultCategory / sameCategory', () => {
  it('treats an empty category as the default one', () => {
    expect(isDefaultCategory(null)).toBe(true);
    expect(sameCategory(null, 'participante')).toBe(true);
  });
  it('separates different categories', () => {
    expect(isDefaultCategory('Mentor')).toBe(false);
    expect(sameCategory('Mentor', 'Organizador')).toBe(false);
  });
});

describe('filterByCategory', () => {
  const rows = [
    { name: 'sem categoria' },
    { name: 'participante', category: 'Participante' },
    { name: 'mentor', category: 'mentor' },
    { name: 'organizador', category: 'Organizador' },
  ];

  it('puts the rows without a category in the default list', () => {
    expect(filterByCategory(rows, 'Participante').map((r) => r.name)).toEqual([
      'sem categoria',
      'participante',
    ]);
    expect(filterByCategory(rows, undefined).map((r) => r.name)).toEqual([
      'sem categoria',
      'participante',
    ]);
  });

  it('matches another category regardless of casing', () => {
    expect(filterByCategory(rows, 'Mentor').map((r) => r.name)).toEqual(['mentor']);
  });

  it('handles an empty list', () => {
    expect(filterByCategory(null, 'Mentor')).toEqual([]);
  });
});
