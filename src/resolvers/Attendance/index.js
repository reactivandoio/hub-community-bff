const Attendance = {
  Query: {
    eventAttendances: async (_, { eventDocumentId }, { dataSources }) => {
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
      { eventDocumentId, cpf, date_of_birth, phone, name },
      { user, dataSources },
    ) => {
      if (!user) {
        return {
          success: false,
          message: 'Não autenticado. Faça login para assinar a presença.',
        };
      }

      try {
        // 1. Validate age (must be 18+)
        const birthDate = new Date(date_of_birth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--;
        }

        if (age < 18) {
          return {
            success: false,
            message: 'É necessário ter pelo menos 18 anos para assinar a presença.',
          };
        }

        // 2. Update user profile with provided data
        const userUpdate = {};
        if (cpf) userUpdate.cpf = cpf;
        if (date_of_birth) userUpdate.date_of_birth = date_of_birth;
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
