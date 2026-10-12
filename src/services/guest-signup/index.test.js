import { describe, it, expect, vi, beforeEach } from 'vitest';
import { guestSignupToEvent, createGuestLimits, OUTCOMES, MESSAGES } from '.';

const CPF = '52998224725';
const OTHER_CPF = '11144477735';

const args = (extra = {}) => ({
  eventId: 'meetup',
  name: 'Ana Souza',
  email: 'Ana@X.io',
  batch_id: '3',
  phone_number: '+55 62 99999-0000',
  cpf: '529.982.247-25',
  kind: 'PIX_QR',
  ...extra,
});

const makeDataSources = ({
  byCpf = null,
  byEmail = null,
  holder = null,
  signup = { data: { id: 9, is_free: true } },
} = {}) => ({
  eventandoIntegration: {
    findEventBySlug: vi.fn().mockResolvedValue({ data: [{ id: 42, name: 'Meetup', slug: 'meetup' }] }),
    findSignupHolder: vi.fn().mockResolvedValue(holder),
    signup: vi.fn().mockResolvedValue(signup),
  },
  managerIntegration: {
    findUserByCpf: vi.fn().mockResolvedValue(byCpf),
    findUserByEmail: vi.fn().mockResolvedValue(byEmail),
    accountSetup: vi.fn().mockResolvedValue({ created: true, token: 't' }),
    updateUser: vi.fn().mockResolvedValue({}),
  },
});

