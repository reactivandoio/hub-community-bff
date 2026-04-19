import events from './events';
import signup from './signup';
import products from './products';
import batches from './batches';
import coupons from './coupons';
import payments from './payments';

const eventandoManager = ({ headers }) => ({
    ...events({ headers }),
    ...signup({ headers }),
    ...products({ headers }),
    ...batches({ headers }),
    ...coupons({ headers }),
    ...payments({ headers }),
});

export default eventandoManager;

