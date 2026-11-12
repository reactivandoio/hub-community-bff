import { requireEventOrganizer } from '../../utils/auth';
import { normalizeDateOfBirth } from '../Certificate/birthdate';
import { ADULT_DECLARATION_REQUIRED, INVALID_DATE_MESSAGE, isAdultDate } from '../../utils/age';

const Attendance = {
  Query: {
    eventAttendances: async (_, { eventDocumentId }, ctx) => {
      await requireEventOrganizer(ctx, eventDocumentId);
      const { dataSources } = ctx;
      try {
        const response = await dataSources.managerIntegration.findAttendances(eventDocumentId);
        const attendances = response?.data || [];

        return attendances.map((attendance) => ({
          id: String(attendance.documentId || attendance.id),
          user: attendance.users_permissions_user
            ? {
                id: attendance.users_permissions_user.documentId,
                name: attendance.users_permissions_user.name,
                email: attendance.users_permissions_user.email,
                phone: attendance.users_permissions_user.phone,
                cpf: attendance.users_permissions_user.cpf,
                date_of_birth: attendance.users_permissions_user.date_of_birth,
              }
            : null,
          createdAt: attendance.createdAt,
        }));
      } catch (err) {
        throw new Error(`Erro ao buscar lista de presença: ${err.message}`);
      }
    },
  },

  Mutation: {
    createAttendance: async (
      _,
      { eventDocumentId, cpf, date_of_birth, phone, name, adult_declaration },
      { user, dataSources },
    ) => {
      if (!user) {
        return {
          success: false,
          message: 'Não autenticado. Faça login para assinar a presença.',
        };
      }

      try {
        // 1. REA-36: the 18+ checkbox, and a valid date of birth of someone aged 18+ (counted in
        //    São Paulo; an invalid date used to pass, as NaN < 18 is false).
        if (adult_declaration !== true) return { success: false, message: ADULT_DECLARATION_REQUIRED };
        const birthDate = normalizeDateOfBirth(date_of_birth);
        if (!birthDate) return { success: false, message: INVALID_DATE_MESSAGE };
        if (!isAdultDate(birthDate)) {
          return {
            success: false,
            message: 'É necessário ter pelo menos 18 anos para assinar a presença.',
          };
        }

        // 2. Update user profile with provided data
        const userUpdate = {};
        if (cpf) userUpdate.cpf = cpf;
        userUpdate.date_of_birth = birthDate;
        if (user.adult_declaration !== true) userUpdate.adult_declaration = true;
        if (phone) userUpdate.phone = phone;
        if (name) userUpdate.name = name;

        if (Object.keys(userUpdate).length > 0) {
          await dataSources.managerAuthenticated.updateUser(user.id, userUpdate);
        }

        // 3. Create attendance record
        await dataSources.managerIntegration.createAttendance({
          users_permissions_user: user.documentId,
          event: eventDocumentId,
        });

        return {
          success: true,
          message: 'Presença registrada com sucesso!',
        };
      } catch (err) {
        return {
          success: false,
          message: `Erro ao registrar presença: ${err.message}`,
        };
      }
    },
  },
};

export default Attendance;
