import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendCompleteRegistration } from '../../services/email/complete-registration';
import {
  adminIncompleteReason,
  assertRegistrationComplete,
  incompleteMessage,
  missingProfile,
  registrationGap,
  remindPassword,
  REGISTRATION_INCOMPLETE,
} from '.';
import { createRateLimiter } from '../rate-limit';

vi.mock('../../services/email/complete-registration', () => ({
  sendCompleteRegistration: vi.fn().mockResolvedValue({ success: true }),
}));

const COMPLETE = { id: 1, email: 'ana@x.io', cpf: '52998224725', date_of_birth: '1990-05-01', phone: '+55 62 99999-0000' };

const integration = ({ account = COMPLETE, pending = false, ...overrides } = {}) => ({
  managerIntegration: {
    findUserByCpf: vi.fn().mockResolvedValue(account),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    accountStatus: vi.fn().mockResolvedValue(account ? [{ email: account.email, pending }] : []),
    accountSetup: vi.fn().mockResolvedValue({ created: false, token: 'tok' }),
    ...overrides,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('missingProfile: CPF, data de nascimento e WhatsApp', () => {
  it('perfil completo não falta nada', () => {
    expect(missingProfile(COMPLETE)).toEqual([]);
  });
  it('sem CPF (ou CPF que não tem 11 dígitos)', () => {
    expect(missingProfile({ ...COMPLETE, cpf: null })).toEqual(['cpf']);
    expect(missingProfile({ ...COMPLETE, cpf: '123' })).toEqual(['cpf']);
  });
  it('sem data de nascimento', () => {
    expect(missingProfile({ ...COMPLETE, date_of_birth: null })).toEqual(['date_of_birth']);
    expect(missingProfile({ ...COMPLETE, date_of_birth: '  ' })).toEqual(['date_of_birth']);
  });
  it('sem WhatsApp (ou número curto demais)', () => {
    expect(missingProfile({ ...COMPLETE, phone: '' })).toEqual(['phone']);
    expect(missingProfile({ ...COMPLETE, phone: '1234' })).toEqual(['phone']);
  });
  it('faltando os três, na ordem', () => {
    expect(missingProfile({ email: 'a@x.io' })).toEqual(['cpf', 'date_of_birth', 'phone']);
  });
});

describe('registrationGap (toda conta, inclusive as antigas)', () => {
  it('senha criada e perfil completo: não trava', async () => {
    expect(await registrationGap(integration(), { cpf: '52998224725' })).toBeNull();
  });

  it('senha pendente trava mesmo com o perfil completo', async () => {
    expect(await registrationGap(integration({ pending: true }), { cpf: '52998224725' }))
      .toMatchObject({ passwordPending: true, missing: [] });
  });

  it('conta antiga com senha mas sem data de nascimento nem WhatsApp trava', async () => {
    const ds = integration({ account: { ...COMPLETE, date_of_birth: null, phone: null } });
    expect(await registrationGap(ds, { cpf: '52998224725' })).toMatchObject({
      passwordPending: false,
      missing: ['date_of_birth', 'phone'],
    });
  });

  it('achada pelo e-mail sem CPF: o CPF falta', async () => {
    const ds = integration({ account: null });
    ds.managerIntegration.findUserByEmail.mockResolvedValue({ ...COMPLETE, cpf: null });
    ds.managerIntegration.accountStatus.mockResolvedValue([{ email: 'ana@x.io', pending: false }]);
    expect(await registrationGap(ds, { email: 'ana@x.io' })).toMatchObject({ missing: ['cpf'] });
  });

  it('sem conta nenhuma não trava; falha na consulta deixa sair (com log)', async () => {
    expect(await registrationGap(integration({ account: null }), { cpf: '52998224725', email: 'x@x.io' })).toBeNull();
    const down = integration({ findUserByCpf: vi.fn().mockRejectedValue(new Error('down')) });
    expect(await registrationGap(down, { cpf: '52998224725' })).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('mensagem e erro', () => {
  const account = { email: 'glad.pedro@gmail.com' };

  it('a própria pessoa logada lê exatamente o que falta', () => {
    expect(incompleteMessage({ account, passwordPending: false, missing: ['date_of_birth'] }, { isOwner: true }))
      .toBe('Para receber o certificado, complete seu cadastro: falta data de nascimento no seu perfil.');
    expect(incompleteMessage({ account, passwordPending: false, missing: ['cpf', 'date_of_birth', 'phone'] }, { isOwner: true }))
      .toContain('falta CPF, data de nascimento e WhatsApp');
    expect(incompleteMessage({ account, passwordPending: false, missing: ['phone'] }, { isOwner: true }))
      .toContain('falta WhatsApp');
  });

  it('quem só digitou o CPF não descobre o que falta naquela conta: lê os requisitos e a máscara', () => {
    const a = incompleteMessage({ account, passwordPending: false, missing: ['phone'] }, { isOwner: false });
    const b = incompleteMessage({ account, passwordPending: false, missing: ['cpf', 'date_of_birth'] }, { isOwner: false });
    expect(a).toBe(b);
    expect(a).toContain('glad****@***ail.com');
    expect(a).toContain('CPF, data de nascimento e WhatsApp');
    expect(a).not.toContain('glad.pedro');
  });

  it('assertRegistrationComplete lança REGISTRATION_INCOMPLETE e só conta o que falta ao dono', async () => {
    const ds = integration({ account: { ...COMPLETE, phone: null } });
    const owner = await assertRegistrationComplete(ds, { cpf: '52998224725', viewer: { email: 'ANA@x.io' } }).catch((e) => e);
    expect(owner.extensions).toMatchObject({ code: REGISTRATION_INCOMPLETE, password_pending: false, missing: ['phone'] });
    const stranger = await assertRegistrationComplete(ds, { cpf: '52998224725', viewer: null }).catch((e) => e);
    expect(stranger.extensions).toMatchObject({ code: REGISTRATION_INCOMPLETE, missing: null });
    await expect(assertRegistrationComplete(integration(), { cpf: '52998224725' })).resolves.toBeUndefined();
  });

  it('no admin, a linha diz o que falta', () => {
    expect(adminIncompleteReason({ passwordPending: true, missing: ['phone'] }))
      .toBe('cadastro incompleto: senha não criada (enviamos o link de novo); falta WhatsApp');
    expect(adminIncompleteReason({ passwordPending: false, missing: ['cpf', 'date_of_birth'] }))
      .toBe('cadastro incompleto: falta CPF e data de nascimento');
  });
});

describe('remindPassword', () => {
  it('reenvia o link de criar senha uma vez na janela', async () => {
    const ds = integration();
    const reminders = createRateLimiter({ limit: 1, windowMs: 60000 });
    const account = { email: 'glad.pedro@gmail.com', name: 'Pedro' };
    await remindPassword(ds, account, 'Meetup', { reminders });
    await remindPassword(ds, account, 'Meetup', { reminders });
    expect(ds.managerIntegration.accountSetup).toHaveBeenCalledTimes(1);
    expect(sendCompleteRegistration).toHaveBeenCalledWith(expect.objectContaining({ email: 'glad.pedro@gmail.com', token: 'tok' }));
  });
});
