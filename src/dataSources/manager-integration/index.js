import speakers from './speakers';
import agendas from './agendas';
import comments from './comments';
import events from './events';
import locations from './locations';
import talks from './talks';

const managerIntegration = ({ headers }) => ({
  ...speakers({ headers }),
  ...agendas({ headers }),
  ...comments({ headers }),
  ...events({ headers }),
  ...locations({ headers }),
  ...talks({ headers }),
});

export default managerIntegration;
