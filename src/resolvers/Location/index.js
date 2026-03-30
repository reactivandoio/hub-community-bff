import dotenv from 'dotenv';

dotenv.config();

const Location = {
  Location: {
    id: ({ documentId }) => documentId,
  },

  Query: {
    locations: async (
      _,
      { filters, sort, pagination, search },
      { dataSources },
    ) => {
      try {
        const response = await dataSources.manager.findLocations(
          filters,
          sort,
          pagination,
          search,
        );
        return response;
      } catch (err) {
        throw new Error(`Error fetching locations: ${err.message}`);
      }
    },

    location: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.findLocationById(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching location: ${err.message}`);
      }
    },
  },

  Mutation: {
    createLocation: async (_, { data }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.createLocation(
          data,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error creating location: ${err.message}`);
      }
    },
    updateLocation: async (_, { id, data }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.updateLocation(
          id,
          data,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating location: ${err.message}`);
      }
    },
    deleteLocation: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.deleteLocation(
          id,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting location: ${err.message}`);
      }
    },
  },
};

export default Location;
