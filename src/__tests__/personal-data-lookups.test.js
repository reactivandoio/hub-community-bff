import { describe, it, expect, vi, beforeEach } from 'vitest';

import Certificate from '../resolvers/Certificate';
import Comment from '../resolvers/Comment';
import Community from '../resolvers/Community';
import { withoutPersonalFilters } from '../utils/personal-filters';

vi.mock('../services/email/complete-registration', () => ({
  sendCompleteRegistration: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../resolvers/Certificate/email', () => ({ sendCertificateEmail: vi.fn().mockResolvedValue({ success: true }) }));

// REA-56: ways an anonymous caller got someone else's personal data besides the User type.

const STORED = {
  documentId: 'cert-1', code: 'ABC123', name: 'Ana', identifier: '52998224725', email: 'ana@example.com',
};
const certificateSources = () => ({
  managerIntegration: {
    findEventByDocumentId: vi.fn().mockResolvedValue({ data: { documentId: 'e1', title: 'Meetup', end_date: '2020-01-01' } }),
    findCertificateConfigByEvent: vi.fn().mockResolvedValue({ data: [{ enabled: true, allow_self_request: true }] }),
    findCertificateByEventAndIdentifier: vi.fn().mockResolvedValue({ data: [STORED] }),
  },
});

beforeEach(() => vi.clearAllMocks());

describe('REA-56: certificado procurado por CPF', () => {
  it('lookupCertificate não devolve a um anônimo o e-mail e o CPF guardados', async () => {
    const out = await Certificate.Query.lookupCertificate(
      null, { eventId: 'e1', identifier: '529.982.247-25' }, { dataSources: certificateSources() },
    );
    expect(out.certificate).toMatchObject({ code: 'ABC123', name: 'Ana', email: null, identifier: null });
  });

  it('requestCertificate de um CPF que já tem certificado também não (o e-mail digitado é ignorado)', async () => {
    const out = await Certificate.Mutation.requestCertificate(
      null,
      { eventId: 'e1', name: 'X', identifier: '52998224725', email: 'outra@example.com', adult_declaration: true },
      { dataSources: certificateSources() },
    );
    expect(out).toMatchObject({ code: 'ABC123', email: null, identifier: null });
  });

  it('um admin continua vendo', async () => {
    const out = await Certificate.Query.lookupCertificate(
      null, { eventId: 'e1', identifier: '52998224725' },
      { dataSources: certificateSources(), user: { id: 1, role: { type: 'admin' } } },
    );
    expect(out.certificate).toMatchObject({ email: STORED.email, identifier: STORED.identifier });
  });
});

describe('REA-56: filtros por dado pessoal nas consultas públicas', () => {
  it('communities não deixa adivinhar o e-mail dos organizadores', async () => {
    const findCommunities = vi.fn().mockResolvedValue({ data: [] });
    await Community.Query.communities(
      null,
      { filters: { title: { eq: 'Techstars' }, organizers: { email: { startsWith: 'a' }, username: { eq: 'ana' } } } },
      { dataSources: { managerIntegration: { findCommunities } } },
    );
    expect(findCommunities.mock.calls[0][0].filters).toEqual({
      title: { eq: 'Techstars' }, organizers: { username: { eq: 'ana' } },
    });
  });

  it('comments não filtra por e-mail do autor e só popula relações permitidas', async () => {
    const findComments = vi.fn().mockResolvedValue({ data: [] });
    await Comment.Query.comments(
      null,
      {
        filters: { talk: { documentId: { eq: 't1' } }, user: { email: { contains: '@' } } },
        populate: ['talk', 'user_creator', 'user_creator.role', 'talk.speakers.users_permissions_user'],
      },
      { dataSources: { managerIntegration: { findComments } } },
    );
    const args = findComments.mock.calls[0][0];
    expect(args.filters).toEqual({ talk: { documentId: { eq: 't1' } }, user: {} });
    expect(args.populate).toEqual(['talk', 'user_creator']);
  });

  it('withoutPersonalFilters tira as chaves em qualquer nível, inclusive dentro de or/and', () => {
    expect(withoutPersonalFilters({ or: [{ cpf: { eq: '1' } }, { name: { eq: 'a' } }], phone: { eq: '9' } }))
      .toEqual({ or: [{}, { name: { eq: 'a' } }] });
  });
});
