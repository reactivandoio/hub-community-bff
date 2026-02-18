import user from './user';

const managerAuthenticated = ({ headers }) => ({
  ...user({ headers }),
});

export default managerAuthenticated;
