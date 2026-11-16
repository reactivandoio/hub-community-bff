// REA-56: public queries that read with the integration token (communities, comments) pass the
// caller's filters to Strapi. A filter on a personal field answers yes/no about it, so an
// anonymous caller could find an organizer's e-mail one letter at a time
// (organizers: { email: { startsWith: "a" } }). These keys are dropped, at any depth.
export const PERSONAL_FILTER_KEYS = new Set([
  'email',
  'phone',
  'phone_number',
  'cpf',
  'identifier',
  'date_of_birth',
  'whatsapp',
  'adult_declaration',
]);

export const withoutPersonalFilters = (filters) => {
  if (Array.isArray(filters)) return filters.map(withoutPersonalFilters);
  if (!filters || typeof filters !== 'object') return filters;
  return Object.fromEntries(
    Object.entries(filters)
      .filter(([key]) => !PERSONAL_FILTER_KEYS.has(key))
      .map(([key, value]) => [key, withoutPersonalFilters(value)]),
  );
};
