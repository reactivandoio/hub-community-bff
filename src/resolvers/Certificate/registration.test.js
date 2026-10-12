import { describe, it, expect, vi, beforeEach } from 'vitest';
import Certificate from './index';

vi.mock('../../services/email/complete-registration', () => ({
  sendCompleteRegistration: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./email', () => ({ sendCertificateEmail: vi.fn().mockResolvedValue({ success: true }) }));

const ORGANIZER = { id: 1, email: 'admin@x.io', role: { type: 'admin' } };

const makeDataSources = ({ pending }) => ({
  managerIntegration: {
    findEventByDocumentId: vi.fn().mockResolvedValue({ data: { documentId: 'e1', title: 'Meetup', end_date: '2020-01-01' } }),
    findCertificateConfigByEvent: vi.fn().mockResolvedValue({ data: [{ enabled: true, allow_self_request: true }] }),
    findCertificateByEventAndIdentifier: vi.fn().mockResolvedValue({ data: [] }),
    createCertificate: vi.fn().mockResolvedValue({ data: { code: 'ABC', name: 'Ana', identifier: '52998224725' } }),
    findUserByCpf: vi.fn().mockResolvedValue({ id: 3, email: 'ana@x.io' }),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    accountStatus: vi.fn().mockResolvedValue([{ email: 'ana@x.io', pending }]),
    accountSetup: vi.fn().mockResolvedValue({ token: 't' }),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const request = { eventId: 'e1', name: 'Ana', identifier: '529.982.247-25', email: 'ana@x.io' };

describe('certificado só com o cadastro concluído (REA-22, regra 6)', () => {
  it('autoatendimento com senha pendente: recusa, explica e reenvia o link', async () => {
    const ds = makeDataSources({ pending: true });
    await expect(Certificate.Mutation.requestCertificate(null, request, { dataSources: ds }))
      .rejects.toThrow(/conclua seu cadastro/);
    expect(ds.managerIntegration.createCertificate).not.toHaveBeenCalled();
    expect(ds.managerIntegration.accountSetup).toHaveBeenCalled();
  });

  it('autoatendimento com o cadastro concluído: emite como antes', async () => {
    const ds = makeDataSources({ pending: false });
    const out = await Certificate.Mutation.requestCertificate(null, request, { dataSources: ds });
    expect(ds.managerIntegration.createCertificate).toHaveBeenCalled();
    expect(out).toBeTruthy();
  });

  it('emissão pelo admin: a pessoa com senha pendente vira erro da linha, as outras saem', async () => {
    const ds = makeDataSources({ pending: true });
    ds.managerIntegration.findUserByCpf = vi.fn(async (cpf) => (cpf === '52998224725' ? { id: 3, email: 'ana@x.io' } : null));
    const out = await Certificate.Mutation.issueCertificates(
      null,
      {
        eventId: 'e1',
        entries: [
          { name: 'Ana', identifier: '52998224725', email: 'ana@x.io' },
          { name: 'Caio', identifier: '11144477735', email: 'caio@x.io' },
        ],
        actions: { register: true, email: false },
      },
      { dataSources: ds, user: ORGANIZER },
    );
    expect(out.issued).toBe(1);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatch(/Ana.*cadastro pendente/);
  });
});
