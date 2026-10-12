import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch, buildQuery } = eventandoNetworkUtils;

const createCoupon = (data, headers) =>
    fetch('/coupons', 'POST', headers, { data });

const updateCoupon = (id, data, headers) =>
    fetch(`/coupons/${id}`, 'PUT', headers, { data });

const deleteCoupon = (id, headers) =>
    fetch(`/coupons/${id}`, 'DELETE', headers);

const findCoupons = (filters, headers, populate = []) => {
    const query = buildQuery(filters, [], { pageSize: 100 }, '', populate);
    const route = `/coupons${query ? `?${query}` : ''}`;
    return fetch(route, 'GET', headers);
};

// Price with coupon / half price, computed by the Eventando (src/utils/pricing.js).
const previewCoupon = (body, headers) =>
    fetch('/coupon/preview', 'POST', headers, body);

const coupons = ({ headers }) => ({
    previewCoupon: (body) => previewCoupon(body, headers),
    createCoupon: (data) => createCoupon(data, headers),
    updateCoupon: (id, data) => updateCoupon(id, data, headers),
    deleteCoupon: (id) => deleteCoupon(id, headers),
    findCoupons: (filters, populate) => findCoupons(filters, headers, populate),
});

export default coupons;
