// Certificate categories — "Participante" (the default), "Organizador", "Mentor"…
// Mirrors hub-community-backend's `src/utils/certificate-category.ts`: the label is stored as
// typed and compared through `categoryKey`, so accents and casing never split one list in two.
// Rows written before categories existed carry `null` and belong to the default category.

export const DEFAULT_CATEGORY = 'Participante';

export const normalizeCategory = (value) => (value || '').trim() || DEFAULT_CATEGORY;

export const categoryKey = (value) =>
  normalizeCategory(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const isDefaultCategory = (value) => categoryKey(value) === categoryKey(DEFAULT_CATEGORY);

export const sameCategory = (a, b) => categoryKey(a) === categoryKey(b);

/** Keeps the rows of one category. `row.category` being empty means the default one. */
export const filterByCategory = (rows, category) =>
  (rows || []).filter((row) => sameCategory(row?.category, category));
