import crypto from 'crypto';
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

// REA-26: every e-mail counts against the Mailgun plan, so each one sent through `sendEmail` is
// recorded (as an `email-campaign-delivery` of the pseudo campaign "transactional:<kind>") and the
// campaign queue sees it in its daily count (services/email-campaign/quota). The recorder is
// registered at startup (src/index.js); without one (tests, scripts) nothing is recorded.
let deliveryRecorder = null;

export const setDeliveryRecorder = (recorder) => {
  deliveryRecorder = typeof recorder === 'function' ? recorder : null;
};

export const transactionalDelivery = ({ kind, to, result, now = new Date() }) => ({
  key: `tx:${crypto.randomUUID()}`,
  campaign_document_id: `transactional:${kind || 'email'}`,
  email: String(to || ''),
  status: result?.success ? 'sent' : 'failed',
  error: result?.success ? null : String(result?.error || 'erro'),
  sent_at: now.toISOString(),
});

// Never delays nor fails the e-mail: a lost record only makes the count a bit low.
const recordDelivery = (kind, to, result) => {
  if (!deliveryRecorder) return;
  try {
    Promise.resolve(deliveryRecorder(transactionalDelivery({ kind, to, result })))
      .catch((err) => console.error(`[Email] could not record delivery (${kind || 'email'}): ${err.message}`));
  } catch (err) {
    console.error(`[Email] could not record delivery (${kind || 'email'}): ${err.message}`);
  }
};

// `attachments` goes to nodemailer as is — e.g. an inline image referenced
// from the HTML as `cid:<cid>`. `headers` too — e.g. List-Unsubscribe on campaign e-mails (REA-29).
// Not recorded: for senders that record their own delivery (campaigns, age review).
export const sendEmailUntracked = async ({ to, subject, html, from, replyTo, attachments, headers }) => {
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
    // A refusal by Mailgun (e.g. the plan's daily limit) lands here too, with its SMTP message.
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Sends a transactional e-mail and records it in the day's count. `kind` names it in the record
 * ("login-code", "signup-confirmation"…). Never throws: resolves { success, messageId?, error? }.
 */
export const sendEmail = async ({ kind, ...message }) => {
  const result = await sendEmailUntracked(message);
  recordDelivery(kind, message.to, result);
  return result;
};

export default { sendEmail, sendEmailUntracked };
