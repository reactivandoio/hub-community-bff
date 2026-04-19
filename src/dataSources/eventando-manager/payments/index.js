import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch } = eventandoNetworkUtils;

const createPayment = (data, headers) =>
  fetch('/payments', 'POST', headers, { data });

const payments = ({ headers }) => ({
  createPaymentDirect: (data) => createPayment(data, headers),
});

export default payments;
