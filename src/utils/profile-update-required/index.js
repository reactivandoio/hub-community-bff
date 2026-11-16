import { GraphQLError } from 'graphql';

// REA-60: an account past the 7 days of the date-of-birth request (`age_review_status`
// `dob_update_required`, set by hub-community-backend config/cron-tasks.ts) is not blocked: it
// still gets the login code and its session works. But it has to update the profile (date of
// birth of 18+ and the declaration) before using the site. The frontend opens the
// CompleteProfileModal; here every mutation other than the login and `updateProfile` is refused
// with PROFILE_UPDATE_REQUIRED. Queries keep working so the page can load. A valid date of birth
// clears the status in the backend, and the auth cache is cleared by updateProfile's own answer
// within 60 s at most (the guard reads the cached user).

export const PROFILE_UPDATE_REQUIRED = 'PROFILE_UPDATE_REQUIRED';
export const PROFILE_UPDATE_MESSAGE = 'Atualize seu cadastro (data de nascimento e declaração de 18 anos ou mais) para continuar.';

const ALLOWED_MUTATIONS = new Set(['requestLoginCode', 'verifyLoginCode', 'updateProfile']);

export const mustUpdateProfile = (user) => user?.age_review_status === 'dob_update_required' && !user?.date_of_birth;

/** Root fields of the operation that a pending account may not run. */
export const refusedFields = (operation) => {
  if (operation?.operation !== 'mutation') return [];
  return (operation.selectionSet?.selections || [])
    .filter((s) => s.kind === 'Field' && s.name.value !== '__typename' && !ALLOWED_MUTATIONS.has(s.name.value))
    .map((s) => s.name.value);
};

/** Apollo plugin. */
export const profileUpdateRequiredPlugin = () => ({
  async requestDidStart() {
    return {
      async didResolveOperation({ operation, contextValue }) {
        if (!mustUpdateProfile(contextValue?.user)) return;
        if (refusedFields(operation).length === 0) return;
        throw new GraphQLError(PROFILE_UPDATE_MESSAGE, {
          extensions: { code: PROFILE_UPDATE_REQUIRED, http: { status: 200 } },
        });
      },
    };
  },
});
