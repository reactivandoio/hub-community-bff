import { describe, it, expect, vi, beforeEach } from 'vitest';
import QRCode from 'qrcode';
import { sendEmail } from './index';
import { sendSignupConfirmation, sendSignupConfirmationBatch, ticketUrlFor } from './signup-confirmation';

// vi.mock is hoisted above the imports by vitest. Never reaches nodemailer.
vi.mock('./index', () => ({ sendEmail: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toBuffer: vi.fn() } }));

const PNG = Buffer.from('png');

const makeDataSources = ({ managerEvent = { slug: 'meetup', title: 'Meetup', is_online: false } } = {}) => ({
  managerIntegration: {
    accountSetup: vi.fn().mockResolvedValue({ created: true, token: 'tok' }),
    findEventBySlug: vi.fn().mockResolvedValue({ data: managerEvent ? [managerEvent] : [] }),
  },
});

const args = (dataSources, extra = {}) => ({
  dataSources,
  eventSlug: 'meetup',
  signupId: 's1',
  name: 'Ana',
  email: 'ana@x.io',
  phone: '62999',
  isFree: true,
  ...extra,
});

const sentMail = () => sendEmail.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = 'https://hub.test';
  sendEmail.mockResolvedValue({ success: true, messageId: 'm1' });
  QRCode.toBuffer.mockResolvedValue(PNG);
});

describe('ticketUrlFor', () => {
  it('matches the frontend ticket contract (lib/ticket.ts)', () => {
    expect(ticketUrlFor('https://hub.test/', 'meu evento', 's/1'))
      .toBe('https://hub.test/events/meu%20evento/signup?ticket=s%2F1');
  });
});

describe('sendSignupConfirmation', () => {
  it('sets up the account with the signup data', async () => {
    const dataSources = makeDataSources();
    await sendSignupConfirmation(args(dataSources));
    expect(dataSources.managerIntegration.accountSetup)
      .toHaveBeenCalledWith({ email: 'ana@x.io', name: 'Ana', phone: '62999' });
  });

  it('attaches the ticket QR inline for a free in-person event', async () => {
    await sendSignupConfirmation(args(makeDataSources()));
    expect(QRCode.toBuffer).toHaveBeenCalledWith(
      'https://hub.test/events/meetup/signup?ticket=s1',
      expect.objectContaining({ type: 'png' }),
    );
    const mail = sentMail();
    expect(mail.to).toBe('ana@x.io');
    expect(mail.attachments).toEqual([
      expect.objectContaining({ cid: 'ticket-qr', content: PNG, contentType: 'image/png' }),
    ]);
    expect(mail.html).toContain('cid:ticket-qr');
    expect(mail.html).toContain('https://hub.test/criar-senha?code=tok');
  });

  it('has no QR for an online event', async () => {
    const dataSources = makeDataSources({ managerEvent: { slug: 'meetup', title: 'Live', is_online: true, call_link: 'https://meet.x' } });
    await sendSignupConfirmation(args(dataSources));
    expect(QRCode.toBuffer).not.toHaveBeenCalled();
    expect(sentMail().attachments).toBeUndefined();
    expect(sentMail().html).not.toContain('Seu ingresso');
    expect(sentMail().html).toContain('https://meet.x');
  });

  it('has no QR for a paid event (the PIX is still pending)', async () => {
    await sendSignupConfirmation(args(makeDataSources(), { isFree: false }));
    expect(QRCode.toBuffer).not.toHaveBeenCalled();
    expect(sentMail().attachments).toBeUndefined();
    expect(sentMail().html).toContain('criar-senha?code=tok');
  });

  it('has no QR without a signup id', async () => {
    await sendSignupConfirmation(args(makeDataSources(), { signupId: null }));
    expect(QRCode.toBuffer).not.toHaveBeenCalled();
    expect(sentMail().attachments).toBeUndefined();
  });

  it('has no set-password link when the account already has a password', async () => {
    const dataSources = makeDataSources();
    dataSources.managerIntegration.accountSetup.mockResolvedValue({ created: false, token: null });
    await sendSignupConfirmation(args(dataSources));
    expect(sentMail().html).not.toContain('criar-senha');
  });

  it('reuses an account already set up by the caller instead of asking again', async () => {
    const dataSources = makeDataSources();
    await sendSignupConfirmation(args(dataSources, { account: { created: true, token: 'pre' } }));
    expect(dataSources.managerIntegration.accountSetup).not.toHaveBeenCalled();
    expect(sentMail().html).toContain('criar-senha?code=pre');
  });

  it('still sends, without the set-password link, when account-setup fails', async () => {
    const dataSources = makeDataSources();
    dataSources.managerIntegration.accountSetup.mockRejectedValue(new Error('Not Found'));
    const out = await sendSignupConfirmation(args(dataSources));
    expect(out.success).toBe(true);
    expect(sentMail().html).not.toContain('criar-senha');
    expect(sentMail().attachments).toHaveLength(1);
  });

  it('still sends the ticket link when the QR cannot be generated', async () => {
    QRCode.toBuffer.mockRejectedValue(new Error('qr boom'));
    const out = await sendSignupConfirmation(args(makeDataSources()));
    expect(out.success).toBe(true);
    expect(sentMail().attachments).toBeUndefined();
    expect(sentMail().html).not.toContain('cid:');
    expect(sentMail().html).toContain('https://hub.test/events/meetup/signup?ticket=s1');
  });

  it('still sends when the manager event lookup fails', async () => {
    const dataSources = makeDataSources();
    dataSources.managerIntegration.findEventBySlug.mockRejectedValue(new Error('manager down'));
    const out = await sendSignupConfirmation(args(dataSources));
    expect(out.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('never throws when SMTP fails', async () => {
    sendEmail.mockRejectedValue(new Error('smtp down'));
    const out = await sendSignupConfirmation(args(makeDataSources()));
    expect(out).toEqual({ success: false, error: 'smtp down' });
  });

  it('does nothing without an e-mail', async () => {
    const dataSources = makeDataSources();
    const out = await sendSignupConfirmation(args(dataSources, { email: '' }));
    expect(out.success).toBe(false);
    expect(dataSources.managerIntegration.accountSetup).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('sendSignupConfirmationBatch', () => {
  const signups = Array.from({ length: 12 }, (_, i) => ({ signupId: `s${i}`, name: `P${i}`, email: `p${i}@x.io` }));

  it('sends to every signup, at most 5 at a time, and counts the outcomes', async () => {
    let inFlight = 0;
    let peak = 0;
    sendEmail.mockImplementation(async ({ to }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      inFlight -= 1;
      return to === 'p3@x.io' ? { success: false, error: 'bounce' } : { success: true };
    });

    const out = await sendSignupConfirmationBatch({
      dataSources: makeDataSources(),
      eventSlug: 'meetup',
      signups,
      isFree: true,
      label: 'import',
    });

    expect(sendEmail).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(5);
    expect(out).toEqual({ sent: 11, failed: 1 });
  });

  it('logs the summary line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendSignupConfirmationBatch({
      dataSources: makeDataSources(),
      eventSlug: 'meetup',
      signups: signups.slice(0, 2),
      isFree: true,
      label: 'import',
    });
    expect(log).toHaveBeenCalledWith('[Email] import meetup: 2 enviados, 0 falharam');
    log.mockRestore();
  });
});
