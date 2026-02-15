import events from './events';
import signup from './signup';

const eventandoManager = ({ headers }) => ({
    ...events({ headers }),
    ...signup({ headers }),
});

export default eventandoManager;
