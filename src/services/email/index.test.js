import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail, sendEmailUntracked, setDeliveryRecorder, transactionalDelivery } from './index';

// vi.mock is hoisted above the imports by vitest; no real SMTP.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

beforeEach(() => {
  vi.clearAllMocks();
  setDeliveryRecorder(null);
  sendMail.mockResolvedValue({ messageId: 'm1' });
});

describe('sendEmail', () => {
  it('passes the attachments through to nodemailer', async () => {
    const attachments = [{ filename: 'ingresso.png', content: Buffer.from('x'), cid: 'ticket-qr' }];
    const out = await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>', attachments });
    expect(out).toEqual({ success: true, messageId: 'm1' });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'ana@x.io', attachments });
  });

  it('sends no attachments key when there are none', async () => {
    await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>' });
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('attachments');
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('headers');
  });

  it('passes extra headers through (List-Unsubscribe, REA-29)', async () => {
    const headers = { 'List-Unsubscribe': '<https://x/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>', headers });
    expect(sendMail.mock.calls[0][0]).toMatchObject({ headers });
  });

  it('reports an SMTP failure instead of throwing', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    const out = await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>' });
    expect(out).toEqual({ success: false, error: 'smtp down' });
  });
});

describe('daily count of every e-mail (REA-26)', () => {
  it('records each sent e-mail with its kind', async () => {
    const recorder = vi.fn().mockResolvedValue({});
    setDeliveryRecorder(recorder);

    await sendEmail({ kind: 'login-code', to: 'ana@x.io', subject: 'Código', html: '<p/>' });

    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('kind');
    expect(recorder).toHaveBeenCalledTimes(1);
    expect(recorder.mock.calls[0][0]).toMatchObject({
      campaign_document_id: 'transactional:login-code',
      email: 'ana@x.io',
      status: 'sent',
      error: null,
    });
    expect(recorder.mock.calls[0][0].key).toMatch(/^tx:/);
  });

  it('records a refused e-mail as failed and still answers the failure', async () => {
    const recorder = vi.fn().mockResolvedValue({});
    setDeliveryRecorder(recorder);
    sendMail.mockRejectedValue(new Error('550 daily limit exceeded'));

    const out = await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>' });

    expect(out).toEqual({ success: false, error: '550 daily limit exceeded' });
    expect(recorder.mock.calls[0][0]).toMatchObject({
      campaign_document_id: 'transactional:email', status: 'failed', error: '550 daily limit exceeded',
    });
  });

  it('never fails the e-mail when the record fails', async () => {
    setDeliveryRecorder(vi.fn().mockRejectedValue(new Error('strapi down')));
    const out = await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>' });
    expect(out.success).toBe(true);

    setDeliveryRecorder(() => { throw new Error('boom'); });
    expect((await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>' })).success).toBe(true);
  });

  it('does not record e-mails sent untracked (campaigns record their own)', async () => {
    const recorder = vi.fn();
    setDeliveryRecorder(recorder);
    await sendEmailUntracked({ to: 'ana@x.io', subject: 'Oi', html: '<p/>' });
    expect(recorder).not.toHaveBeenCalled();
  });

  it('REA-50: puts the ref in the key, still unique, and drops odd characters', () => {
    const a = transactionalDelivery({ kind: 'signup-confirmation', ref: 'sc:42', to: 'a@x.io', result: { success: true } });
    expect(a.key).toMatch(/^tx:sc:42:[0-9a-f-]{36}$/);
    expect(a.campaign_document_id).toBe('transactional:signup-confirmation');
    const odd = transactionalDelivery({ ref: 'sc:4 2/?', to: 'a@x.io', result: { success: true } });
    expect(odd.key).toMatch(/^tx:sc:42:/);
  });

  it('passes the ref of sendEmail to the record', async () => {
    const recorder = vi.fn();
    setDeliveryRecorder(recorder);
    await sendEmail({ kind: 'signup-confirmation', ref: 'sc:7', to: 'ana@x.io', subject: 'Oi', html: '<p/>' });
    expect(recorder.mock.calls[0][0].key).toMatch(/^tx:sc:7:/);
  });

  it('builds unique keys', () => {
    const a = transactionalDelivery({ to: 'a@x.io', result: { success: true } });
    const b = transactionalDelivery({ to: 'a@x.io', result: { success: true } });
    expect(a.key).not.toBe(b.key);
  });
});
