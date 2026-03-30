import speakers from './speakers';
import agendas from './agendas';
import comments from './comments';
import events from './events';
import locations from './locations';
import talks from './talks';
import communities from './communities';

const managerIntegration = ({ headers }) => ({
  ...speakers({ headers }),
  ...agendas({ headers }),
  ...comments({ headers }),
  ...events({ headers }),
  ...locations({ headers }),
  ...talks({ headers }),
  ...communities({ headers }),
});

export default managerIntegration;
