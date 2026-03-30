import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const trackAnalyticsEvent = (data, headers) =>
  fetch('/analytics-events', 'POST', headers, { data });

/**
 * Fetch ALL analytics events for given filters using auto-pagination.
 * Strapi v5 defaults to 25 per page — this loops until all records are fetched.
 */
const findAllAnalyticsEvents = async (filters, headers) => {
  let allEvents = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const query = buildQuery(filters, [{ createdAt: 'desc' }], { page, pageSize: 100 }, '', ['event']);
    const route = `/analytics-events${query ? `?${query}` : ''}`;
    const response = await fetch(route, 'GET', headers);

    const data = response?.data || [];
    allEvents = allEvents.concat(Array.isArray(data) ? data : [data]);

    // response.meta already IS the pagination object (extracted by createStrapiFetch)
    const paginationMeta = response?.meta;
    if (paginationMeta && page < paginationMeta.pageCount) {
      page += 1;
    } else {
      hasMore = false;
    }
  }

  return allEvents;
};

const analyticsEvents = ({ headers }) => ({
  trackAnalyticsEvent: (data) => trackAnalyticsEvent(data, headers),
  findAllAnalyticsEvents: (filters) => findAllAnalyticsEvents(filters, headers),
});

export default analyticsEvents;
