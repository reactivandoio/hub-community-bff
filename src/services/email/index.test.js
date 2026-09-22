import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from './index';

// vi.mock is hoisted above the imports by vitest; no real SMTP.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

beforeEach(() => {
  vi.clearAllMocks();
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
  });

  it('reports an SMTP failure instead of throwing', async () => {
    sendMail.mockRejectedValue(new Error('smtp down'));
    const out = await sendEmail({ to: 'ana@x.io', subject: 'Oi', html: '<p/>' });
    expect(out).toEqual({ success: false, error: 'smtp down' });
  });
});
