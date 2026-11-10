import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailgun.org',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USERNAME,
    pass: process.env.SMTP_PASSWORD,
  },
});

const DEFAULT_FROM = process.env.EMAIL_FROM || 'Hub Community <contato@8020digital.com.br>';
const DEFAULT_REPLY_TO = process.env.EMAIL_REPLY_TO || 'contato@8020digital.com.br';

// `attachments` goes to nodemailer as is — e.g. an inline image referenced
// from the HTML as `cid:<cid>`. `headers` too — e.g. List-Unsubscribe on campaign e-mails (REA-29).
export const sendEmail = async ({ to, subject, html, from, replyTo, attachments, headers }) => {
  try {
    const info = await transporter.sendMail({
      from: from || DEFAULT_FROM,
      to,
      subject,
      html,
      replyTo: replyTo || DEFAULT_REPLY_TO,
      ...(attachments?.length ? { attachments } : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
    });
    console.log(`[Email] Sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
};

export default { sendEmail };
