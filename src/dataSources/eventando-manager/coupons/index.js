import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch, buildQuery } = eventandoNetworkUtils;

const createCoupon = (data, headers) =>
    fetch('/coupons', 'POST', headers, { data });

const updateCoupon = (id, data, headers) =>
    fetch(`/coupons/${id}`, 'PUT', headers, { data });

const deleteCoupon = (id, headers) =>
    fetch(`/coupons/${id}`, 'DELETE', headers);

const findCoupons = (filters, headers) => {
    const query = buildQuery(filters);
    const route = `/coupons${query ? `?${query}` : ''}`;
    return fetch(route, 'GET', headers);
};

const coupons = ({ headers }) => ({
    createCoupon: (data) => createCoupon(data, headers),
    updateCoupon: (id, data) => updateCoupon(id, data, headers),
    deleteCoupon: (id) => deleteCoupon(id, headers),
    findCoupons: (filters) => findCoupons(filters, headers),
});

export default coupons;
