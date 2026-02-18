import dotenv from 'dotenv';

dotenv.config();

const Comment = {
  Comment: {
    comment: ({ message }) => message,
    user: (parent) => parent.user_creator,
  },
  Query: {
    comments: async (
      _,
      { filters, sort, pagination, search, populate },
      { dataSources },
    ) => {
      try {
        const response = await dataSources.managerIntegration.findComments({
          filters,
          sort,
          pagination,
          search,
          populate,
        });
        return response;
      } catch (err) {
        throw new Error(`Error fetching comments: ${err.message}`);
      }
    },
  },

  Mutation: {
    createComment: async (_, { input }, { dataSources, user }) => {
      const { createComment } = dataSources.managerIntegration;

      const data = {
        user_creator: {
          set: [user.documentId],
        },
        talk: {
          set: [input.talk_id],
        },
        message: input.comment,
      };

      try {
        const response = await createComment(data);
        return response.data;
      } catch (err) {
        throw new Error(`Error creating comment: ${err.message}`);
      }
    },
  },
};

export default Comment;
