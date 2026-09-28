import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

// Voting sessions and their options, managed from the admin panel. The public pages
// (/votacao) still read and vote on Strapi directly with the public role.

const OPTIONS_POPULATE = ['voting_options'];

const findVotingSessions = (headers) => {
  const query = buildQuery({}, [{ createdAt: 'desc' }], { pageSize: 100 });
  return fetch(`/voting-sessions?${query}`, 'GET', headers);
};

const findVotingSession = (id, headers) => {
  const query = buildQuery({}, [], {}, '', OPTIONS_POPULATE);
  return fetch(`/voting-sessions/${encodeURIComponent(id)}?${query}`, 'GET', headers);
};

const createVotingSession = (data, headers) =>
  fetch('/voting-sessions', 'POST', headers, { data });

const updateVotingSession = (id, data, headers) =>
  fetch(`/voting-sessions/${encodeURIComponent(id)}`, 'PUT', headers, { data });

const deleteVotingSession = (id, headers) =>
  fetch(`/voting-sessions/${encodeURIComponent(id)}`, 'DELETE', headers);

const createVotingOption = (data, headers) =>
  fetch('/voting-options', 'POST', headers, { data });

const updateVotingOption = (id, data, headers) =>
  fetch(`/voting-options/${encodeURIComponent(id)}`, 'PUT', headers, { data });

const deleteVotingOption = (id, headers) =>
  fetch(`/voting-options/${encodeURIComponent(id)}`, 'DELETE', headers);

const voting = ({ headers }) => ({
  findVotingSessions: () => findVotingSessions(headers),
  findVotingSession: (id) => findVotingSession(id, headers),
  createVotingSession: (data) => createVotingSession(data, headers),
  updateVotingSession: (id, data) => updateVotingSession(id, data, headers),
  deleteVotingSession: (id) => deleteVotingSession(id, headers),
  createVotingOption: (data) => createVotingOption(data, headers),
  updateVotingOption: (id, data) => updateVotingOption(id, data, headers),
  deleteVotingOption: (id) => deleteVotingOption(id, headers),
});

export default voting;
