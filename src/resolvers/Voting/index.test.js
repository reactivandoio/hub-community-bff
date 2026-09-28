import { describe, it, expect, vi } from 'vitest';
import Voting, { pick } from './index';

const ADMIN = { documentId: 'u-admin', email: 'admin@x.io', role: { type: 'admin' } };

const makeDataSources = () => ({
  managerIntegration: {
    findVotingSessions: vi.fn().mockResolvedValue({ data: [{ documentId: 'vs-1', title: 'Pitch' }] }),
    findVotingSession: vi.fn().mockResolvedValue({ data: { documentId: 'vs-1' } }),
    createVotingSession: vi.fn().mockResolvedValue({ data: { documentId: 'vs-2' } }),
    updateVotingSession: vi.fn().mockResolvedValue({ data: { documentId: 'vs-1' } }),
    deleteVotingSession: vi.fn().mockResolvedValue({ data: null }),
    createVotingOption: vi.fn().mockResolvedValue({ data: { documentId: 'vo-1' } }),
    updateVotingOption: vi.fn().mockResolvedValue({ data: { documentId: 'vo-1' } }),
    deleteVotingOption: vi.fn().mockResolvedValue({ data: null }),
  },
});

describe('pick', () => {
  it('keeps only the declared fields that were sent', () => {
    expect(pick({ title: 'x', status: undefined, votes: [1] }, ['title', 'status'])).toEqual({ title: 'x' });
  });
});

describe('voting sessions', () => {
  it('lists the sessions for an admin', async () => {
    const dataSources = makeDataSources();
    const out = await Voting.Query.votingSessions(null, {}, { user: ADMIN, dataSources });
    expect(out).toEqual([{ documentId: 'vs-1', title: 'Pitch' }]);
  });

  it('creates with only the session fields', async () => {
    const dataSources = makeDataSources();
    await Voting.Mutation.createVotingSession(
      null,
      { data: { title: 'Pitch', status: 'open', max_votes_per_user: 2, event_id: 'ev-1' } },
      { user: ADMIN, dataSources },
    );
    expect(dataSources.managerIntegration.createVotingSession).toHaveBeenCalledWith({
      title: 'Pitch', status: 'open', max_votes_per_user: 2, event_id: 'ev-1',
    });
  });

  it('requires a title', async () => {
    await expect(Voting.Mutation.createVotingSession(null, { data: { title: ' ' } }, { user: ADMIN, dataSources: makeDataSources() }))
      .rejects.toThrow('Título é obrigatório.');
  });

  it('deletes and answers true', async () => {
    const dataSources = makeDataSources();
    expect(await Voting.Mutation.deleteVotingSession(null, { id: 'vs-1' }, { user: ADMIN, dataSources })).toBe(true);
    expect(dataSources.managerIntegration.deleteVotingSession).toHaveBeenCalledWith('vs-1');
  });

  it('returns the options in pitch order and the documentId as id', () => {
    const session = { documentId: 'vs-1', voting_options: [{ pitch_order: 2 }, { pitch_order: 1 }] };
    expect(Voting.VotingSession.voting_options(session).map((o) => o.pitch_order)).toEqual([1, 2]);
    expect(Voting.VotingSession.id(session)).toBe('vs-1');
  });
});

describe('voting options', () => {
  it('creates an option linked to its session', async () => {
    const dataSources = makeDataSources();
    await Voting.Mutation.createVotingOption(
      null,
      { data: { name: 'Startup A', pitch_order: 1, voting_session: 'vs-1' } },
      { user: ADMIN, dataSources },
    );
    expect(dataSources.managerIntegration.createVotingOption)
      .toHaveBeenCalledWith({ name: 'Startup A', pitch_order: 1, voting_session: 'vs-1' });
  });

  it('requires a name and a session', async () => {
    const ctx = { user: ADMIN, dataSources: makeDataSources() };
    await expect(Voting.Mutation.createVotingOption(null, { data: { voting_session: 'vs-1' } }, ctx))
      .rejects.toThrow('Nome é obrigatório.');
    await expect(Voting.Mutation.createVotingOption(null, { data: { name: 'A' } }, ctx))
      .rejects.toThrow('Sessão de votação é obrigatória.');
  });
});
