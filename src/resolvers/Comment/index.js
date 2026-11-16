import dotenv from 'dotenv';
import { requireAuthorOrAdmin, requireUser } from '../../utils/auth';
import { withoutPersonalFilters } from '../../utils/personal-filters';

// REA-56: the comments are read with the integration token, so the caller only chooses among
// these relations (the authors go through the User type, which hides their personal data).
export const COMMENT_POPULATE = ['talk', 'event', 'user_creator', 'users_tagged'];

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
          filters: withoutPersonalFilters(filters),
          sort,
          pagination,
          search,
          populate: (populate || []).filter((item) => COMMENT_POPULATE.includes(item)),
        });
        return response;
      } catch (err) {
        throw new Error(`Error fetching comments: ${err.message}`);
      }
    },
  },

  Mutation: {
    createComment: async (_, { input }, ctx) => {
      const user = requireUser(ctx);
      const { createComment } = ctx.dataSources.managerIntegration;

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

    // Declared in the schema long ago, never implemented until now: the author or an admin.
    deleteComment: async (_, { id }, ctx) => {
      requireUser(ctx);
      const { managerIntegration } = ctx.dataSources;
      const comment = await managerIntegration.findCommentWithAuthor(id).catch(() => null);
      if (!comment) throw new Error('Comentário não encontrado.');
      requireAuthorOrAdmin(ctx, comment.user_creator?.documentId);
      try {
        await managerIntegration.deleteComment(id);
        return true;
      } catch (err) {
        throw new Error(`Error deleting comment: ${err.message}`);
      }
    },
  },
};

export default Comment;
