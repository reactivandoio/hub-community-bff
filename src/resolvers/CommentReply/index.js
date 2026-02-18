import dotenv from 'dotenv';

dotenv.config();

const CommentReply = {
  CommentReply: {
    id: ({ documentId }) => documentId,
  },

  Query: {
    commentReplies: async (
      _,
      { filters, sort, pagination, search },
      { dataSources }
    ) => {
      try {
        const response = await dataSources.manager.findCommentReplies(
          filters,
          sort,
          pagination,
          search
        );
        return response;
      } catch (err) {
        throw new Error(`Error fetching comment replies: ${err.message}`);
      }
    },

    commentReply: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.findCommentReplyById(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching comment reply: ${err.message}`);
      }
    },
  },

  Mutation: {
    createCommentReply: async (_, { input }, { dataSources }) => {
      try {
        const response = await dataSources.manager.createCommentReply(input);
        return response.data;
      } catch (err) {
        throw new Error(`Error creating comment reply: ${err.message}`);
      }
    },

    updateCommentReply: async (_, { id, input }, { dataSources }) => {
      try {
        const response = await dataSources.manager.updateCommentReply(
          id,
          input
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating comment reply: ${err.message}`);
      }
    },

    deleteCommentReply: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.deleteCommentReply(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting comment reply: ${err.message}`);
      }
    },
  },
};

export default CommentReply;
