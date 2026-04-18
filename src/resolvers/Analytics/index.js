import dotenv from 'dotenv';

dotenv.config();

/**
 * Analytics resolver — aggregates data from Hub Community Manager + Eventando Manager
 * to provide a complete event analytics dashboard.
 */
const Analytics = {
  Query: {
    eventAnalytics: async (_, { slugOrId }, { dataSources }) => {
      try {
        // 1. Resolve event from both sources
        const [managerResult, eventandoResult] = await Promise.allSettled([
          dataSources.manager.findEvents(
            {
              or: [
                { slug: { eq: slugOrId } },
                { documentId: { eq: slugOrId } },
              ],
            },
            [],
            {},
            '',
            ['location', 'images', 'communities', 'tags', 'participants'],
          ),
          dataSources.eventandoIntegration.findEvents({
            filters: {
              or: [
                { slug: { eq: slugOrId } },
                { uuid: { eq: slugOrId } },
              ],
            },
            populate: ['products', 'products.batches', 'signups', 'signups.payment'],
          }),
        ]);

        const managerEvent =
          managerResult.status === 'fulfilled'
            ? managerResult.value?.data?.[0]
            : null;

        const eventandoEvent =
          eventandoResult.status === 'fulfilled'
            ? eventandoResult.value?.data?.[0]
            : null;

        if (!managerEvent && !eventandoEvent) {
          throw new Error(`Event "${slugOrId}" not found`);
        }

        const eventTitle = managerEvent?.title || eventandoEvent?.name || 'Evento';
        const eventSlug = managerEvent?.slug || eventandoEvent?.slug || slugOrId;
        const eventId = managerEvent?.documentId || eventandoEvent?.uuid || slugOrId;

        // 2. Fetch signups from Eventando Manager (all of them, paginated internally)
        let allSignups = [];
        if (eventandoEvent) {
          try {
            allSignups = await dataSources.eventandoIntegration.findSignupsByEvent(
              eventandoEvent.id,
            );
          } catch (err) {
            console.error('[Analytics] Error fetching signups:', err.message);
          }
        }

        // 3. Fetch participants (certificate requests) from Hub Community Manager
        let certificateRequests = 0;
        if (managerEvent?.documentId) {
          try {
            const participantsResponse = await dataSources.managerIntegration.findParticipants(
              managerEvent.documentId,
            );
            certificateRequests = participantsResponse?.meta?.pagination?.total
              || participantsResponse?.data?.length
              || 0;
          } catch (err) {
            console.error('[Analytics] Error fetching participants:', err.message);
            // Try counting from the event populate
            certificateRequests = managerEvent?.participants?.length || 0;
          }
        }

        // 4. Process signups
        const totalSignups = allSignups.length;

        // Determine free vs paid based on payment presence/value
        let freeSignups = 0;
        let paidSignups = 0;

        allSignups.forEach(signup => {
          const payment = signup.payment;
          if (!payment || Number(payment.value) === 0 || payment.value === null) {
            freeSignups++;
          } else {
            paidSignups++;
          }
        });

        // 5. Capacity/occupancy
        const maxSlots = eventandoEvent?.max_slots || managerEvent?.max_slots || null;
        const occupancyPercentage = maxSlots
          ? Math.round((totalSignups / maxSlots) * 10000) / 100
          : null;

        // 6. Product & batch breakdown
        const products = eventandoEvent?.products || [];
        const productsBreakdown = products
          .map(product => {
            // Count signups per product/batch
            const productSignups = allSignups.filter(s => {
              const paymentProductId = s.payment?.batch?.product?.documentId || s.payment?.batch?.product?.id || s.payment?.batch?.product;
              return paymentProductId === product.documentId || paymentProductId === product.id;
            });

            const batches = (product.batches || [])
              .map(batch => {
                const batchSignups = allSignups.filter(s => {
                  const paymentBatchId = s.payment?.batch?.documentId || s.payment?.batch?.id || s.payment?.batch;
                  return paymentBatchId === batch.documentId || paymentBatchId === batch.id;
                });

                const batchValue = batch.value || 0;
                return {
                  batch_id: String(batch.documentId || batch.id),
                  batch_number: batch.batch_number,
                  value: batchValue,
                  max_quantity: batch.max_quantity,
                  sold_quantity: batchSignups.length,
                  revenue: batchSignups.length * batchValue,
                  deleted: batch.deleted || false,
                };
              })
              .filter(b => !(b.deleted && b.sold_quantity === 0));

            return {
              product_id: String(product.documentId || product.id),
              product_name: product.name || 'Produto',
              total_signups: productSignups.length || batches.reduce((sum, b) => sum + b.sold_quantity, 0),
              batches,
              deleted: product.deleted || false,
            };
          })
          .filter(p => !(p.deleted && p.total_signups === 0));

        // 7. Timeline — aggregate signups by day
        const timelineMap = {};
        allSignups.forEach(signup => {
          const createdAt = signup.createdAt || signup.created_at;
          if (createdAt) {
            const day = createdAt.slice(0, 10); // "YYYY-MM-DD"
            timelineMap[day] = (timelineMap[day] || 0) + 1;
          }
        });

        // Sort by date
        const signupsTimeline = Object.entries(timelineMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({ date, count }));

        // 8. All signups list
        const allSignupsMapped = allSignups.map(signup => ({
          name: signup.name,
          email: signup.email,
          phone_number: signup.phone_number,
          created_at: signup.createdAt || signup.created_at,
          product_name: signup.payment?.batch?.product?.name || null,
        }));

        return {
          event_id: eventId,
          event_title: eventTitle,
          event_slug: eventSlug,
          total_signups: totalSignups,
          free_signups: freeSignups,
          paid_signups: paidSignups,
          max_slots: maxSlots,
          occupancy_percentage: occupancyPercentage,
          certificate_requests: certificateRequests,
          products_breakdown: productsBreakdown,
          signups_timeline: signupsTimeline,
          all_signups: allSignupsMapped,
        };
      } catch (err) {
        throw new Error(`Error fetching event analytics: ${err.message}`);
      }
    },
  },
};

export default Analytics;
