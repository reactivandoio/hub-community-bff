import { requireAdmin } from '../../utils/auth';

// Admin management of voting sessions. Until now the admin pages wrote straight to
// Strapi without a token, so anyone could create, change or delete a session.

const SESSION_FIELDS = ['title', 'description', 'event_id', 'status', 'max_votes_per_user'];
const OPTION_FIELDS = ['name', 'description', 'pitch_order', 'voting_session'];

// Only the fields the schema declares reach Strapi; an absent field is left untouched.
export const pick = (input, fields) => fields.reduce((acc, field) => (
  input?.[field] === undefined ? acc : { ...acc, [field]: input[field] }
), {});

const byPitchOrder = (a, b) => (a?.pitch_order ?? 0) - (b?.pitch_order ?? 0);

const Voting = {
  VotingSession: {
    id: ({ documentId, id }) => documentId || (id != null ? String(id) : null),
    voting_options: ({ voting_options: options }) => (options || []).slice().sort(byPitchOrder),
  },

  VotingOption: {
    id: ({ documentId, id }) => documentId || (id != null ? String(id) : null),
  },

  Query: {
    votingSessions: async (_, __, ctx) => {
      requireAdmin(ctx);
      const response = await ctx.dataSources.managerIntegration.findVotingSessions();
      return response?.data || [];
    },

    votingSession: async (_, { id }, ctx) => {
      requireAdmin(ctx);
      const response = await ctx.dataSources.managerIntegration.findVotingSession(id);
      return response?.data || null;
    },
  },

  Mutation: {
    createVotingSession: async (_, { data }, ctx) => {
      requireAdmin(ctx);
      if (!data?.title?.trim()) throw new Error('Título é obrigatório.');
      const response = await ctx.dataSources.managerIntegration
        .createVotingSession(pick(data, SESSION_FIELDS));
      return response?.data || null;
    },

    updateVotingSession: async (_, { id, data }, ctx) => {
      requireAdmin(ctx);
      const response = await ctx.dataSources.managerIntegration
        .updateVotingSession(id, pick(data, SESSION_FIELDS));
      return response?.data || null;
    },

    deleteVotingSession: async (_, { id }, ctx) => {
      requireAdmin(ctx);
      await ctx.dataSources.managerIntegration.deleteVotingSession(id);
      return true;
    },

    createVotingOption: async (_, { data }, ctx) => {
      requireAdmin(ctx);
      if (!data?.name?.trim()) throw new Error('Nome é obrigatório.');
      if (!data?.voting_session) throw new Error('Sessão de votação é obrigatória.');
      const response = await ctx.dataSources.managerIntegration
        .createVotingOption(pick(data, OPTION_FIELDS));
      return response?.data || null;
    },

    updateVotingOption: async (_, { id, data }, ctx) => {
      requireAdmin(ctx);
      const response = await ctx.dataSources.managerIntegration
        .updateVotingOption(id, pick(data, OPTION_FIELDS));
      return response?.data || null;
    },

    deleteVotingOption: async (_, { id }, ctx) => {
      requireAdmin(ctx);
      await ctx.dataSources.managerIntegration.deleteVotingOption(id);
      return true;
    },
  },
};

export default Voting;
