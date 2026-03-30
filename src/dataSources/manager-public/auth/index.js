import managerPublicNetworkUtils from '../../../utils/network/manager';

function signIn({ identifier, password }) {
  return managerPublicNetworkUtils.fetch(
    '/auth/local',
    'POST',
    {},
    { identifier, password },
  );
}

function signUp({ username, email, password, name, phone }) {
  return managerPublicNetworkUtils.fetch(
    '/auth/local/register',
    'POST',
    {},
    { username, email, password, name, phone },
  );
}

function forwardPassword({ email }) {
  return managerPublicNetworkUtils.fetch(
    '/auth/forgot-password',
    'POST',
    {},
    { email },
  );
}

function resetPassword({ code, password, passwordConfirmation }) {
  return managerPublicNetworkUtils.fetch(
    '/auth/reset-password',
    'POST',
    {},
    { code, password, passwordConfirmation },
  );
}

const auth = ({ headers }) => ({
  signIn: (args) => signIn(args, headers),
  signUp: (args) => signUp(args, headers),
  forwardPassword: (args) => forwardPassword(args, headers),
  resetPassword: (args) => resetPassword(args, headers),
});

export default auth;
