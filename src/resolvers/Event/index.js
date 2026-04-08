import dotenv from 'dotenv';
import pubsub from '../../dataSources/pubsub';
import { sendEmail } from '../../services/email';
import { signupConfirmationTemplate } from '../../services/email/templates/signup-confirmation';

dotenv.config();

const Event = {
  Event: {
    title: ({ name, title }) => title || name,
    id: ({ documentId, uuid }) => documentId || uuid,
    images: ({ images }) => {
      if (!images || !Array.isArray(images)) return [];
      return images
        .map((image) => {
          if (typeof image === 'string') {
            return image.startsWith('http')
              ? image
              : `${process.env.MANAGER_URL}${image}`;
          }
          if (image?.formats?.large?.url) {
            return `${process.env.MANAGER_URL}${image.formats.large.url}`;
          }
          return image?.url ? `${process.env.MANAGER_URL}${image.url}` : null;
        })
        .filter(Boolean);
    },
    products: async ({ slug }, _, { dataSources }) => {
      if (!slug) return [];
      try {
        const response = await dataSources.eventandoIntegration.findEventBySlug(slug);
        const eventandoEvent = response?.data?.[0];
        if (!eventandoEvent || !eventandoEvent.products) return [];
        return eventandoEvent.products
          .filter((p) => !p.deleted)
          .map((product) => ({
            ...product,
            batches: (product.batches || []).filter((b) => !b.deleted),
          }));
      } catch (err) {
        // If Eventando Manager is unreachable, return empty
        return [];
      }
    },
    // Return call_link from event data (frontend protects display via isUserSignedUp)
    call_link: ({ call_link }) => call_link || null,
  },

  Query: {
    events: async (
      _,
      { filters, sort, pagination, search },
      { dataSources },
    ) => {
      try {
        const response = await dataSources.manager.findEvents(
          filters,
          sort,
          pagination,
          search,
        );
        return response;
      } catch (err) {
        throw new Error(`Error fetching events: ${err.message}`);
      }
    },

    event: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.findEventById(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching event: ${err.message}`);
      }
    },

    eventBySlugOrId: async (_, { slugOrId }, { dataSources }) => {
      const managerFilters = {
        or: [
          { slug: { eq: slugOrId } },
          { documentId: { eq: slugOrId } },
          { id: { eq: slugOrId } },
        ],
      };

      const eventandoFilters = {
        or: [
          { slug: { eq: slugOrId } },
          { uuid: { eq: slugOrId } },
          { id: { eq: slugOrId } },
        ],
      };

      try {
        const [managerResult, eventandoResult] = await Promise.allSettled([
          dataSources.manager.findEvents(managerFilters, [], {}, '', [
            'location',
            'images',
            'communities',
            'talks',
            'talks.speakers',
            'talks.speakers.avatar',
            'tags',
          ]),
          dataSources.eventandoIntegration.findEvents({
            filters: eventandoFilters,
            populate: ['products', 'products.batches'],
          }),
        ]);

        if (managerResult.status === 'rejected') {
          throw new Error(
            `Manager API failed: ${managerResult.reason.message}`,
          );
        }

        if (eventandoResult.status === 'rejected') {
          throw new Error(
            `Eventando API failed: ${eventandoResult.reason.message}`,
          );
        }

        const managerEvent = managerResult.value?.data?.[0];
        const eventandoEvent = eventandoResult.value?.data?.[0];

        if (!managerEvent && !eventandoEvent) {
          throw new Error(`Event with slug or id "${slugOrId}" not found`);
        }

        // Merge: Manager is the base, it holds truth for slug, title, images, location
        return {
          ...(managerEvent || {}),
          products: eventandoEvent?.products
            ?.filter(p => !p.deleted)
            ?.map(p => ({
              ...p,
              batches: p.batches?.filter(b => !b.deleted) || [],
            })) || [],
          max_slots: eventandoEvent?.max_slots ?? managerEvent?.max_slots,
          uuid: managerEvent?.documentId || eventandoEvent?.uuid,
        };
      } catch (err) {
        throw new Error(`Error fetching event: ${err.message}`);
      }
    },

    // Legacy query for backward compatibility
    findEvents: async (_, __, { dataSources }) => {
      try {
        const response = await dataSources.manager.findEvents();
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching events: ${err.message}`);
      }
    },

    isUserSignedUp: async (_, { eventId, email }, { dataSources }) => {
      try {
        // Look up event in Eventando Manager by slug/uuid to get internal ID
        const eventandoResponse = await dataSources.eventandoIntegration.findEventBySlug(eventId);
        const eventandoEvent = eventandoResponse?.data?.[0];

        if (!eventandoEvent) {
          return {
            is_signed_up: false,
            call_link: null,
          };
        }

        // Check signup in Eventando Manager using the internal event ID
        const signupResponse = await dataSources.eventandoIntegration.findSignupByEmail(
          eventandoEvent.id,
          email,
        );

        const isSignedUp = signupResponse?.data && signupResponse.data.length > 0;

        if (!isSignedUp) {
          return {
            is_signed_up: false,
            call_link: null,
          };
        }

        // User is signed up — fetch the event from Hub Community to get call_link
        const filters = {
          or: [
            { slug: { eq: eventId } },
            { documentId: { eq: eventId } },
          ],
        };
        const hubResponse = await dataSources.manager.findEvents(filters);
        const hubEvent = hubResponse?.data?.[0];

        return {
          is_signed_up: true,
          call_link: hubEvent?.call_link || null,
        };
      } catch (err) {
        // If lookup fails, treat as not signed up
        return {
          is_signed_up: false,
          call_link: null,
        };
      }
    },
  },

  Mutation: {
    // eslint-disable-next-line no-unused-vars
    submitEventComment: async (_, { eventId }, ___) => ({
      comment: 'comment',
      event: { id: eventId },
    }),

    createEvent: async (_, { data }, { dataSources }) => {
      let managerResponse;

      try {
        // Create in Hub Community Manager
        managerResponse = await dataSources.managerIntegration.createEvent(
          {
            title: data.title,
            description: data.description,
            start_date: data.start_date,
            end_date: data.end_date,
            is_online: data.is_online || false,
            call_link: data.call_link || null,
            location: data.location,
            images: data.images,
            communities: data.communities,
            talks: data.talks,
          },
          [
            'location',
            'images',
            'communities',
            'talks',
            'talks.speakers',
            'talks.speakers.avatar',
            'tags',
          ],
        );
      } catch (err) {
        throw new Error(`Error creating event in manager: ${err.message}`);
      }

      try {
        const eventId = managerResponse.data.documentId;

        // Orchestrate talks association
        if (data.talks && Array.isArray(data.talks)) {
          await Promise.allSettled(
            data.talks.map((talkId) =>
              dataSources.managerIntegration.updateTalk(talkId, {
                event: eventId,
              }),
            ),
          );
        }

        // Orchestrate communities association
        if (data.communities && Array.isArray(data.communities)) {
          await Promise.allSettled(
            data.communities.map(async (communityId) => {
              try {
                const community =
                  await dataSources.managerIntegration.findCommunityById(
                    communityId,
                  );
                const currentEvents = community?.data?.events || [];
                const eventIds = [
                  ...new Set([
                    ...currentEvents.map((e) => e.documentId || e.id),
                    eventId,
                  ]),
                ];
                return dataSources.managerIntegration.updateCommunity(
                  communityId,
                  { events: eventIds },
                );
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(
                  `Error associating community ${communityId}: ${err.message}`,
                );
                return Promise.reject(err);
              }
            }),
          );
        }

        // Create in Eventando Manager (mapping title to name)
        const eventandoData = {
          ...data,
          uuid: eventId,
          name: data.title,
        };
        delete eventandoData.title;
        delete eventandoData.is_online;
        delete eventandoData.call_link;

        const response = await dataSources.eventandoIntegration.createEvent(eventandoData);

        return response.data;
      } catch (err) {
        throw new Error(`Error creating event in eventando: ${err.message}`);
      }
    },

    updateEvent: async (_, { id, data }, { dataSources }) => {
      try {
        const events = await dataSources.eventandoIntegration.findEvents({
          filters: {
            or: [{ uuid: { eq: id } }, { id: { eq: id } }],
          },
        });
        const event = events.data[0];

        if (!event) {
          throw new Error(`Event with id "${id}" not found`);
        }

        const managerResponse =
          await dataSources.managerIntegration.updateEvent(
            id,
            {
              title: data.title,
              description: data.description,
              start_date: data.start_date,
              end_date: data.end_date,
              is_online: data.is_online || false,
              call_link: data.call_link || null,
              location: data.location,
              images: data.images,
              communities: data.communities,
              talks: data.talks,
            },
            [
              'location',
              'images',
              'communities',
              'talks',
              'talks.speakers',
              'talks.speakers.avatar',
              'tags',
            ],
          );

        // Update in Eventando Manager (mapping title to name)
        const eventandoData = {
          ...data,
          uuid: managerResponse.data.documentId,
          name: data.title,
        };
        delete eventandoData.title;
        delete eventandoData.is_online;
        delete eventandoData.call_link;

        const eventandoResponse =
          await dataSources.eventandoIntegration.updateEvent(event.id, eventandoData);

        const eventId = managerResponse.data.documentId;

        // Orchestrate talks association
        if (data.talks && Array.isArray(data.talks)) {
          await Promise.allSettled(
            data.talks.map((talkId) =>
              dataSources.managerIntegration.updateTalk(talkId, {
                event: eventId,
              }),
            ),
          );
        }

        // Orchestrate communities association
        if (data.communities && Array.isArray(data.communities)) {
          await Promise.allSettled(
            data.communities.map(async (communityId) => {
              try {
                const community =
                  await dataSources.managerIntegration.findCommunityById(
                    communityId,
                  );
                const currentEvents = community?.data?.events || [];
                const eventIds = [
                  ...new Set([
                    ...currentEvents.map((e) => e.documentId || e.id),
                    eventId,
                  ]),
                ];
                return dataSources.managerIntegration.updateCommunity(
                  communityId,
                  { events: eventIds },
                );
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error(
                  `Error associating community ${communityId}: ${err.message}`,
                );
                return Promise.reject(err);
              }
            }),
          );
        }

        return {
          ...managerResponse.data,
          ...eventandoResponse.data,
        };
      } catch (err) {
        throw new Error(`Error updating event: ${err.message}`);
      }
    },

    updateEventSale: async (_, { id, data }, { dataSources }) => {
      try {
        // 1. Find the event in Eventando Manager
        const events = await dataSources.eventandoIntegration.findEvents({
          filters: {
            or: [{ uuid: { eq: id } }, { id: { eq: id } }],
          },
          populate: ['products', 'products.batches'],
        });
        const event = events.data[0];

        if (!event) {
          throw new Error(`Event with id "${id}" not found in Eventando`);
        }

        const eventandoEventId = event.id;

        // 2. Identify existing products and batches to potentially delete
        const existingProducts = event.products || [];
        const inputProductIds = (data.products || [])
          .filter((p) => p.id && !p.id.toString().startsWith('new-'))
          .map((p) => p.id.toString());
        const inputBatchIds = [];
        (data.products || []).forEach(p => {
          (p.batches || []).forEach(b => {
             if (b.id && !b.id.toString().startsWith('new-')) inputBatchIds.push(b.id.toString());
          });
        });

        // Delete batches that are no longer in the input
        for (const product of existingProducts) {
          if (product.batches && product.batches.length > 0) {
            for (const batch of product.batches) {
              if (!inputBatchIds.includes(batch.id?.toString())) {
                try {
                  const targetBatchId = batch.documentId || batch.id;
                  await dataSources.eventandoIntegration.updateBatch(targetBatchId, { deleted: true, enabled: false });
                } catch (batchErr) {
                  console.error(`Failed to logically delete batch ${batch.id}:`, batchErr.message);
                }
              }
            }
          }
        } // <--- Added missing closing brace
        // Delete products that are no longer in the input
        console.log(`[DELETION LOGIC] existingProducts count:`, existingProducts.length);
        console.log(`[DELETION LOGIC] inputProductIds array:`, inputProductIds);
        
        for (const product of existingProducts) {
          const prodIdStr = product.id?.toString();
          console.log(`[DELETION LOGIC] Checking product ID: ${prodIdStr} - included in input?`, inputProductIds.includes(prodIdStr));
          
          if (!inputProductIds.includes(prodIdStr)) {
            try {
              const targetProdId = product.documentId || product.id;
              console.log(`[DELETION LOGIC] Executing updateProduct for targetProdId:`, targetProdId);
              
              const res = await dataSources.eventandoIntegration.updateProduct(targetProdId, { deleted: true, enabled: false });
              console.log(`[DELETION LOGIC] updateProduct SUCCESS for ${targetProdId}. Response:`, JSON.stringify(res.data));
            } catch (prodErr) {
              console.error(`Failed to logically delete product ${product.id}:`, prodErr.message);
              throw new Error(`Failed to logically delete product ${product.name || product.id}: ${prodErr.response?.data?.error?.message || prodErr.message}`);
            }
          }
        }

        // 3. Update event max_slots if provided
        if (data.max_slots !== undefined) {
          await dataSources.eventandoIntegration.updateEvent(eventandoEventId, {
            max_slots: data.max_slots,
          });
        }

        // 4. Create or update products and their batches
        const processedProducts = [];
        if (data.products && Array.isArray(data.products)) {
          for (const productInput of data.products) {
            let processedProduct;
            
            if (productInput.id && !productInput.id.toString().startsWith('new-')) {
               const res = await dataSources.eventandoIntegration.updateProduct(productInput.id, {
                 name: productInput.name,
                 enabled: productInput.enabled !== false,
                 event: eventandoEventId,
               });
               processedProduct = res.data;
            } else {
               const res = await dataSources.eventandoIntegration.createProduct({
                 name: productInput.name,
                 enabled: productInput.enabled !== false,
                 event: eventandoEventId,
               });
               processedProduct = res.data;
            }

            const processedBatches = [];

            if (productInput.batches && Array.isArray(productInput.batches)) {
               for (const batchInput of productInput.batches) {
                 const batchData = {
                    batch_number: batchInput.batch_number || 1,
                    value: batchInput.value || 0,
                    max_quantity: batchInput.max_quantity || 0,
                    valid_from: batchInput.valid_from || undefined,
                    valid_until: batchInput.valid_until || undefined,
                    enabled: batchInput.enabled !== false,
                    half_price_eligible: batchInput.half_price_eligible || false,
                    product: processedProduct.id,
                 };

                 if (batchInput.id && !batchInput.id.toString().startsWith('new-')) {
                    const res = await dataSources.eventandoIntegration.updateBatch(batchInput.id, batchData);
                    processedBatches.push(res.data);
                 } else {
                    batchData.valid_from = batchData.valid_from || new Date().toISOString();
                    batchData.valid_until = batchData.valid_until || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
                    const res = await dataSources.eventandoIntegration.createBatch(batchData);
                    processedBatches.push(res.data);
                 }
               }
            }

            processedProducts.push({
               ...processedProduct,
               batches: processedBatches,
            });
          }
        }

        // 5. Return the event with the processed products
        return {
          id: event.uuid || id,
          ...event,
          products: processedProducts.filter(p => !p.deleted),
        };
      } catch (err) {
        console.error(`[updateEventSale] Error full trace:`, err);
        throw new Error(`Error updating event sale: ${err.message}`);
      }
    },

    deleteEvent: async (_, { id }, { dataSources }) => {
      try {
        // Find current event to get the slug for orchestration
        const currentEventResponse = await dataSources.manager.findEventById(id);
        const slug = currentEventResponse?.data?.attributes?.slug;

        if (!slug) {
          throw new Error('Event slug is required for orchestration');
        }

        // Delete from Hub Community Manager
        const hubResponse = await dataSources.managerIntegration.deleteEvent(id);

        // Delete from Eventando Manager using slug
        await dataSources.eventandoIntegration.deleteEventBySlug(slug);

        return hubResponse.data;
      } catch (err) {
        throw new Error(`Error deleting event: ${err.message}`);
      }
    },

    signupToEvent: async (
      _,
      {
        eventId,
        name,
        email,
        batch_id,
        coupon_code,
        is_student,
        phone_number,
        t_shirt_size,
      },
      { dataSources },
    ) => {
      try {
        // Resolve the Eventando Manager internal ID from slug/uuid
        const eventandoResponse = await dataSources.eventandoIntegration.findEventBySlug(eventId);
        const eventandoEvent = eventandoResponse?.data?.[0];

        if (!eventandoEvent) {
          return {
            success: false,
            message: 'Evento não encontrado no sistema de inscrições.',
            payment: null,
            is_free: false,
          };
        }

        const signupData = {
          name,
          email,
          batch_id: parseInt(batch_id, 10),
          coupon_code,
          is_student,
          phone_number,
          t_shirt_size,
        };

        const response = await dataSources.eventandoIntegration.signup(
          eventandoEvent.id,
          signupData,
        );

        // Eventando Manager returns { status: 'error', message: '...' } on 400
        if (response.status === 'error' || response.error) {
          return {
            success: false,
            message: response.message || response.error?.message || 'Erro ao realizar inscrição.',
            payment: null,
            is_free: false,
          };
        }

        // Send confirmation email asynchronously (don't block the response)
        sendSignupConfirmationEmail({
          dataSources,
          eventId,
          userName: name,
          userEmail: email,
          eventandoEvent,
          productName: null, // Will be resolved from event data
          isFree: response.data?.is_free || response.is_free || false,
        }).catch(err => console.error('[Email] Error sending confirmation:', err.message));

        return {
          success: true,
          message: 'Inscrição realizada com sucesso!',
          payment: response.data || response,
          is_free: response.data?.is_free || response.is_free || false,
        };
      } catch (err) {
        // Extract error message from Eventando Manager response if available
        const errorMessage = err.response?.data?.message
          || err.message
          || 'Erro ao realizar inscrição.';
        return {
          success: false,
          message: errorMessage,
          payment: null,
          is_free: false,
        };
      }
    },
  },

  Subscription: {
    commentEventAdded: {
      resolve: (payload) => payload.messageReceived,
      subscribe: (_, { eventId }) => pubsub.asyncIterator([eventId]),
    },
  },
};

