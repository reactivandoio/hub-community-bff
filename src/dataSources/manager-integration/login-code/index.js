import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

// REA-26: integration-only routes of the manager (hub-community-backend api::login-code).
// request → { status: 'sent', code, expiresAt } | { status: 'cooldown', retryAfter } | { status: 'limit' }
//           | { status: 'blocked' }
// verify  → { status: 'ok', jwt, user, created } | { status: 'invalid', attemptsLeft } | { status: 'expired' }
//           | { status: 'blocked' }
const requestLoginCode = async (email, headers) => {
  const response = await fetch('/login-code/request', 'POST', headers, { email });
  return response?.data;
};

const verifyLoginCode = async (email, code, headers) => {
  const response = await fetch('/login-code/verify', 'POST', headers, { email, code });
  return response?.data;
};

const loginCodeDataSource = ({ headers }) => ({
  requestLoginCode: (email) => requestLoginCode(email, headers),
  verifyLoginCode: (email, code) => verifyLoginCode(email, code, headers),
});

export default loginCodeDataSource;
