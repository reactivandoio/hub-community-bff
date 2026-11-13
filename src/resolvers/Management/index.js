// REA-48 — organizers of a community and managers of an event, by invite (services/management-invite).
import {
  acceptInvite,
  communityOrganizers,
  eventManagers,
  inviteCommunityOrganizer,
  inviteEventManager,
  previewInvite,
  removeCommunityOrganizer,
  removeEventManager,
  revokeInvite,
} from '../../services/management-invite';

const Management = {
  Query: {
    communityOrganizers: (_, { communityId }, ctx) => communityOrganizers(ctx, { communityId }),
    eventManagers: (_, { eventId }, ctx) => eventManagers(ctx, { eventId }),
    managementInvite: (_, { token }, { dataSources }) => previewInvite(dataSources, { token }),
  },
  Mutation: {
    inviteCommunityOrganizer: (_, { communityId, email }, ctx) =>
      inviteCommunityOrganizer(ctx, { communityId, email }),
    removeCommunityOrganizer: (_, { communityId, userId }, ctx) =>
      removeCommunityOrganizer(ctx, { communityId, userId: String(userId) }),
    inviteEventManager: (_, { eventId, email }, ctx) => inviteEventManager(ctx, { eventId, email }),
    removeEventManager: (_, { eventId, userId }, ctx) =>
      removeEventManager(ctx, { eventId, userId: String(userId) }),
    revokeManagementInvite: (_, { id }, ctx) => revokeInvite(ctx, { id }),
    acceptManagementInvite: (_, { token }, ctx) => acceptInvite(ctx, { token }),
  },
};

export default Management;
