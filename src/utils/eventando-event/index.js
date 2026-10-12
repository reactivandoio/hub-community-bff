// The Eventando event behind the key the frontend has: the slug, the Hub documentId
// (the Eventando `uuid`) or, for old callers, the Eventando numeric id.
export const findEventandoEvent = async (dataSources, key, populate = []) => {
  if (!key) return null;
  const or = [{ slug: { eq: key } }, { uuid: { eq: key } }];
  if (/^\d+$/.test(String(key))) or.push({ id: { eq: key } });
  const response = await dataSources.eventandoIntegration.findEvents({
    filters: { or },
    pagination: { pageSize: 1 },
    populate,
  });
  return response?.data?.[0] || null;
};

export default findEventandoEvent;
