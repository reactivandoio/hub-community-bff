import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { makeExecutableSchema } from '@graphql-tools/schema';

import Community from '../resolvers/Community';
import Speaker from '../resolvers/Speaker';
import User from '../resolvers/User';

// REA-56: in production an anonymous caller read the organizers' e-mail, phone, CPF and date of
// birth with `communityBySlugOrId { organizers { email phone cpf date_of_birth } }`, and the same
// through every other path that returns a User. These run the real schema and resolvers.

// The same (CommonJS) copy of graphql that @graphql-tools builds the schema with.
const { graphql } = createRequire(import.meta.url)('graphql');

const TYPES_DIR = './src/types';
const typeDefs = fs
  .readdirSync(TYPES_DIR)
  .filter((file) => file.endsWith('.graphql'))
  .map((file) => fs.readFileSync(path.join(TYPES_DIR, file), 'utf8'))
  .join('\n');

const schema = makeExecutableSchema({
  typeDefs,
  resolvers: {
    Community: Community.Community,
    Speaker: Speaker.Speaker,
    User: User.User,
    Query: { ...Community.Query, ...Speaker.Query, ...User.Query },
    Mutation: { ...User.Mutation },
  },
});

const ANA = {
  id: 7,
  documentId: 'u-ana',
  username: 'ana',
  name: 'Ana',
  email: 'ana@example.com',
  phone: '62999990000',
  cpf: '52998224725',
  date_of_birth: '1990-01-01',
  adult_declaration: true,
  adult_declaration_at: '2026-01-01T00:00:00.000Z',
  speaker: { documentId: 's-ana', name: 'Ana', email: 'ana.speaker@example.com', avatar: null },
};
const PERSONAL = ['email', 'phone', 'cpf', 'date_of_birth', 'adult_declaration', 'adult_declaration_at'];
const FIELDS = `id username name ${PERSONAL.join(' ')} speaker { name email }`;

const dataSources = () => ({
  managerIntegration: {
    findCommunities: vi.fn().mockResolvedValue({ data: [{ documentId: 'c-1', title: 'Techstars', organizers: [ANA] }] }),
    findPublicUserByUsername: vi.fn().mockResolvedValue(ANA),
    findPublicUserById: vi.fn().mockResolvedValue({ data: ANA }),
  },
});

const run = (source, user) => graphql({
  schema,
  source,
  contextValue: { user, dataSources: dataSources() },
});

const expectHidden = (person) => {
  PERSONAL.forEach((field) => expect(person[field], field).toBeNull());
  expect(person.speaker.email).toBeNull();
  expect(person.username).toBe('ana');
  expect(person.name).toBe('Ana');
};

const expectShown = (person) => {
  PERSONAL.forEach((field) => expect(person[field], field).toEqual(ANA[field]));
};

describe('REA-56: dados pessoais de User', () => {
  it('um anônimo não recebe e-mail, telefone, CPF nem nascimento dos organizadores (consulta de produção)', async () => {
    const res = await run(`{ communityBySlugOrId(slugOrId: "techstars") { organizers { ${FIELDS} } } }`);
    expect(res.errors).toBeUndefined();
    expectHidden(res.data.communityBySlugOrId.organizers[0]);
  });

  it('um anônimo não recebe dados pessoais em userByUsername nem em user(id)', async () => {
    const res = await run(`{ userByUsername(username: "ana") { ${FIELDS} } }`);
    expect(res.errors).toBeUndefined();
    expectHidden(res.data.userByUsername);
  });

  it('outra pessoa logada também não recebe', async () => {
    const other = { id: 9, documentId: 'u-caio', role: { type: 'community-manager' } };
    const res = await run(`{ communityBySlugOrId(slugOrId: "techstars") { organizers { ${FIELDS} } } }`, other);
    expectHidden(res.data.communityBySlugOrId.organizers[0]);
  });

  it('a própria pessoa recebe os seus dados', async () => {
    const self = { id: 7, documentId: 'u-ana', role: { type: 'authenticated' } };
    const res = await run(`{ userByUsername(username: "ana") { ${FIELDS} } }`, self);
    expectShown(res.data.userByUsername);
  });

  it('um admin recebe', async () => {
    const admin = { id: 1, documentId: 'u-admin', role: { type: 'admin' } };
    const res = await run(`{ communityBySlugOrId(slugOrId: "techstars") { organizers { ${FIELDS} } } }`, admin);
    expectShown(res.data.communityBySlugOrId.organizers[0]);
    expect(res.data.communityBySlugOrId.organizers[0].speaker.email).toBe(ANA.speaker.email);
  });

  it('o login por código continua devolvendo os dados e o token para quem acabou de entrar', async () => {
    const { User: UserType } = User;
    const loggedIn = { ...ANA, token: 'jwt' };
    PERSONAL.forEach((field) => expect(UserType[field](loggedIn, {}, { user: undefined })).toEqual(ANA[field]));
    expect(UserType.token(loggedIn, {}, { user: undefined })).toBe('jwt');
  });

  it('as consultas de usuário leem com o token de integração (o papel Public do Strapi não lê mais usuários)', async () => {
    const ctx = { user: undefined, dataSources: dataSources() };
    await User.Query.userByUsername(null, { username: 'ana' }, ctx);
    await User.Query.user(null, { id: 'u-ana' }, ctx);
    expect(ctx.dataSources.managerIntegration.findPublicUserByUsername).toHaveBeenCalledWith('ana');
    expect(ctx.dataSources.managerIntegration.findPublicUserById).toHaveBeenCalledWith('u-ana');
  });
});
