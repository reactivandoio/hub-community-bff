import dotenv from 'dotenv';

dotenv.config();

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
      return events;
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
          populate: [
            'events',
            'tags',
            'location',
            'organizers',
            'images',
            'links',
          ],
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
          ['events', 'tags', 'location', 'organizers', 'images', 'links'],
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
          populate: [
            'events',
            'tags',
            'location',
            'organizers',
            'images',
            'links',
          ],
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
    createCommunity: async (_, { data }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.createCommunity(
          data,
          ['events', 'tags', 'location', 'organizers', 'images', 'links'],
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error creating community: ${err.message}`);
      }
    },
    updateCommunity: async (_, { id, data }, { dataSources }) => {
      try {
        const response = await dataSources.managerIntegration.updateCommunity(
          id,
          data,
          ['events', 'tags', 'location', 'organizers', 'images', 'links'],
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating community: ${err.message}`);
      }
    },
    deleteCommunity: async (_, { id }, { dataSources }) => {
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
