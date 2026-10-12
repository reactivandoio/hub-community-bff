import dotenv from 'dotenv';
import { requireAuthorOrAdmin, requireUser } from '../../utils/auth';

dotenv.config();

const requireReplyAuthor = async (ctx, id) => {
  requireUser(ctx);
  const reply = await ctx.dataSources.managerIntegration.findCommentReplyWithAuthor(id).catch(() => null);
  if (!reply) throw new Error('Resposta não encontrada.');
  requireAuthorOrAdmin(ctx, reply.user_creator?.documentId);
};

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
    // The author is always the signed-in user, whatever `user_creator` the input carries.
    createCommentReply: async (_, { input }, ctx) => {
      const user = requireUser(ctx);
      try {
        const response = await ctx.dataSources.managerIntegration.createCommentReplyAsIntegration({
          ...input,
          user_creator: user.documentId,
        });
        return response.data;
      } catch (err) {
        throw new Error(`Error creating comment reply: ${err.message}`);
      }
    },

    updateCommentReply: async (_, { id, input }, ctx) => {
      await requireReplyAuthor(ctx, id);
      // The author of a reply never changes.
      const { user_creator: _ignored, ...data } = input;
      try {
        const response = await ctx.dataSources.managerIntegration.updateCommentReplyAsIntegration(
          id,
          data
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating comment reply: ${err.message}`);
      }
    },

    deleteCommentReply: async (_, { id }, ctx) => {
      await requireReplyAuthor(ctx, id);
      try {
        const response = await ctx.dataSources.managerIntegration.deleteCommentReplyAsIntegration(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting comment reply: ${err.message}`);
      }
    },
  },
};

export default CommentReply;
