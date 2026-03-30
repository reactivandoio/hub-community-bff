import dotenv from 'dotenv';
import pubsub from '../../dataSources/pubsub';

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
        return eventandoEvent.products.map((product) => ({
          ...product,
          batches: product.batches || [],
        }));
      } catch (err) {
        // If Eventando Manager is unreachable, return empty
        return [];
      }
    },
    // Protect call_link: never expose directly in event queries
    // Users must use isUserSignedUp to get the link
    call_link: () => null,
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

        return {
          ...(managerEvent || {}),
          ...(eventandoEvent || {}),
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
        const events = await dataSources.eventandoIntegration.findEvents({
          filters: {
            or: [{ uuid: { eq: id } }, { id: { eq: id } }],
          },
        });
        const event = events.data[0];

        if (!event) {
          throw new Error(`Event with id "${id}" not found`);
        }

        const response = await dataSources.eventandoIntegration.updateEvent(
          event.id,
          data,
        );

        return response.data;
      } catch (err) {
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

export default Event;
