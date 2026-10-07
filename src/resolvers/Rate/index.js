import dotenv from 'dotenv';
import { requireAuthorOrAdmin, requireUser } from '../../utils/auth';

dotenv.config();

const requireRateAuthor = async (ctx, id) => {
  requireUser(ctx);
  const rate = await ctx.dataSources.managerIntegration.findRateWithAuthor(id).catch(() => null);
  if (!rate) throw new Error('Avaliação não encontrada.');
  requireAuthorOrAdmin(ctx, rate.users_permissions_user?.documentId);
};

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
    // The rate belongs to the signed-in user, whatever `user` the input carries.
    createRate: async (_, { input }, ctx) => {
      const user = requireUser(ctx);
      const { user: _ignored, ...data } = input;
      try {
        const response = await ctx.dataSources.managerIntegration.createRateAsIntegration({
          ...data,
          users_permissions_user: user.documentId,
        });
        return response.data;
      } catch (err) {
        throw new Error(`Error creating rate: ${err.message}`);
      }
    },

    updateRate: async (_, { id, input }, ctx) => {
      await requireRateAuthor(ctx, id);
      // The author of a rate never changes.
      const { user: _ignored, ...data } = input;
      try {
        const response = await ctx.dataSources.managerIntegration.updateRateAsIntegration(id, data);
        return response.data;
      } catch (err) {
        throw new Error(`Error updating rate: ${err.message}`);
      }
    },

    deleteRate: async (_, { id }, ctx) => {
      await requireRateAuthor(ctx, id);
      try {
        const response = await ctx.dataSources.managerIntegration.deleteRateAsIntegration(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting rate: ${err.message}`);
      }
    },
  },
};

export default Rate;
