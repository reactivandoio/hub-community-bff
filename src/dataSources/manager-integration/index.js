import analyticsEvents from './analytics-events';
import speakers from './speakers';
import agendas from './agendas';
import comments from './comments';
import events from './events';
import locations from './locations';
import talks from './talks';
import communities from './communities';
import users from './users';
import participants from './participants';
import attendances from './attendances';
import certificates from './certificates';
import certificateRequestForms from './certificate-request-forms';
import accountSetup from './account-setup';
import authz from './authz';
import voting from './voting';
import adminUsers from './admin-users';
import emailCampaigns from './email-campaigns';
import loginCode from './login-code';
import shareArt from './share-art';
import management from './management';

const managerIntegration = ({ headers }) => ({
  ...analyticsEvents({ headers }),
  ...speakers({ headers }),
  ...agendas({ headers }),
  ...comments({ headers }),
  ...events({ headers }),
  ...locations({ headers }),
  ...talks({ headers }),
  ...communities({ headers }),
  ...users({ headers }),
  ...participants({ headers }),
  ...attendances({ headers }),
  ...certificates({ headers }),
  ...certificateRequestForms({ headers }),
  ...accountSetup({ headers }),
  ...authz({ headers }),
  ...voting({ headers }),
  ...adminUsers({ headers }),
  ...emailCampaigns({ headers }),
  ...loginCode({ headers }),
  ...shareArt({ headers }),
  ...management({ headers }),
});

export default managerIntegration;