/**
 * Fetches full event info from Hub Community Manager and sends confirmation email.
 * Runs asynchronously — errors are caught by the caller.
 */
async function sendSignupConfirmationEmail({
  dataSources,
  eventId,
  userName,
  userEmail,
  eventandoEvent,
  isFree,
}) {
  // Flatten Eventando event (Strapi v4: fields under .attributes)
  const eventandoFlat = {
    ...(eventandoEvent?.attributes || {}),
    id: eventandoEvent?.id,
  };

  // Flatten Eventando products (also Strapi v4)
  const eventandoProducts = (eventandoFlat.products?.data || []).map(p => ({
    ...p.attributes,
    id: p.id,
  }));

  // Fetch complete event data from Hub Community Manager (Strapi v5: flat format)
  let managerEvent = null;
  try {
    const slug = eventandoFlat.slug || eventId;
    const managerResponse = await dataSources.managerIntegration.findEventBySlug(slug);
    managerEvent = managerResponse?.data?.[0] || null;
  } catch (err) {
    console.error('[Email] Could not fetch manager event:', err.message);
  }

  // Hub Community Manager has the rich event data (dates, location, images, is_online)
  // Eventando has the products/batches
  const event = managerEvent || eventandoFlat;
  const title = event.title || event.name || eventandoFlat.name || 'Evento';

  // Format date/time
  const startDate = event.start_date ? new Date(event.start_date) : null;
  const dateStr = startDate
    ? startDate.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo',
      })
    : 'A definir';
  const timeStr = startDate
    ? startDate.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      })
    : 'A definir';

  // Location
  const isOnline = event.is_online || false;
  let locationStr = 'A definir';
  if (isOnline) {
    locationStr = 'Online';
  } else if (event.location) {
    locationStr = event.location.title || event.location.city || 'Local a definir';
  }

  // Cover image — Hub Community Manager images are relative URLs
  const managerBaseUrl = process.env.MANAGER_URL || 'https://manager.hubcommunity.io';
  let imageUrl = null;
  if (event.images && event.images.length > 0) {
    const img = event.images[0];
    const rawUrl = typeof img === 'string'
      ? img
      : img?.url || img?.formats?.large?.url || img?.formats?.medium?.url || null;
    if (rawUrl) {
      imageUrl = rawUrl.startsWith('http') ? rawUrl : `${managerBaseUrl}${rawUrl}`;
    }
  }

  // Product name from Eventando products
  let productName = 'Ingresso';
  if (eventandoProducts.length > 0) {
    productName = eventandoProducts[0].name || 'Ingresso';
  }

  // Call link (from Hub Community Manager)
  const callLink = event.call_link || null;

  // Build & send email
  const baseUrl = process.env.FRONTEND_URL || 'https://hubcommunity.io';
  const html = signupConfirmationTemplate({
    userName: userName || userEmail.split('@')[0],
    eventTitle: title,
    eventDate: dateStr,
    eventTime: timeStr,
    eventLocation: locationStr,
    eventDescription: typeof event.description === 'string' ? event.description : '',
    eventImage: imageUrl,
    eventSlug: event.slug || eventandoFlat.slug || eventId,
    productName,
    isFree,
    isOnline,
    callLink,
    baseUrl,
  });

  await sendEmail({
    to: userEmail,
    subject: `✅ Inscrição Confirmada — ${title}`,
    html,
  });
}

export default Event;
