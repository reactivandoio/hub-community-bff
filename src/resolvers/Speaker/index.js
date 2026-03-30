import dotenv from 'dotenv';

dotenv.config();

const Speaker = {
  Speaker: {
    id: ({ documentId }) => documentId,
    avatar: ({ avatar }) => {
      if (!avatar) return null;
      if (typeof avatar === 'string') {
        return avatar.startsWith('http')
          ? avatar
          : `${process.env.MANAGER_URL}${avatar}`;
      }
      return avatar?.url ? `${process.env.MANAGER_URL}${avatar.url}` : null;
    },
  },

  Query: {
    speakers: async (
      _,
      { filters, sort, pagination, search },
      { dataSources },
    ) => {
      try {
        const response = await dataSources.managerIntegration.findSpeakers({
          filters,
          sort,
          pagination,
          search,
          populate: ['talks', 'avatar'],
        });
        return response;
      } catch (err) {
        throw new Error(`Error fetching speakers: ${err.message}`);
      }
    },

    speaker: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.findSpeakerById(
          id,
          ['talks', 'avatar'],
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching speaker: ${err.message}`);
      }
    },
  },

  Mutation: {
    createSpeaker: async (_, { data }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.createSpeaker(
          data,
          ['talks', 'avatar'],
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error creating speaker: ${err.message}`);
      }
    },
    updateSpeaker: async (_, { id, data }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.updateSpeaker(
          id,
          data,
          ['talks', 'avatar'],
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating speaker: ${err.message}`);
      }
    },
    deleteSpeaker: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.deleteSpeakerById(
          id,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting speaker: ${err.message}`);
      }
    },
  },
};

export default Speaker;
