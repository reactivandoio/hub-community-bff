import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from './index';
import { sendCompleteRegistration } from './complete-registration';

// vi.mock is hoisted above the imports by vitest. Never reaches nodemailer.
vi.mock('./index', () => ({ sendEmail: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = 'https://hub.test/';
  sendEmail.mockResolvedValue({ success: true, messageId: 'm1' });
});

describe('sendCompleteRegistration', () => {
  it('e-mails the complete-registration link (login by code, REA-26) with the event name', async () => {
    const out = await sendCompleteRegistration({ email: 'ana@x.io', name: 'Ana <b>', eventTitle: 'Veredas' });
    expect(out.success).toBe(true);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('ana@x.io');
    expect(mail.subject).toContain('Conclua seu cadastro');
    expect(mail.kind).toBe('complete-registration');
    expect(mail.html).toContain('href="https://hub.test/completar-cadastro"');
    expect(mail.html).toContain('código de acesso');
    expect(mail.html).not.toContain('senha</');
    expect(mail.html).not.toContain('criar-senha');
    expect(mail.html).toContain('Veredas');
    expect(mail.html).toContain('Ana &lt;b&gt;');
  });

  it('sends nothing without an e-mail', async () => {
    const out = await sendCompleteRegistration({ email: '', name: 'Ana' });
    expect(out.success).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('never throws when SMTP fails', async () => {
    sendEmail.mockRejectedValue(new Error('smtp down'));
    const out = await sendCompleteRegistration({ email: 'ana@x.io', name: 'Ana' });
    expect(out).toEqual({ success: false, error: 'smtp down' });
  });
});
