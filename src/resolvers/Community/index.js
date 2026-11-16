import dotenv from 'dotenv';
import {
  requireAdmin,
  requireCommunityOrganizer,
} from '../../utils/auth';

dotenv.config();

// REA-54: a person's photo is the avatar of their speaker profile (Speaker.avatar resolves the
// media to a URL). Without `organizers.speaker.avatar` the community page has no photo to show.
export const COMMUNITY_POPULATE = [
  'events',
  'tags',
  'location',
  'organizers',
  'organizers.speaker',
  'organizers.speaker.avatar',
  'images',
  'links',
];

const Community = {
  Community: {
    id: ({ documentId }) => documentId,
    images: ({ images }) => {
      if (!images || !Array.isArray(images)) return [];
      return images
        .map((image) => {
          if (typeof image === 'string') {
            return image.startsWith('http')
              ? image
              : `${process.env.MANAGER_URL}${image}`;
          }
          return image?.url ? `${process.env.MANAGER_URL}${image.url}` : null;
        })
        .filter(Boolean);
    },
    links: ({ links }) => {
      if (!links || !Array.isArray(links)) return [];
      return links
        .map((link) => {
          if (typeof link === 'string') {
            return link;
          }
          return { id: link.id, name: link.title, url: link.value } || null;
        })
        .filter(Boolean);
    },
    organizers: ({ organizers }) => {
      if (!organizers || !Array.isArray(organizers)) return [];
      return organizers;
    },
    events: ({ events }) => {
      if (!events || !Array.isArray(events)) return [];
      // An unlisted event is hidden from the public listings, and the community
      // page (plus the "next event" date on its card) is one of them.
      return events.filter((event) => event?.unlisted !== true);
    },
    tags: ({ tags }) => {
      if (!tags || !Array.isArray(tags)) return [];
      return tags;
    },
  },

  Query: {
    communities: async (
      _,
      { filters, sort, pagination, search },
      { dataSources },
    ) => {
      try {
        const response = await dataSources.managerIntegration.findCommunities({
          filters,
          sort,
          pagination,
          search,
          populate: COMMUNITY_POPULATE,
        });
        return response;
      } catch (err) {
        throw new Error(`Error fetching communities: ${err.message}`);
      }
    },

    community: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.findCommunityById(
          id,
          COMMUNITY_POPULATE,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching community: ${err.message}`);
      }
    },

    communityBySlugOrId: async (_, { slugOrId }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.findCommunities({
          filters: {
            or: [
              { slug: { eq: slugOrId } },
              { documentId: { eq: slugOrId } },
              { id: { eq: slugOrId } },
            ],
          },
          pagination: { pageSize: 1 },
          populate: COMMUNITY_POPULATE,
        });

        if (!response?.data || response.data.length === 0) {
          throw new Error(`Community not found with slug or ID: ${slugOrId}`);
        }

        return response.data[0];
      } catch (err) {
        throw new Error(`Error fetching community: ${err.message}`);
      }
    },
  },

  Mutation: {
    createCommunity: async (_, { data }, ctx) => {
      requireAdmin(ctx);
      const { dataSources } = ctx;
      try {
        const response = await dataSources.managerIntegration.createCommunity(
          data,
          COMMUNITY_POPULATE,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error creating community: ${err.message}`);
      }
    },
    updateCommunity: async (_, { id, data }, ctx) => {
      await requireCommunityOrganizer(ctx, id);
      const { dataSources } = ctx;
      try {
        const response = await dataSources.managerIntegration.updateCommunity(
          id,
          data,
          COMMUNITY_POPULATE,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating community: ${err.message}`);
      }
    },
    deleteCommunity: async (_, { id }, ctx) => {
      await requireCommunityOrganizer(ctx, id);
      const { dataSources } = ctx;
      try {
        const response = await dataSources.managerIntegration.deleteCommunity(
          id,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting community: ${err.message}`);
      }
    },
  },
};

export default Community;
