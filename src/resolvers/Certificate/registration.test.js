import { describe, it, expect, vi, beforeEach } from 'vitest';
import Certificate from './index';

vi.mock('../../services/email/complete-registration', () => ({
  sendCompleteRegistration: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./email', () => ({ sendCertificateEmail: vi.fn().mockResolvedValue({ success: true }) }));

const ORGANIZER = { id: 1, email: 'admin@x.io', role: { type: 'admin' } };
const ANA = { id: 3, email: 'ana@x.io', cpf: '52998224725', date_of_birth: '1990-05-01', phone: '62999990000' };

const makeDataSources = ({ pending = false, account = ANA } = {}) => ({
  managerIntegration: {
    findEventByDocumentId: vi.fn().mockResolvedValue({ data: { documentId: 'e1', title: 'Meetup', end_date: '2020-01-01' } }),
    findCertificateConfigByEvent: vi.fn().mockResolvedValue({ data: [{ enabled: true, allow_self_request: true }] }),
    findCertificateByEventAndIdentifier: vi.fn().mockResolvedValue({ data: [] }),
    findAttendancesByEvent: vi.fn().mockResolvedValue([{ users_permissions_user: { ...account, documentId: 'u3', name: 'Ana' } }]),
    createCertificate: vi.fn().mockResolvedValue({ data: { code: 'ABC', name: 'Ana', identifier: '52998224725' } }),
    findUserByCpf: vi.fn(async (cpf) => (cpf === '52998224725' ? account : null)),
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
const rejection = (promise) => promise.then(() => null, (e) => e);

describe('certificado só com o cadastro concluído (REA-22, regra 6)', () => {
  it('autoatendimento com senha pendente: recusa, explica e reenvia o link', async () => {
    const ds = makeDataSources({ pending: true });
    const err = await rejection(Certificate.Mutation.requestCertificate(null, request, { dataSources: ds }));
    expect(err.message).toMatch(/conclua seu cadastro/);
    expect(err.extensions.code).toBe('REGISTRATION_INCOMPLETE');
    expect(ds.managerIntegration.createCertificate).not.toHaveBeenCalled();
    expect(ds.managerIntegration.accountSetup).toHaveBeenCalled();
  });

  for (const [field, label] of [['cpf', 'CPF'], ['date_of_birth', 'data de nascimento'], ['phone', 'WhatsApp']]) {
    it(`cadastro antigo sem ${label}: recusa e diz à própria pessoa o que falta`, async () => {
      const account = { ...ANA, [field]: null };
      const ds = makeDataSources({ account });
      if (field === 'cpf') ds.managerIntegration.findUserByEmail.mockResolvedValue(account);
      const err = await rejection(Certificate.Mutation.requestCertificate(null, request, { dataSources: ds, user: { email: 'ana@x.io' } }));
      expect(err.extensions).toMatchObject({ code: 'REGISTRATION_INCOMPLETE', missing: [field] });
      expect(err.message).toContain(`falta ${label}`);
      expect(ds.managerIntegration.createCertificate).not.toHaveBeenCalled();
      expect(ds.managerIntegration.accountSetup).not.toHaveBeenCalled();
    });
  }

  it('consulta pela presença também trava (lookupCertificate não emite)', async () => {
    const ds = makeDataSources({ account: { ...ANA, phone: null } });
    const err = await rejection(Certificate.Query.lookupCertificate(null, { eventId: 'e1', identifier: '52998224725' }, { dataSources: ds }));
    expect(err.extensions.code).toBe('REGISTRATION_INCOMPLETE');
    expect(ds.managerIntegration.createCertificate).not.toHaveBeenCalled();
  });

  it('cadastro concluído: emite como antes', async () => {
    const ds = makeDataSources();
    const out = await Certificate.Mutation.requestCertificate(null, request, { dataSources: ds });
    expect(ds.managerIntegration.createCertificate).toHaveBeenCalled();
    expect(out).toBeTruthy();
  });

  it('emissão pelo admin: a linha incompleta vira erro com o que falta, as outras saem', async () => {
    const ds = makeDataSources({ account: { ...ANA, date_of_birth: null } });
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
    expect(out.errors[0]).toMatch(/Ana.*cadastro incompleto: falta data de nascimento/);
  });
});
