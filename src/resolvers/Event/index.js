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
    products: ({ products }) => {
      if (!products || !Array.isArray(products)) return [];
      return products.map((product) => ({
        ...product,
        batches: product.batches || [],
      }));
    },
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
        const response = await dataSources.eventandoIntegration.signup(eventId, {
          name,
          email,
          batch_id: parseInt(batch_id, 10),
          coupon_code,
          is_student,
          phone_number,
          t_shirt_size,
        });

        if (response.error) {
          return {
            success: false,
            message: response.error.message || 'Error signing up',
            payment: null,
          };
        }

        return {
          success: true,
          message: 'Signed up successfully',
          payment: response.data,
        };
      } catch (err) {
        return {
          success: false,
          message: err.message,
          payment: null,
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
