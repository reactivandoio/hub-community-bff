/**
 * Tracking resolver — handles analytics event tracking and metrics aggregation.
 */

// Same enum as api::analytics-event.event_type in the backend.
export const EVENT_TYPES = new Set([
  'page_visit',
  'signup_click',
  'signup_complete',
  'share_click',
  'coupon_applied',
  'payment_started',
  'certificate_click',
]);

export const MAX_METADATA_BYTES = 2 * 1024;

// trackEvent is public, so it only stores what the frontend actually sends: a known
// event type and a small metadata object.
export const validateTrackInput = (input) => {
  if (!EVENT_TYPES.has(input?.event_type)) return 'event_type inválido.';
  if (input.metadata !== undefined && input.metadata !== null) {
    const size = Buffer.byteLength(JSON.stringify(input.metadata), 'utf8');
    if (size > MAX_METADATA_BYTES) return 'metadata acima de 2 KB.';
  }
  return null;
};

const Tracking = {
  Query: {
    eventTrackingMetrics: async (_, { eventDocumentId, period }, { dataSources }) => {
      try {
        // Fetch all analytics events for this event (auto-paginated, no limit)
        let allEvents = await dataSources.managerIntegration.findAllAnalyticsEvents({
          event: { documentId: { eq: eventDocumentId } },
        });

        // Filter by period if specified
        if (period && period !== 'all') {
          const now = new Date();
          let cutoff;
          switch (period) {
            case '24h':
              cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
              break;
            case '7d':
              cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              break;
            case '30d':
              cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
              break;
            default:
              cutoff = null;
          }
          if (cutoff) {
            allEvents = allEvents.filter(e => new Date(e.createdAt) >= cutoff);
          }
        }

        // Count by event_type
        const visits = allEvents.filter(e => e.event_type === 'page_visit');
        const signupClicks = allEvents.filter(e => e.event_type === 'signup_click').length;
        const shareClicks = allEvents.filter(e => e.event_type === 'share_click').length;

        // Unique visitors by session_id
        const uniqueSessions = new Set();
        visits.forEach(v => {
          if (v.session_id) uniqueSessions.add(v.session_id);
        });

        // Timeline — group visits by day
        const timelineMap = {};
        visits.forEach(v => {
          const day = (v.createdAt || '').slice(0, 10);
          if (day) {
            timelineMap[day] = (timelineMap[day] || 0) + 1;
          }
        });

        const visitsByDay = Object.entries(timelineMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count }));

        // Referrer breakdown
        const referrerMap = {};
        visits.forEach(v => {
          const ref = v.referrer || 'direto';
          referrerMap[ref] = (referrerMap[ref] || 0) + 1;
        });

        const visitsByReferrer = Object.entries(referrerMap)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([referrer, count]) => ({ referrer, count }));

        return {
          total_visits: visits.length,
          unique_visitors: uniqueSessions.size,
          signup_clicks: signupClicks,
          share_clicks: shareClicks,
          visits_by_day: visitsByDay,
          visits_by_referrer: visitsByReferrer,
        };
      } catch (err) {
        console.error('[Tracking] Error fetching metrics:', err.message);
        return {
          total_visits: 0,
          unique_visitors: 0,
          signup_clicks: 0,
          share_clicks: 0,
          visits_by_day: [],
          visits_by_referrer: [],
        };
      }
    },
  },

  Mutation: {
    trackEvent: async (_, { input }, { dataSources, user }) => {
      const invalid = validateTrackInput(input);
      if (invalid) {
        console.warn(`[Tracking] Evento recusado: ${invalid}`);
        return { success: false, id: null };
      }
      try {
        const data = {
          event_type: input.event_type,
          metadata: input.metadata || null,
          session_id: input.session_id || null,
          user_agent: input.user_agent || null,
          referrer: input.referrer || null,
        };

        // Link to event if provided
        if (input.event_id) {
          data.event = input.event_id;
        }

        // Link to user if authenticated
        if (user?.id) {
          data.users_permissions_user = user.id;
        }

        const result = await dataSources.managerIntegration.trackAnalyticsEvent(data);

        return {
          success: true,
          id: result?.data?.documentId || result?.data?.id || null,
        };
      } catch (err) {
        console.error('[Tracking] Error tracking event:', err.message);
        return {
          success: false,
          id: null,
        };
      }
    },
  },
};

export default Tracking;
