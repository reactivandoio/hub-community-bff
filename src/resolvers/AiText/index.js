import { GraphQLError } from 'graphql';
import { canAccessAdmin, forbiddenError, requireUser } from '../../utils/auth';
import { loadSignupEventDetails } from '../../services/email/signup-confirmation';
import { eventUrlFor } from '../../services/email-campaign/render';
import { buildDraftPrompt, MAX_INSTRUCTIONS } from '../../services/termhub/prompt';
import { createTermhubService } from '../../services/termhub/generations';
import { requireCampaignAccess } from '../EmailCampaign';

// REA-51: "Gerar texto com IA" on the event's e-mail marketing page, with the termhub token each
// admin user saves in their AI settings. See services/termhub.

const requireAdminUser = (ctx) => {
  const user = requireUser(ctx);
  if (!canAccessAdmin(user)) throw forbiddenError();
  return user;
};

export const makeAiTextResolvers = ({ service = createTermhubService(), env = process.env } = {}) => ({
  Query: {
    termhubSettings: async (_, __, ctx) => service.getSettings(ctx.dataSources.managerIntegration, requireAdminUser(ctx)),
    aiTextGeneration: async (_, { id }, ctx) => service.get(ctx.dataSources.managerIntegration, requireAdminUser(ctx), id),
  },

  Mutation: {
    saveTermhubSettings: async (_, { input }, ctx) =>
      service.saveSettings(ctx.dataSources.managerIntegration, requireAdminUser(ctx), input || {}),
    testTermhubSettings: async (_, __, ctx) => service.testSettings(ctx.dataSources.managerIntegration, requireAdminUser(ctx)),
    deleteTermhubSettings: async (_, __, ctx) => service.deleteSettings(ctx.dataSources.managerIntegration, requireAdminUser(ctx)),

    generateEmailCampaignText: async (_, { input }, ctx) => {
      const user = requireAdminUser(ctx);
      await requireCampaignAccess(ctx, input.eventSlug, input.type);
      const instructions = String(input.instructions || '').trim();
      if (instructions.length > MAX_INSTRUCTIONS) {
        throw new GraphQLError(`O pedido para a IA pode ter até ${MAX_INSTRUCTIONS} caracteres.`, { extensions: { code: 'BAD_USER_INPUT' } });
      }
      const integration = ctx.dataSources.managerIntegration;
      const event = await integration.findEventWithOrganizers(String(input.eventSlug));
      if (!event) throw new GraphQLError('Evento não encontrado.', { extensions: { code: 'BAD_USER_INPUT' } });
      const details = await loadSignupEventDetails({ dataSources: ctx.dataSources, eventSlug: event.slug });
      const prompt = buildDraftPrompt({
        type: input.type,
        event: { ...details, title: details.title || event.title },
        eventUrl: eventUrlFor(env, event.slug, input.type),
        current: { subject: input.subject, message: input.message },
        instructions,
      });
      return service.start(integration, user, { event, type: input.type, prompt, requestId: input.requestId });
    },

    cancelAiTextGeneration: async (_, { id }, ctx) => service.cancel(ctx.dataSources.managerIntegration, requireAdminUser(ctx), id),
  },
});

export default makeAiTextResolvers();
