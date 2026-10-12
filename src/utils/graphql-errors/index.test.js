import { describe, it, expect } from 'vitest';
import { ApolloServer } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { includeStacktrace } from './index';

const serverWith = (env) => new ApolloServer({
  typeDefs: 'type Query { fail: String }',
  resolvers: {
    Query: {
      fail: () => {
        throw new GraphQLError('Não autenticado. Faça login novamente.', { extensions: { code: 'UNAUTHENTICATED' } });
      },
    },
  },
  includeStacktraceInErrorResponses: includeStacktrace(env),
});

const errorOf = async (env) => {
  const server = serverWith(env);
  const res = await server.executeOperation({ query: '{ fail }' });
  await server.stop();
  return res.body.singleResult.errors[0];
};

describe('includeStacktrace', () => {
  it('sem stacktrace por padrão, inclusive com NODE_ENV=development', async () => {
    const error = await errorOf({ NODE_ENV: 'development' });
    expect(error.message).toBe('Não autenticado. Faça login novamente.');
    expect(error.extensions.code).toBe('UNAUTHENTICATED');
    expect(error.extensions.stacktrace).toBeUndefined();
    expect(await errorOf({})).not.toHaveProperty('extensions.stacktrace');
  });

  it('só com GRAPHQL_STACKTRACE=true (depuração local)', async () => {
    expect(includeStacktrace({ GRAPHQL_STACKTRACE: 'true' })).toBe(true);
    expect((await errorOf({ GRAPHQL_STACKTRACE: 'true' })).extensions.stacktrace).toBeTruthy();
    expect(includeStacktrace({ GRAPHQL_STACKTRACE: 'false' })).toBe(false);
  });
});
