import dotenv from 'dotenv';
import { GraphQLError } from 'graphql';
import { isValidCpf, normalizeIdentifier } from '../Certificate/eligibility';
import { requireAdmin } from '../../utils/auth';
import { adultDateOfBirth, requireAdultDeclaration } from '../../utils/age';
import { requestLoginCode, verifyLoginCode } from '../../services/login-code';

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
      ctx,
    ) => {
      requireAdmin(ctx);
      const { dataSources } = ctx;
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

    // The authenticated user's own profile (includes cpf / date_of_birth, which the
    // public user queries must not expose). Read fresh: the context user is cached per
    // process and may be stale after a profile update.
    me: async (_, __, { user, dataSources }) => {
      if (!user) return null;
      const response = await dataSources.managerAuthenticated.fetchMe();
      return response?.data ?? null;
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
    // REA-26: login (and signup) by a code e-mailed — services/login-code.
    requestLoginCode: (_, { email }, { dataSources, clientIp }) =>
      requestLoginCode({ dataSources, email, clientIp }),

    verifyLoginCode: (_, { email, code }, { dataSources, clientIp }) =>
      verifyLoginCode({ dataSources, email, code, clientIp }),

    updateUserPhone: async (_, { email, phone }, { user, dataSources }) => {
      if (!user) {
        throw new Error('Não autenticado. Faça login novamente.');
      }
      try {
        const response = await dataSources.managerAuthenticated.updateUser(
          user.id,
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
        // Certificate data: CPF is stored as digits only, date of birth as ISO yyyy-mm-dd.
        if (input.cpf !== undefined && input.cpf !== null) {
          if (!isValidCpf(input.cpf)) throw new Error('CPF inválido.');
          userUpdate.cpf = normalizeIdentifier(input.cpf);
        }
        // REA-36: the date of birth must be of someone aged 18+.
        const dateOfBirth = adultDateOfBirth(input.date_of_birth);
        if (dateOfBirth) userUpdate.date_of_birth = dateOfBirth;
        // The "18 anos ou mais" checkbox of the complete-profile form: required while the
        // account has not declared it yet and the form sends a date of birth.
        if (input.adult_declaration === true) userUpdate.adult_declaration = true;
        else if (dateOfBirth && user.adult_declaration !== true) requireAdultDeclaration(input.adult_declaration);
        // REA-29/REA-26: the optional "quero receber novidades" box; the backend stamps the date.
        if (input.marketing_opt_in === true) userUpdate.marketing_opt_in = true;
        if (input.cover_photo !== undefined) userUpdate.cover_photo = input.cover_photo;
        if (input.twitter !== undefined) userUpdate.twitter = input.twitter;
        if (input.linkedin !== undefined) userUpdate.linkedin = input.linkedin;
        if (input.github !== undefined) userUpdate.github = input.github;
        if (input.website !== undefined) userUpdate.website = input.website;
        if (input.instagram !== undefined) userUpdate.instagram = input.instagram;

        // Update user fields if there's anything to update
        let updatedUser = user;
        if (Object.keys(userUpdate).length > 0) {
          const response = await dataSources.managerAuthenticated.updateUser(
            user.id,
            userUpdate,
          );
          updatedUser = response.data || updatedUser;
        }

        // REA-26: an account created by a login code gets its speaker without a name; the
        // complete-profile form brings it. Never overwrites a name the speaker already has.
        if (userUpdate.name) {
          try {
            const speakerResponse = await dataSources.managerIntegration.findSpeakers({
              filters: { users_permissions_user: { documentId: { eq: user.documentId } } },
            });
            const [speaker] = speakerResponse?.data || [];
            if (speaker && !String(speaker.name || '').trim()) {
              await dataSources.managerIntegration.updateSpeaker(speaker.documentId, { name: userUpdate.name });
            }
          } catch (speakerErr) {
            console.error('Error updating speaker name:', speakerErr.message);
          }
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
        // REA-36: age and declaration errors reach the form as they are (code + pt-BR message).
        if (err instanceof GraphQLError) throw err;
        throw new Error(`Error updating profile: ${err.message}`);
      }
    },
  },
};

export default User;

