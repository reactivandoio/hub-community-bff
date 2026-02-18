import dotenv from 'dotenv';
import manager from './manager';
import managerPublic from './manager-public';
import managerIntegration from './manager-integration';
import managerAuthenticated from './manager-authenticated';
import eventandoManager from './eventando-manager';

dotenv.config();

export default (headers) => ({
  manager: manager(headers),
  managerPublic: managerPublic({ headers }),
  managerIntegration: managerIntegration({
    headers: {
      ...headers,
      Authorization: `Bearer ${process.env.MANAGER_TOKEN_INTEGRATION}`,
    },
  }),
  eventandoIntegration: eventandoManager({
    headers: {
      ...headers,
      Authorization: `Bearer ${process.env.EVENTANDO_MANAGER_TOKEN_INTEGRATION}`,
    },
  }),
  managerAuthenticated: managerAuthenticated({
    headers,
  }),
});
