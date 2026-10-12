import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendCompleteRegistration } from '../../services/email/complete-registration';
import { pendingAccount, remindRegistration } from '.';
import { createRateLimiter } from '../rate-limit';

vi.mock('../../services/email/complete-registration', () => ({
  sendCompleteRegistration: vi.fn().mockResolvedValue({ success: true }),
}));

const integration = (overrides = {}) => ({
  managerIntegration: {
    findUserByCpf: vi.fn().mockResolvedValue(null),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    accountStatus: vi.fn().mockResolvedValue([]),
    accountSetup: vi.fn().mockResolvedValue({ created: false, token: 'tok' }),
    ...overrides,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('pendingAccount (regra 6: toda conta com senha pendente)', () => {
  it('conta do CPF com senha pendente: devolve a conta', async () => {
    const ds = integration({
      findUserByCpf: vi.fn().mockResolvedValue({ id: 1, email: 'Ana@x.io' }),
      accountStatus: vi.fn().mockResolvedValue([{ email: 'ana@x.io', pending: true }]),
    });
    expect(await pendingAccount(ds, { cpf: '529.982.247-25' })).toMatchObject({ id: 1 });
    expect(ds.managerIntegration.accountStatus).toHaveBeenCalledWith(['ana@x.io']);
  });

  it('cadastro concluído, ou sem conta nenhuma: não trava', async () => {
    const done = integration({
      findUserByEmail: vi.fn().mockResolvedValue({ id: 2, email: 'bia@x.io' }),
      accountStatus: vi.fn().mockResolvedValue([{ email: 'bia@x.io', pending: false }]),
    });
    expect(await pendingAccount(done, { email: 'bia@x.io' })).toBeNull();
    expect(await pendingAccount(integration(), { cpf: '52998224725', email: 'x@x.io' })).toBeNull();
  });

  it('falha na consulta deixa o certificado sair (com log)', async () => {
    const ds = integration({ findUserByCpf: vi.fn().mockRejectedValue(new Error('down')) });
    expect(await pendingAccount(ds, { cpf: '52998224725' })).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('remindRegistration', () => {
  it('reenvia o link de criar senha uma vez na janela e mostra só a máscara', async () => {
    const ds = integration();
    const reminders = createRateLimiter({ limit: 1, windowMs: 60000 });
    const account = { email: 'glad.pedro@gmail.com', name: 'Pedro' };
    const message = await remindRegistration(ds, account, 'Meetup', { reminders });
    await remindRegistration(ds, account, 'Meetup', { reminders });
    expect(message).toContain('glad****@***ail.com');
    expect(message).not.toContain('glad.pedro');
    expect(ds.managerIntegration.accountSetup).toHaveBeenCalledTimes(1);
    expect(sendCompleteRegistration).toHaveBeenCalledWith(expect.objectContaining({ email: 'glad.pedro@gmail.com', token: 'tok' }));
  });
});
