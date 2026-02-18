import auth from './auth';

const managerPublic = ({ headers }) => ({
  ...auth({ headers }),
});

export default managerPublic;
