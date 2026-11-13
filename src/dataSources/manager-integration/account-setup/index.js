import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

// Integration-only route on the manager: creates the account when the e-mail has
// none. Resolves { created, pending }: pending = the registration is not finished
// (the e-mail was never verified by a login code, REA-26).
const accountSetup = async ({ email, name, phone }, headers) => {
  const response = await fetch('/account-setup', 'POST', headers, { email, name, phone });
  return response?.data;
};

// REA-22: [{ email, pending }] for the e-mails that have an account; pending = the
// person never logged in with a code (registration not finished, REA-26).
const accountStatus = async (emails, headers) => {
  const response = await fetch('/account-status', 'POST', headers, { emails });
  return response?.data?.accounts || [];
};

const accountSetupDataSource = ({ headers }) => ({
  accountSetup: (data) => accountSetup(data, headers),
  accountStatus: (emails) => accountStatus(emails, headers),
});

export default accountSetupDataSource;
