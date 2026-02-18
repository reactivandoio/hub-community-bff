import speakers from './speakers';
import agendas from './agendas';
import comments from './comments';

const managerIntegration = ({ headers }) => ({
  ...speakers({ headers }),
  ...agendas({ headers }),
  ...comments({ headers }),
});

export default managerIntegration;
