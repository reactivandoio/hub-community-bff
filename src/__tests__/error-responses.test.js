// REA-35: error answers carry only message and code, whatever NODE_ENV says;
// the detail goes to the log.
import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { GraphQLError } from 'graphql';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  exposeErrorDetails,
  createFormatError,
  createExpressErrorHandler,
} from '../utils/error-handling';

const typeDefs = 'type Query { ok: String, boom: String, userError: String }';
const resolvers = {
  Query: {
    ok: () => 'ok',
    boom: () => {
      throw Object.assign(new Error('Error on try GET in /events'), { extensions: { response: { url: 'http://interno' } } });
    },
    userError: () => {
      throw new GraphQLError('Cupom inválido.', { extensions: { code: 'BAD_USER_INPUT', http: { status: 400 } } });
    },
  },
};

let servers = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => { s.close(r); })));
  servers = [];
  vi.unstubAllEnvs();
});

const startApp = async ({ expose, log = () => {} }) => {
  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
    includeStacktraceInErrorResponses: expose,
    formatError: createFormatError({ expose, log }),
  });
  await apollo.start();
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 } });
  app.post('/upload', upload.single('file'), (req, res) => res.json({ ok: true }));
  app.get('/explode', () => {
    throw new Error('segredo interno em /root/projects');
  });
  app.use('/', bodyParser.json(), expressMiddleware(apollo));
  app.use(createExpressErrorHandler({ expose, log }));
  const srv = http.createServer(app);
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
};

const gql = (url, body) =>
  fetch(`${url}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('exposeErrorDetails', () => {
  it('only an explicit true turns it on, NODE_ENV does not matter', () => {
    expect(exposeErrorDetails({})).toBe(false);
    expect(exposeErrorDetails({ NODE_ENV: 'development' })).toBe(false);
    expect(exposeErrorDetails({ EXPOSE_ERROR_DETAILS: 'false' })).toBe(false);
    expect(exposeErrorDetails({ EXPOSE_ERROR_DETAILS: '1' })).toBe(false);
    expect(exposeErrorDetails({ EXPOSE_ERROR_DETAILS: ' TRUE ' })).toBe(true);
  });
});

describe('error answers in production (no EXPOSE_ERROR_DETAILS)', () => {
  it('GraphQL validation error: message and code, no stacktrace, even with NODE_ENV=development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const url = await startApp({ expose: false });
    const res = await gql(url, JSON.stringify({ query: '{ naoExiste }' }));
    const { errors } = await res.json();
    expect(errors[0].message).toMatch(/naoExiste/);
    expect(errors[0].extensions).toEqual({ code: 'GRAPHQL_VALIDATION_FAILED' });
  });

  it('resolver error: only message and code go out, the stack goes to the log', async () => {
    const log = vi.fn();
    const url = await startApp({ expose: false, log });
    const res = await gql(url, JSON.stringify({ query: '{ boom }' }));
    const text = await res.text();
    const { errors } = JSON.parse(text);
    expect(errors[0]).toMatchObject({ message: 'Error on try GET in /events', path: ['boom'] });
    expect(errors[0].extensions).toEqual({ code: 'INTERNAL_SERVER_ERROR' });
    expect(text).not.toMatch(/interno|stacktrace|at /);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/boom: Error: Error on try GET in \/events\n\s+at /));
  });

  it('user error keeps its message and code', async () => {
    const url = await startApp({ expose: false });
    const res = await gql(url, JSON.stringify({ query: '{ userError }' }));
    const { errors } = await res.json();
    expect(errors[0].message).toBe('Cupom inválido.');
    expect(errors[0].extensions).toEqual({ code: 'BAD_USER_INPUT' });
  });

  it('bad JSON: 400 in JSON, without the HTML page holding the stack', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const url = await startApp({ expose: false });
    const res = await gql(url, '{bad');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/json/);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Requisição inválida.' });
    expect(text).not.toMatch(/node_modules|at /);
  });

  it('REST route crash: 500 with a generic message', async () => {
    const log = vi.fn();
    const url = await startApp({ expose: false, log });
    const res = await fetch(`${url}/explode`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erro interno.' });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/segredo interno/));
  });

  it('upload too large: 400 with the multer message, no stack', async () => {
    const url = await startApp({ expose: false });
    const form = new FormData();
    form.append('file', new Blob(['x'.repeat(100)], { type: 'image/png' }), 'a.png');
    const res = await fetch(`${url}/upload`, { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'File too large' });
  });
});

describe('error answers in development (EXPOSE_ERROR_DETAILS=true)', () => {
  it('GraphQL and REST answers carry the stack', async () => {
    const url = await startApp({ expose: true });
    const { errors } = await (await gql(url, JSON.stringify({ query: '{ boom }' }))).json();
    expect(errors[0].extensions.stacktrace.join('\n')).toMatch(/at /);
    const rest = await (await fetch(`${url}/explode`)).json();
    expect(rest.stack).toMatch(/segredo interno/);
  });
});