let mail;
let limits;
const run = (dataSources, extra = {}, ip = '1.1.1.1') =>
  guestSignupToEvent({ dataSources, args: args(extra), clientIp: ip, limits, mail });
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  mail = {
    sendConfirmation: vi.fn().mockResolvedValue({ success: true }),
    sendPaymentPending: vi.fn().mockResolvedValue({ success: true }),
  };
  limits = createGuestLimits();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('guestSignupToEvent: casos do REA-22', () => {
  it('pessoa nova, gratuito: inscreve com o e-mail digitado e manda a confirmação (cria a conta com o CPF)', async () => {
    const ds = makeDataSources();
    const out = await run(ds);
    expect(out).toMatchObject({ success: true, outcome: OUTCOMES.NEW_ACCOUNT, confirmation_sent_to: 'ana@x.io', is_free: true, signup_id: '9' });
    expect(ds.eventandoIntegration.signup).toHaveBeenCalledWith(42, expect.objectContaining({
      email: 'ana@x.io', name: 'Ana Souza', cpf: CPF, batch_id: 3,
    }));
    // The account (and its CPF) is set up by the confirmation e-mail of a free signup.
    expect(mail.sendConfirmation).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@x.io', cpf: CPF, isFree: true }));
  });

  it('pessoa nova, lote pago: devolve o Pix na hora, cria a conta com o CPF e manda o link do pagamento', async () => {
    const ds = makeDataSources({
      signup: { data: { id: 9, is_free: false, pix_br_code: '000201', expires_at: '2026-10-12T15:00:00Z', cpf: CPF } },
    });
    ds.managerIntegration.findUserByEmail
      .mockResolvedValueOnce(null) // resolveAccount
      .mockResolvedValueOnce({ id: 5, email: 'ana@x.io', cpf: null }); // saveMissingCpf
    const out = await run(ds);
    expect(out).toMatchObject({ success: true, outcome: OUTCOMES.NEW_ACCOUNT, is_free: false });
    expect(out.payment.pix_br_code).toBe('000201');
    expect(JSON.stringify(out)).not.toContain(CPF);
    await flush();
    expect(ds.managerIntegration.accountSetup).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@x.io' }));
    expect(ds.managerIntegration.updateUser).toHaveBeenCalledWith(5, { cpf: CPF });
    expect(mail.sendPaymentPending).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@x.io', signupId: '9', eventSlug: 'meetup' }));
    expect(mail.sendConfirmation).not.toHaveBeenCalled();
  });

  it('regra 1: e-mail e CPF da mesma conta: inscreve e avisa o e-mail digitado; não regrava a conta', async () => {
    const ds = makeDataSources({ byCpf: { id: 5, email: 'ana@x.io', cpf: CPF } });
    const out = await run(ds);
    expect(out).toMatchObject({ success: true, outcome: OUTCOMES.EXISTING_ACCOUNT, confirmation_sent_to: 'ana@x.io' });
    expect(mail.sendConfirmation).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@x.io', cpf: undefined }));
    expect(ds.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('regra 2: CPF de outra conta: inscreve na conta dona, descarta o digitado e só mostra a máscara', async () => {
    const owner = { id: 8, email: 'glad.pedro@gmail.com', name: 'Pedro', phone: '62 1111', cpf: CPF };
    const ds = makeDataSources({ byCpf: owner, signup: { data: { id: 9, is_free: true } } });
    const out = await run(ds, { name: 'Outra Pessoa', email: 'outra@x.io', phone_number: '62 2222' });
    expect(out).toMatchObject({
      success: true,
      outcome: OUTCOMES.CPF_OWNER,
      confirmation_sent_to: 'glad****@***ail.com',
      payment: null,
      signup_id: null,
    });
    expect(JSON.stringify(out)).not.toContain('glad.pedro');
    expect(JSON.stringify(out)).not.toContain('Pedro');
    expect(ds.eventandoIntegration.signup).toHaveBeenCalledWith(42, expect.objectContaining({
      email: 'glad.pedro@gmail.com', name: 'Pedro', phone_number: '62 1111', cpf: CPF,
    }));
    expect(mail.sendConfirmation).toHaveBeenCalledWith(expect.objectContaining({ email: 'glad.pedro@gmail.com', cpf: undefined }));
    expect(ds.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('regra 2 em lote pago: o Pix não aparece na tela, vai por e-mail para a conta dona', async () => {
    const owner = { id: 8, email: 'glad.pedro@gmail.com', name: 'Pedro', cpf: CPF };
    const ds = makeDataSources({ byCpf: owner, signup: { data: { id: 9, is_free: false, pix_br_code: '000201' } } });
    const out = await run(ds, { email: 'outra@x.io' });
    expect(out).toMatchObject({ outcome: OUTCOMES.CPF_OWNER, payment: null, is_free: false });
    expect(JSON.stringify(out)).not.toContain('000201');
    await flush();
    expect(mail.sendPaymentPending).toHaveBeenCalledWith(expect.objectContaining({ email: 'glad.pedro@gmail.com' }));
    expect(ds.managerIntegration.accountSetup).not.toHaveBeenCalled();
  });

  it('regra 4: o CPF já tem inscrição: não cria outra e reenvia a confirmação para o e-mail da inscrição (mascarado)', async () => {
    const ds = makeDataSources({
      holder: { signup_id: 77, email: 'glad.pedro@gmail.com', name: 'Pedro', payment_status: 'CONFIRMED', value: 0 },
    });
    const out = await run(ds, { email: 'outra@x.io' });
    expect(out).toMatchObject({ success: true, outcome: OUTCOMES.ALREADY_SIGNED_UP, confirmation_sent_to: 'glad****@***ail.com' });
    expect(ds.eventandoIntegration.findSignupHolder).toHaveBeenCalledWith(42, { cpf: CPF, emails: ['outra@x.io'] });
    expect(ds.eventandoIntegration.signup).not.toHaveBeenCalled();
    expect(mail.sendConfirmation).toHaveBeenCalledWith(expect.objectContaining({ email: 'glad.pedro@gmail.com', signupId: '77', isFree: true }));
  });

  it('regra 4 com Pix pendente: o reenvio leva ao pagamento; o mesmo e-mail digitado aparece sem máscara', async () => {
    const ds = makeDataSources({
      holder: { signup_id: 77, email: 'ana@x.io', name: 'Ana', payment_status: 'PEDING_PAYMENT', value: 1990 },
    });
    const out = await run(ds);
    expect(out).toMatchObject({ outcome: OUTCOMES.ALREADY_SIGNED_UP, confirmation_sent_to: 'ana@x.io' });
    expect(mail.sendPaymentPending).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@x.io', signupId: '77' }));
    expect(mail.sendConfirmation).not.toHaveBeenCalled();
  });

  it('regra 4: o reenvio tem limite; a segunda tentativa logo depois não manda outro e-mail', async () => {
    const ds = makeDataSources({ holder: { signup_id: 77, email: 'ana@x.io', payment_status: 'CONFIRMED', value: 0 } });
    await run(ds);
    const second = await run(ds);
    expect(mail.sendConfirmation).toHaveBeenCalledTimes(1);
    expect(second.message).toMatch(/há pouco/);
  });

  it('regra 4 na corrida: o Eventando recusa com ALREADY_SIGNED_UP e a confirmação é reenviada', async () => {
    const ds = makeDataSources();
    const err = new Error('Você já está inscrito neste evento!');
    err.code = 'ALREADY_SIGNED_UP';
    ds.eventandoIntegration.signup.mockRejectedValue(err);
    ds.eventandoIntegration.findSignupHolder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ signup_id: 77, email: 'ana@x.io', payment_status: 'CONFIRMED', value: 0 });
    const out = await run(ds);
    expect(out.outcome).toBe(OUTCOMES.ALREADY_SIGNED_UP);
    expect(mail.sendConfirmation).toHaveBeenCalledTimes(1);
  });

  it('proposta: e-mail de uma conta com outro CPF (ou sem CPF): inscreve nela e o CPF fica só na inscrição', async () => {
    const ds = makeDataSources({ byEmail: { id: 5, email: 'ana@x.io', cpf: OTHER_CPF } });
    const out = await run(ds);
    expect(out).toMatchObject({ outcome: OUTCOMES.EXISTING_ACCOUNT, confirmation_sent_to: 'ana@x.io' });
    expect(ds.eventandoIntegration.signup).toHaveBeenCalledWith(42, expect.objectContaining({ email: 'ana@x.io', cpf: CPF }));
    expect(mail.sendConfirmation).toHaveBeenCalledWith(expect.objectContaining({ cpf: undefined }));
    expect(ds.managerIntegration.updateUser).not.toHaveBeenCalled();
  });

  it('cupom e meia-entrada seguem para o Eventando com o CPF (um cupom por CPF é regra de lá)', async () => {
    const ds = makeDataSources();
    await run(ds, { coupon_code: 'PROMO10', is_student: true });
    expect(ds.eventandoIntegration.signup).toHaveBeenCalledWith(42, expect.objectContaining({
      coupon_code: 'PROMO10', is_student: true, cpf: CPF,
    }));
  });
});

describe('guestSignupToEvent: validação e limites', () => {
  it('CPF validado no servidor (dígito verificador) e nunca ecoado', async () => {
    const ds = makeDataSources();
    const out = await run(ds, { cpf: '529.982.247-24' });
    expect(out).toMatchObject({ success: false, message: MESSAGES.CPF });
    expect(JSON.stringify(out)).not.toContain('529');
    expect(ds.eventandoIntegration.signup).not.toHaveBeenCalled();
  });

  it('nome e e-mail obrigatórios', async () => {
    expect((await run(makeDataSources(), { name: 'A' })).message).toBe(MESSAGES.NAME);
    expect((await run(makeDataSources(), { email: 'nope' })).message).toBe(MESSAGES.EMAIL);
  });

  it('limite por IP: a 11ª tentativa em 10 minutos é recusada', async () => {
    const results = [];
    for (let i = 0; i < 11; i += 1) {
      // A different valid-looking CPF each time would still hit the IP limit; reuse is fine too.
      // eslint-disable-next-line no-await-in-loop
      results.push(await run(makeDataSources(), { email: `p${i}@x.io` }, '9.9.9.9'));
    }
    expect(results.slice(0, 5).every((r) => r.success)).toBe(true);
    expect(results[10]).toMatchObject({ success: false, message: MESSAGES.TOO_MANY });
  });

  it('limite por CPF: a 6ª tentativa na hora é recusada, mesmo de IPs diferentes', async () => {
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await run(makeDataSources(), {}, `10.0.0.${i}`));
    }
    expect(results.slice(0, 5).every((r) => r.success)).toBe(true);
    expect(results[5].message).toBe(MESSAGES.TOO_MANY);
  });

  it('falha ao procurar a conta: não inscreve (não arrisca criar conta para o CPF de outra pessoa)', async () => {
    const ds = makeDataSources();
    ds.managerIntegration.findUserByCpf.mockRejectedValue(new Error('down'));
    const out = await run(ds);
    expect(out).toMatchObject({ success: false, message: MESSAGES.UNAVAILABLE });
    expect(ds.eventandoIntegration.signup).not.toHaveBeenCalled();
  });

  it('erro do Eventando chega como mensagem', async () => {
    const ds = makeDataSources();
    ds.eventandoIntegration.signup.mockRejectedValue(new Error('Lote esgotado'));
    expect(await run(ds)).toMatchObject({ success: false, message: 'Lote esgotado' });
  });
});
