import dotenv from 'dotenv';

dotenv.config();

const Rate = {
  Rate: {
    id: ({ documentId }) => documentId,
  },

  Query: {
    rates: async (
      _,
      { filters, sort, pagination, search },
      { dataSources }
    ) => {
      try {
        const response = await dataSources.manager.findRates(
          filters,
          sort,
          pagination,
          search
        );
        return response;
      } catch (err) {
        throw new Error(`Error fetching rates: ${err.message}`);
      }
    },

    rate: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.findRateById(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching rate: ${err.message}`);
      }
    },
  },

  Mutation: {
    createRate: async (_, { input }, { dataSources }) => {
      try {
        const response = await dataSources.manager.createRate(input);
        return response.data;
      } catch (err) {
        throw new Error(`Error creating rate: ${err.message}`);
      }
    },

    updateRate: async (_, { id, input }, { dataSources }) => {
      try {
        const response = await dataSources.manager.updateRate(id, input);
        return response.data;
      } catch (err) {
        throw new Error(`Error updating rate: ${err.message}`);
      }
    },

    deleteRate: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.deleteRate(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting rate: ${err.message}`);
      }
    },
  },
};

export default Rate;
