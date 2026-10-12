import { GraphQLError } from 'graphql';
import {
  requireEventOrganizer, requireUser, isAdmin, isCommunityManager, organizerIdsOfEvent,
} from '../../utils/auth';
import {
  createOpaPingouEventando, OpaPingouConnectionError,
} from '../../dataSources/eventando-manager/opapingou';

// REA-12: the Opa Pingou account of each event. The key goes from the admin straight to the
// Eventando, which validates it, registers the webhook and keeps it encrypted; nothing here
// returns, stores or logs it.

// Events checked per request when filtering the reusable accounts of a community-manager.
const MAX_ORGANIZER_CHECKS = 100;

const toConnection = (c) => c && {
  id: c.id,
  companyName: c.company_name || null,
  companyDocument: c.company_document || null,
  testMode: Boolean(c.test_mode),
  keyLast4: c.key_last4 || null,
  createdByName: c.created_by_name || null,
  createdAt: c.created_at || null,
};

const toGraphQLError = (err) => {
  if (err instanceof OpaPingouConnectionError) {
    return new GraphQLError(err.message, {
      extensions: {
        code: `OPAPINGOU_${err.code}`,
        ...(err.missing ? { missing: err.missing } : {}),
        ...(err.count !== null ? { count: err.count } : {}),
      },
    });
  }
  if (err instanceof GraphQLError) return err;
  console.error(`[opapingou] conta do evento: ${err.message}`);
  return new GraphQLError('Não conseguimos falar com o sistema de pagamentos agora. Tente de novo em instantes.', {
    extensions: { code: 'OPAPINGOU_UNAVAILABLE' },
  });
};

// The Hub event's documentId: it is the event's uuid in the Eventando.
const eventUuidOf = async (ctx, eventId) => {
  const event = await ctx.dataSources.managerIntegration.findEventWithOrganizers(String(eventId));
  if (!event?.documentId) {
    throw new GraphQLError('Evento não encontrado.', { extensions: { code: 'NOT_FOUND' } });
  }
  return event.documentId;
};

// Strict: the lookup also matches slugs, so a slug equal to another event's documentId must not
// count as organizing that event.
const organizesEvent = async (ctx, user, uuid) => {
  const event = await ctx.dataSources.managerIntegration.findEventWithOrganizers(String(uuid));
  return event?.documentId === uuid && organizerIdsOfEvent(event).has(user.documentId);
};

const reusableFor = async (ctx, all) => {
  const user = requireUser(ctx);
  if (isAdmin(user)) return all;
  if (!isCommunityManager(user)) return [];
  let checks = 0;
  const allowed = [];
  for (const connection of all) {
    if (connection.created_by && connection.created_by === user.documentId) {
      allowed.push(connection);
    } else {
      for (const uuid of connection.event_uuids || []) {
        if (checks >= MAX_ORGANIZER_CHECKS) break;
        checks += 1;
        // eslint-disable-next-line no-await-in-loop
        if (await organizesEvent(ctx, user, uuid)) {
          allowed.push(connection);
          break;
        }
      }
    }
  }
  return allowed;
};

const accountOf = async (ctx, eventando, uuid, current) => {
  let state = current;
  if (!state) {
    try {
      state = await eventando.eventConnection(uuid);
    } catch (err) {
      if (err instanceof OpaPingouConnectionError && err.code === 'EVENT_NOT_FOUND') {
        return { connection: null, legacy: false, available: false, reusable: [] };
      }
      throw err;
    }
  }
  const reusable = await reusableFor(ctx, await eventando.listConnections());
  return {
    connection: toConnection(state.connection),
    legacy: Boolean(state.legacy),
    available: true,
    reusable: reusable.map(toConnection),
  };
};

const withEvent = (fn) => async (_, args, ctx) => {
  await requireEventOrganizer(ctx, args.eventId);
  const eventando = ctx.opaPingouEventando || createOpaPingouEventando();
  try {
    const uuid = await eventUuidOf(ctx, args.eventId);
    return await fn({ args, ctx, eventando, uuid });
  } catch (err) {
    throw toGraphQLError(err);
  }
};

export default {
  Query: {
    eventOpaPingouAccount: withEvent(({ ctx, eventando, uuid }) => accountOf(ctx, eventando, uuid)),
  },
  Mutation: {
    connectEventOpaPingou: withEvent(async ({ args, ctx, eventando, uuid }) => {
      const user = requireUser(ctx);
      const connection = await eventando.connect({
        eventUuid: uuid,
        apiKey: String(args.apiKey || '').trim(),
        createdBy: user.documentId || null,
        createdByName: user.name || user.username || null,
      });
      return accountOf(ctx, eventando, uuid, { connection, legacy: false });
    }),

    useOpaPingouConnection: withEvent(async ({ args, ctx, eventando, uuid }) => {
      const allowed = await reusableFor(ctx, await eventando.listConnections());
      if (!allowed.some((c) => c.id === args.connectionId)) {
        throw new GraphQLError('Você não pode usar esta conta Opa Pingou neste evento.', { extensions: { code: 'FORBIDDEN' } });
      }
      const connection = await eventando.attach(uuid, args.connectionId);
      return accountOf(ctx, eventando, uuid, { connection, legacy: false });
    }),

    disconnectEventOpaPingou: withEvent(async ({ ctx, eventando, uuid }) => {
      const state = await eventando.detach(uuid);
      return accountOf(ctx, eventando, uuid, state);
    }),
  },
};
