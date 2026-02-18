import eventandoNetworkUtils from '../../../utils/network/eventando-manager';

const { fetch } = eventandoNetworkUtils;

const createBatch = (data, headers) =>
    fetch('/batches', 'POST', headers, { data });

const updateBatch = (id, data, headers) =>
    fetch(`/batches/${id}`, 'PUT', headers, { data });

const deleteBatch = (id, headers) =>
    fetch(`/batches/${id}`, 'DELETE', headers);

const batches = ({ headers }) => ({
    createBatch: (data) => createBatch(data, headers),
    updateBatch: (id, data) => updateBatch(id, data, headers),
    deleteBatch: (id) => deleteBatch(id, headers),
});

export default batches;
