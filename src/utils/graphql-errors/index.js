// The stack of a GraphQL error never goes to the client unless asked for explicitly
// (GRAPHQL_STACKTRACE=true, local debugging only). Not tied to NODE_ENV: with it unset
// or "development" on the server, Apollo would send the internal stack and file paths.
export const includeStacktrace = (env = process.env) =>
  String(env.GRAPHQL_STACKTRACE || '').toLowerCase() === 'true';

export default includeStacktrace;
