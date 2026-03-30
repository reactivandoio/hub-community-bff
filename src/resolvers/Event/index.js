import dotenv from 'dotenv';
import pubsub from '../../dataSources/pubsub';

dotenv.config();

const Event = {
  Event: {
    id: ({ documentId }) => documentId,
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
      try {
        // Try to find by slug OR documentId OR id
        const filters = {
          or: [
            { slug: { eq: slugOrId } },
            { documentId: { eq: slugOrId } },
            { id: { eq: slugOrId } },
          ],
        };
        const response = await dataSources.manager.findEvents(filters);

        if (!response.data || response.data.length === 0) {
          throw new Error(`Event with slug or id "${slugOrId}" not found`);
        }

        return response.data[0];
      } catch (err) {
        throw new Error(`Error fetching event: ${err}`);
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
      try {
        // Create in Hub Community Manager
        const hubResponse = await dataSources.managerIntegration.createEvent(data);

        // Create in Eventando Manager (mapping title to name)
        const eventandoData = {
          ...data,
          name: data.title,
        };
        delete eventandoData.title;
        delete eventandoData.is_online;
        delete eventandoData.call_link;
        await dataSources.eventandoIntegration.createEvent(eventandoData);

        return hubResponse.data;
      } catch (err) {
        throw new Error(`Error creating event: ${err.message}`);
      }
    },

    updateEvent: async (_, { id, data }, { dataSources }) => {
      try {
        // Find current event to get the slug for orchestration
        const currentEventResponse = await dataSources.manager.findEventById(id);
        const slug = currentEventResponse?.data?.attributes?.slug || data.slug;

        if (!slug) {
          throw new Error('Event slug is required for orchestration');
        }

        // Update in Hub Community Manager
        const hubResponse = await dataSources.managerIntegration.updateEvent(
          id,
          data,
        );

        // Update in Eventando Manager using slug (mapping title to name)
        const eventandoData = {
          ...data,
          name: data.title,
        };
        delete eventandoData.title;
        delete eventandoData.is_online;
        delete eventandoData.call_link;
        await dataSources.eventandoIntegration.updateEventBySlug(slug, eventandoData);

        return hubResponse.data;
      } catch (err) {
        throw new Error(`Error updating event: ${err.message}`);
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
