import { ApolloServer } from '@apollo/server';
import { describe, it, expect } from 'vitest';
import { createFormatError } from '../error-handling';
import {
  PROFILE_UPDATE_REQUIRED, mustUpdateProfile, profileUpdateRequiredPlugin,
} from '.';

const typeDefs = `
  type Query { me: String }
  type Mutation { updateProfile: String, verifyLoginCode: String, requestLoginCode: String, signupToEvent: String }
`;
const resolvers = {
  Query: { me: () => 'me' },
  Mutation: {
    updateProfile: () => 'saved', verifyLoginCode: () => 'in', requestLoginCode: () => 'sent', signupToEvent: () => 'signed',
  },
};

const pending = { id: 5, age_review_status: 'dob_update_required', date_of_birth: null };

const run = async (query, user) => {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [profileUpdateRequiredPlugin()],
    formatError: createFormatError({ log: () => {} }),
  });
  await server.start();
  const res = await server.executeOperation({ query }, { contextValue: { user } });
  await server.stop();
  return res.body.singleResult;
};

describe('mustUpdateProfile', () => {
  it('is only the account pending update that still has no date', () => {
    expect(mustUpdateProfile(pending)).toBe(true);
    expect(mustUpdateProfile({ ...pending, date_of_birth: '1990-01-01' })).toBe(false);
    expect(mustUpdateProfile({ age_review_status: 'dob_requested' })).toBe(false);
    expect(mustUpdateProfile({ age_review_status: 'minor_blocked' })).toBe(false);
    expect(mustUpdateProfile(undefined)).toBe(false);
  });
});

describe('profileUpdateRequiredPlugin', () => {
  it('refuses other mutations of a pending account with PROFILE_UPDATE_REQUIRED', async () => {
    const out = await run('mutation { signupToEvent }', pending);
    expect(out.data).toBeUndefined();
    expect(out.errors[0].extensions.code).toBe(PROFILE_UPDATE_REQUIRED);
    expect(out.errors[0].message).toMatch(/Atualize seu cadastro/);
  });

  it('refuses a mixed mutation too', async () => {
    const out = await run('mutation { updateProfile signupToEvent }', pending);
    expect(out.errors[0].extensions.code).toBe(PROFILE_UPDATE_REQUIRED);
  });

  it('lets a pending account log in, update the profile and read', async () => {
    expect((await run('mutation { updateProfile }', pending)).data).toEqual({ updateProfile: 'saved' });
    expect((await run('mutation { verifyLoginCode requestLoginCode }', pending)).data).toEqual({ verifyLoginCode: 'in', requestLoginCode: 'sent' });
    expect((await run('{ me }', pending)).data).toEqual({ me: 'me' });
  });

  it('changes nothing for everybody else', async () => {
    expect((await run('mutation { signupToEvent }', { id: 1, age_review_status: null })).data).toEqual({ signupToEvent: 'signed' });
    expect((await run('mutation { signupToEvent }', { ...pending, date_of_birth: '1990-01-01' })).data).toEqual({ signupToEvent: 'signed' });
    expect((await run('mutation { signupToEvent }', undefined)).data).toEqual({ signupToEvent: 'signed' });
  });
});
