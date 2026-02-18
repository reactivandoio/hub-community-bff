import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch } = eventandoNetworkUtils;

const createProduct = (data, headers) =>
    fetch('/products', 'POST', headers, { data });

const updateProduct = (id, data, headers) =>
    fetch(`/products/${id}`, 'PUT', headers, { data });

const deleteProduct = (id, headers) =>
    fetch(`/products/${id}`, 'DELETE', headers);

const products = ({ headers }) => ({
    createProduct: (data) => createProduct(data, headers),
    updateProduct: (id, data) => updateProduct(id, data, headers),
    deleteProduct: (id) => deleteProduct(id, headers),
});

export default products;
