import dotenv from 'dotenv';
import { isAdmin, requireAdmin } from '../../utils/auth';
import {
  linkSpeakerAccount,
  speakerAccountReview,
  unlinkSpeakerAccount,
} from '../../services/speaker-account';

const toAccount = (user) => (user?.documentId
  ? {
    id: user.id != null ? String(user.id) : null,
    documentId: user.documentId,
    name: user.name || null,
    email: user.email || null,
    username: user.username || null,
  }
  : null);

dotenv.config();

const Speaker = {
  Speaker: {
    id: ({ documentId }) => documentId,
    // REA-53: e-mail and account are the admin's only.
    email: ({ email }, _, ctx) => (isAdmin(ctx?.user) ? email || null : null),
    account: ({ users_permissions_user: user }, _, ctx) => (isAdmin(ctx?.user) ? toAccount(user) : null),
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
      { dataSources, user },
    ) => {
      try {
        const response = await dataSources.managerIntegration.findSpeakers({
          // Deleted speakers (soft delete) are not listed.
          filters: { ...(filters || {}), deleted_at: { null: true } },
          sort,
          pagination,
          search,
          // REA-53: the admin's list shows which account each speaker is.
          populate: isAdmin(user) ? ['talks', 'avatar', 'users_permissions_user'] : ['talks', 'avatar'],
        });
        return response;
      } catch (err) {
        throw new Error(`Error fetching speakers: ${err.message}`);
      }
    },

    speakerAccountReview: (_, __, ctx) => speakerAccountReview(ctx),

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
    linkSpeakerAccount: (_, args, ctx) => linkSpeakerAccount(ctx, args),
    unlinkSpeakerAccount: (_, args, ctx) => unlinkSpeakerAccount(ctx, args),
    createSpeaker: async (_, { data }, ctx) => {
      requireAdmin(ctx);
      const { dataSources } = ctx;
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
    updateSpeaker: async (_, { id, data }, ctx) => {
      requireAdmin(ctx);
      const { dataSources } = ctx;
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
    deleteSpeaker: async (_, { id }, ctx) => {
      requireAdmin(ctx);
      const { dataSources } = ctx;
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
