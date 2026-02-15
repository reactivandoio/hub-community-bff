import speakers from './speakers';
import agendas from './agendas';
import comments from './comments';
import events from './events';

const managerIntegration = ({ headers }) => ({
  ...speakers({ headers }),
  ...agendas({ headers }),
  ...comments({ headers }),
  ...events({ headers }),
});

export default managerIntegration;
