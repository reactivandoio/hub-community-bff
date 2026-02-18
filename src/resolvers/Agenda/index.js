import dotenv from 'dotenv';

dotenv.config();

const Agenda = {
  Agenda: {
    id: ({ documentId }) => documentId,
    user: (parent) => parent.users_permissions_user,
  },

  Query: {
    agendas: async (
      _,
      { filters, sort, pagination, search },
      { dataSources, user },
    ) => {
      const customFilters = {
        ...filters,
        users_permissions_user: {
          documentId: user.documentId,
        },
      };

      try {
        const response = await dataSources.managerIntegration.findAgendas({
          filters: customFilters,
          sort,
          pagination,
          search,
          populate: ['event', 'talks', 'users_permissions_user'],
        });
        return response;
      } catch (err) {
        throw new Error(`Error fetching agendas: ${err.message}`);
      }
    },

    agenda: async (_, { id }, { dataSources, user }) => {
      try {
        const response = await dataSources.managerIntegration.findAgenda(id, {
          populate: ['event', 'talks', 'users_permissions_user'],
          fields: [
            'id',
            'documentId',
            'slug',
            'is_public',
            'createdAt',
            'updatedAt',
          ],
          publicationState: 'live',
        });

        // Check if the agenda belongs to the current user
        if (
          response.data.users_permissions_user?.documentId !== user.documentId
        ) {
          throw new Error('You do not have permission to access this agenda');
        }

        return response.data;
      } catch (err) {
        throw new Error(`Error fetching agenda: ${err.message}`);
      }
    },
  },

  Mutation: {
    createAgenda: async (_, { input }, { dataSources, user }) => {
      try {
        // Associate the agenda with the current user
        const agendaInput = {
          ...input,
          users_permissions_user: user.documentId,
        };

        const response = await dataSources.managerIntegration.createAgenda(
          agendaInput,
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error creating agenda: ${err.message}`);
      }
    },

    updateAgenda: async (_, { id, input }, { dataSources, user }) => {
      try {
        // First, check if the agenda belongs to the current user
        const existingAgenda = await dataSources.managerIntegration.findAgenda(
          id,
          {
            populate: ['users_permissions_user'],
            fields: ['id', 'documentId', 'users_permissions_user'],
            publicationState: 'live',
          },
        );

        if (
          existingAgenda.data.users_permissions_user?.documentId !==
          user.documentId
        ) {
          throw new Error('You do not have permission to update this agenda');
        }

        const dataToUpdate = {
          ...input,
          talks: {
            connect: input.talksToAdd || [],
            disconnect: input.talksToRemove || [],
          },
        };

        delete dataToUpdate.talksToAdd;
        delete dataToUpdate.talksToRemove;

        const response = await dataSources.managerIntegration.updateAgenda(
          id,
          dataToUpdate,
          {
            populate: ['users_permissions_user', 'event', 'talks'],
          },
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating agenda: ${err.message}`);
      }
    },

    deleteAgenda: async (_, { id }, { dataSources, user }) => {
      try {
        // First, check if the agenda belongs to the current user
        const existingAgenda = await dataSources.managerIntegration.findAgenda(
          id,
          {
            populate: ['users_permissions_user'],
            fields: ['id', 'documentId', 'users_permissions_user'],
            publicationState: 'live',
          },
        );

        if (
          existingAgenda.data.users_permissions_user?.documentId !==
          user.documentId
        ) {
          throw new Error('You do not have permission to delete this agenda');
        }

        const response = await dataSources.managerIntegration.deleteAgenda(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error deleting agenda: ${err.message}`);
      }
    },
  },
};

export default Agenda;
