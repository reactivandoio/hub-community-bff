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
        const response = await dataSources.manager.findCommunities(
          filters,
          sort,
          pagination,
          search,
        );
        return response;
      } catch (err) {
        throw new Error(`Error fetching communities: ${err.message}`);
      }
    },

    community: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.findCommunityById(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching community: ${err.message}`);
      }
    },

    communityBySlugOrId: async (_, { slugOrId }, { dataSources }) => {
      try {
        const response = await dataSources.manager.findCommunities(
          {
            or: [
              { slug: { eq: slugOrId } },
              { documentId: { eq: slugOrId } },
              { id: { eq: slugOrId } },
            ],
          },
          [],
          { limit: 1 },
        );

        if (!response?.data || response.data.length === 0) {
          throw new Error(`Community not found with slug or ID: ${slugOrId}`);
        }

        return response.data[0];
      } catch (err) {
        throw new Error(`Error fetching community: ${err.message}`);
      }
    },
  },
};

export default Community;
