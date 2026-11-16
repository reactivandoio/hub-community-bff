// REA-50: what the participants list says about each signup's "Inscrição confirmada" e-mail, read
// from the delivery records (services/email: key `tx:sc:<signupId>:<uuid>`). Only the sends made
// after REA-50 carry the signup; older ones are unknown (null).

// Kinds of the delivery record (services/email) — the first send and a resend from the
// participants list — and its ref, so each record points at its signup.
export const SIGNUP_CONFIRMATION_KIND = 'signup-confirmation';
export const SIGNUP_CONFIRMATION_RESEND_KIND = 'signup-confirmation-resend';
export const signupConfirmationRef = (signupId) => (signupId ? `sc:${signupId}` : null);

export const CONFIRMATION_KINDS = [SIGNUP_CONFIRMATION_KIND, SIGNUP_CONFIRMATION_RESEND_KIND];

const RESEND_CAMPAIGN = `transactional:${SIGNUP_CONFIRMATION_RESEND_KIND}`;

/** Seconds between two resends of the same signup (double clicks, two admins at once). */
export const RESEND_COOLDOWN_SECONDS = 60;

const signupIdOfKey = (key) => {
  const match = /^tx:sc:(.+):[0-9a-f-]{36}$/i.exec(String(key || ''));
  return match ? match[1] : null;
};

const timeOf = (row) => new Date(row?.sent_at || 0).getTime() || 0;

/**
 * Map signupId → { status: 'sent' | 'failed', at, error, resent_at } — the last send (first one or
 * resend) and the last resend. Rows of other signups are ignored.
 */
export const confirmationStatusBySignup = (rows, signupIds) => {
  const wanted = new Set((signupIds || []).filter(Boolean).map(String));
  const out = new Map();
  (rows || []).forEach((row) => {
    const signupId = signupIdOfKey(row?.key);
    if (!signupId || !wanted.has(signupId)) return;
    const current = out.get(signupId) || { status: null, at: null, error: null, resent_at: null };
    const at = timeOf(row);
    if (!current.at || at >= new Date(current.at).getTime()) {
      current.status = row.status === 'sent' ? 'sent' : 'failed';
      current.at = row.sent_at || null;
      current.error = row.status === 'sent' ? null : row.error || null;
    }
    if (row.campaign_document_id === RESEND_CAMPAIGN && row.status !== 'skipped'
      && (!current.resent_at || at > new Date(current.resent_at).getTime())) {
      current.resent_at = row.sent_at || null;
    }
    out.set(signupId, current);
  });
  return out;
};

/** Seconds left before this signup may be resent again (0 = now). */
export const resendWaitSeconds = (status, now = new Date()) => {
  if (!status?.resent_at) return 0;
  const elapsed = (now.getTime() - new Date(status.resent_at).getTime()) / 1000;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed));
};

// Mailgun refusals for the plan's limit come as SMTP 4xx/5xx with words like these.
const QUOTA_PATTERN = /quota|limit|exceed|too many/i;

/** The message the admin sees when the e-mail could not be sent. */
export const confirmationFailureMessage = (error) => {
  const text = String(error || '');
  if (QUOTA_PATTERN.test(text)) {
    return 'O provedor de e-mail recusou o envio: a cota de e-mails do dia provavelmente acabou. '
      + 'Tente de novo amanhã (o limite volta à meia-noite).';
  }
  return `Não foi possível enviar o e-mail${text ? ` (${text})` : ''}. Tente novamente em instantes.`;
};
