import dotenv from 'dotenv';

dotenv.config();

const User = {
  User: {
    id: ({ documentId }) => documentId,

    agenda: async (parent, _, { dataSources }) => {
      if (!parent?.documentId) {
        return [];
      }
      try {
        const response = await dataSources.managerIntegration.findAgendas({
          filters: {
            users_permissions_user: { documentId: parent.documentId },
          },
          sort: [],
          pagination: {},
          search: '',
          populate: [
            'event',
            'event.images',
            'talks',
            'users_permissions_user',
          ],
        });
        return response?.data ?? [];
      } catch (err) {
        throw new Error(`Error fetching user agenda: ${err.message}`);
      }
    },
  },

  Query: {
    users: async (
      _,
      { filters, sort, pagination, search },
      { dataSources },
    ) => {
      try {
        const response = await dataSources.manager.findUsers(
          filters,
          sort,
          pagination,
          search,
        );
        return response;
      } catch (err) {
        throw new Error(`Error fetching users: ${err.message}`);
      }
    },

    user: async (_, { id }, { dataSources }) => {
      try {
        const response = await dataSources.manager.findUserById(id);
        return response.data;
      } catch (err) {
        throw new Error(`Error fetching user: ${err.message}`);
      }
    },

    userByUsername: async (_, { username }, { dataSources }) => {
      try {
        return await dataSources.manager.findUserByUsername(username);
      } catch (err) {
        throw new Error(`Error fetching user by username: ${err.message}`);
      }
    },
  },

  Mutation: {
    signIn: async (_, { identifier, password }, { dataSources }) => {
      try {
        const response = await dataSources.managerPublic.signIn({
          identifier,
          password,
        });

        const { jwt, user } = response.data;

        return {
          ...user,
          token: jwt,
        };
      } catch (err) {
        throw new Error(`Error signing in: ${err.message}`);
      }
    },

    signUp: async (_, { input }, { dataSources }) => {
      let speaker;

      const response = await dataSources.managerPublic.signUp({
        username: input.username,
        email: input.email,
        password: input.password,
        name: input.name,
        phone: input.phone || undefined,
      });

      const createdUser = response.data.user;

      if (createdUser) {
        try {
          const speakerResponse =
            await dataSources.managerIntegration.findSpeakers({
              filters: {
                email: createdUser.email,
              },
            });

          if (speakerResponse.data.length > 0) {
            [speaker] = speakerResponse.data;
          }
        } catch (err) {
          throw new Error(`Error fetching speaker: ${err.message}`);
        }
      }

      if (speaker) {
        try {
          const updatedSpeaker =
            await dataSources.managerIntegration.updateSpeaker(
              speaker.documentId,
              {
                users_permissions_user: {
                  set: [createdUser.documentId],
                },
              },
            );

          return {
            ...createdUser,
            speaker: updatedSpeaker.data,
          };
        } catch (err) {
          throw new Error(`Error updating speaker: ${err.message}`);
        }
      }

      if (!speaker) {
        try {
          const createdSpeaker =
            await dataSources.managerIntegration.createSpeaker({
              name: input.name,
              email: input.email,
              users_permissions_user: {
                set: [createdUser.documentId],
              },
            });

          return {
            ...createdUser,
            speaker: createdSpeaker.data,
          };
        } catch (err) {
          throw new Error(`Error creating speaker: ${err.message}`);
        }
      }

      return createdUser;
    },

    forwardPassword: async (_, { email }, { dataSources }) => {
      try {
        const response = await dataSources.managerPublic.forwardPassword({
          email,
        });
        return response.data.sent;
      } catch (err) {
        throw new Error(`Error forwarding password: ${err.message}`);
      }
    },

    resetPassword: async (_, { code, password, passwordConfirmation }, { dataSources }) => {
      try {
        await dataSources.managerPublic.resetPassword({
          code,
          password,
          passwordConfirmation,
        });
        return true;
      } catch (err) {
        throw new Error(`Error resetting password: ${err.message}`);
      }
    },

    updateUserPhone: async (_, { email, phone }, { dataSources }) => {
      try {
        // Find user by email using integration token to get Strapi integer ID
        const foundUser = await dataSources.managerIntegration.findUserByEmail(email);
        if (!foundUser) {
          throw new Error('Usuário não encontrado.');
        }

        // foundUser.id is the Strapi integer ID needed by the users-permissions API
        const strapiId = foundUser.id;
        const response = await dataSources.managerIntegration.updateUser(
          strapiId,
          { phone },
        );
        return response.data;
      } catch (err) {
        throw new Error(`Error updating user phone: ${err.message}`);
      }
    },

    updateProfile: async (_, { input }, { user, dataSources }) => {
      if (!user) {
        throw new Error('Não autenticado. Faça login novamente.');
      }

      try {
        // Build user update payload (only non-null fields)
        const userUpdate = {};
        if (input.name !== undefined && input.name !== null) userUpdate.name = input.name;
        if (input.phone !== undefined && input.phone !== null) userUpdate.phone = input.phone;
        if (input.cover_photo !== undefined) userUpdate.cover_photo = input.cover_photo;
        if (input.twitter !== undefined) userUpdate.twitter = input.twitter;
        if (input.linkedin !== undefined) userUpdate.linkedin = input.linkedin;
        if (input.github !== undefined) userUpdate.github = input.github;
        if (input.website !== undefined) userUpdate.website = input.website;
        if (input.instagram !== undefined) userUpdate.instagram = input.instagram;

        // Update user fields if there's anything to update
        let updatedUser = user;
        if (Object.keys(userUpdate).length > 0) {
          const response = await dataSources.managerIntegration.updateUser(
            user.id,
            userUpdate,
          );
          updatedUser = response.data || updatedUser;
        }

        // Update speaker avatar if provided
        if (input.avatar !== undefined && input.avatar !== null) {
          try {
            // Find speaker linked to this user
            const speakerResponse = await dataSources.managerIntegration.findSpeakers({
              filters: {
                users_permissions_user: { documentId: { eq: user.documentId } },
              },
            });

            if (speakerResponse.data && speakerResponse.data.length > 0) {
              const speaker = speakerResponse.data[0];
              await dataSources.managerIntegration.updateSpeaker(
                speaker.documentId,
                { avatar: input.avatar },
              );
            }
          } catch (speakerErr) {
            console.error('Error updating speaker avatar:', speakerErr.message);
            // Don't fail the whole mutation if speaker update fails
          }
        }

        return updatedUser;
      } catch (err) {
        throw new Error(`Error updating profile: ${err.message}`);
      }
    },
  },
};

export default User;

