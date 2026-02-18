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
      let managerResponse;

      try {
        managerResponse = await dataSources.managerIntegration.createEvent({
          title: data.title,
          description: data.description,
          start_date: data.start_date,
          end_date: data.end_date,
        });
      } catch (err) {
        throw new Error(`Error creating event in manager: ${err.message}`);
      }

      try {
        const { documentId } = managerResponse.data;

        const response = await dataSources.eventandoIntegration.createEvent({
          ...data,
          uuid: documentId,
          name: data.title,
        });

        return response.data;
      } catch (err) {
        throw new Error(`Error creating event in eventando: ${err.message}`);
      }
    },

    updateEvent: async (_, { id, data }, { dataSources }) => {
      try {
        const response = await dataSources.eventandoIntegration.updateEvent(
          id,
          data,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating event: ${err.message}`);
      }
    },

    deleteEvent: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.eventandoIntegration.deleteEvent(id);
        return response.data;
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
        const response = await dataSources.eventandoIntegration.signup(
          eventId,
          {
            name,
            email,
            batch_id: parseInt(batch_id, 10),
            coupon_code,
            is_student,
            phone_number,
            t_shirt_size,
          },
        );

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
