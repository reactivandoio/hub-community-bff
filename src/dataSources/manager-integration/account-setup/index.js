import managerNetworkUtils from '../../../utils/network/manager';

const { fetch } = managerNetworkUtils;

// Integration-only route on the manager: creates the account when the e-mail has
// none and, while the account still has no password of its own, returns a fresh
// set-password token (the previous one stops working). Resolves { created, token }.
const accountSetup = async ({ email, name, phone }, headers) => {
  const response = await fetch('/account-setup', 'POST', headers, { email, name, phone });
  return response?.data;
};

// REA-22: [{ email, pending }] for the e-mails that have an account; pending = no
// password of its own yet (registration not finished).
const accountStatus = async (emails, headers) => {
  const response = await fetch('/account-status', 'POST', headers, { emails });
  return response?.data?.accounts || [];
};

const accountSetupDataSource = ({ headers }) => ({
  accountSetup: (data) => accountSetup(data, headers),
  accountStatus: (emails) => accountStatus(emails, headers),
});

export default accountSetupDataSource;
