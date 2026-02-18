import managerPublicNetworkUtils from '../../../utils/network/manager';

function signIn({ identifier, password }) {
  return managerPublicNetworkUtils.fetch(
    '/auth/local',
    'POST',
    {},
    { identifier, password },
  );
}

function signUp({ username, email, password }) {
  return managerPublicNetworkUtils.fetch(
    '/auth/local/register',
    'POST',
    {},
    { username, email, password },
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

const auth = ({ headers }) => ({
  signIn: (args) => signIn(args, headers),
  signUp: (args) => signUp(args, headers),
  forwardPassword: (args) => forwardPassword(args, headers),
});

export default auth;
