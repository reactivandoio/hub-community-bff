import dotenv from 'dotenv';

dotenv.config();

const Talk = {
  Talk: {
    id: ({ documentId }) => documentId,
  },

  Query: {
    talks: async (
      _,
      { filters, sort, pagination, search },
      { dataSources },
    ) => {
      try {
        const response = await dataSources.managerIntegration.findTalks({
          filters,
          sort,
          pagination,
          search,
          populate: ['speakers', 'speakers.avatar', 'event'],
        });
        return response;
      } catch (err) {
        throw new Error(`Error fetching talks: ${err.message}`);
      }
    },

    talk: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.findTalkById(id, [
          'speakers',
          'speakers.avatar',
          'event',
        ]);
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching talk: ${err.message}`);
      }
    },
  },

  Mutation: {
    createTalk: async (_, { data }, { dataSources }) => {
      try {
        const payload = {
          title: data.title,
          description: data.description,
          occur_date: data.occur_date,
          room_description: data.room_description,
          highlight: data.highlight,
          subtitle: data.subtitle,
          speakers: data.speakers,
          event: data.event,
        };

        const response = await dataSources.managerIntegration.createTalk(
          payload,
          ['event', 'speakers'],
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error creating talk: ${err.message}`);
      }
    },
    updateTalk: async (_, { id, data }, { dataSources }) => {
      try {
        const payload = {
          title: data.title,
          description: data.description,
          occur_date: data.occur_date,
          room_description: data.room_description,
          highlight: data.highlight,
          subtitle: data.subtitle,
          speakers: data.speakers,
          event: data.event,
        };

        const response = await dataSources.managerIntegration.updateTalk(
          id,
          payload,
          ['event', 'speakers'],
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating talk: ${err.message}`);
      }
    },
    deleteTalk: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.deleteTalk(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting talk: ${err.message}`);
      }
    },
  },
};

export default Talk;
