import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch } = eventandoNetworkUtils;

const createCoupon = (data, headers) =>
    fetch('/coupons', 'POST', headers, { data });

const updateCoupon = (id, data, headers) =>
    fetch(`/coupons/${id}`, 'PUT', headers, { data });

const deleteCoupon = (id, headers) =>
    fetch(`/coupons/${id}`, 'DELETE', headers);

const coupons = ({ headers }) => ({
    createCoupon: (data) => createCoupon(data, headers),
    updateCoupon: (id, data) => updateCoupon(id, data, headers),
    deleteCoupon: (id) => deleteCoupon(id, headers),
});

export default coupons;
