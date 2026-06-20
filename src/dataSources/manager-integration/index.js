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
});

export default managerIntegration;

