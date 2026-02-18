import makeRequest from '../makeRequest';

const { fetch, buildQuery } = makeRequest;

const createAgenda = async ({ authorization, body }) => {
  const route = '/agendas';
  const method = 'POST';
  const headers = {
    authorization,
  };

  return fetch(route, method, headers, body);
};

const privateRequests = ({ headers }) => ({
  createAgenda: createAgenda({ authorization: headers.authorization }),
});

export default privateRequests;
