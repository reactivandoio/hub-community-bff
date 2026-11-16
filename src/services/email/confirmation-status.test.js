import { describe, it, expect } from 'vitest';
import {
  RESEND_COOLDOWN_SECONDS,
  confirmationFailureMessage,
  confirmationStatusBySignup,
  resendWaitSeconds,
} from './confirmation-status';

const UUID = '0b6f3c1e-1111-4a4a-8b8b-123456789abc';
const row = (signupId, extra = {}) => ({
  key: `tx:sc:${signupId}:${UUID}`,
  campaign_document_id: 'transactional:signup-confirmation',
  status: 'sent',
  sent_at: '2026-11-14T10:00:00.000Z',
  ...extra,
});

describe('confirmationStatusBySignup (REA-50)', () => {
  it('reads the last send of each signup and the last resend', () => {
    const status = confirmationStatusBySignup([
      row('1', { status: 'failed', error: '421 limit', sent_at: '2026-11-14T10:00:00.000Z' }),
      row('1', { campaign_document_id: 'transactional:signup-confirmation-resend', sent_at: '2026-11-15T09:00:00.000Z' }),
      row('2', { status: 'failed', error: 'quota exceeded' }),
    ], ['1', '2', '3']);

    expect(status.get('1')).toEqual({ status: 'sent', at: '2026-11-15T09:00:00.000Z', error: null, resent_at: '2026-11-15T09:00:00.000Z' });
    expect(status.get('2')).toMatchObject({ status: 'failed', error: 'quota exceeded', resent_at: null });
    expect(status.has('3')).toBe(false);
  });

  it('ignores other signups, old records without a signup and other e-mails', () => {
    const status = confirmationStatusBySignup([
      row('9'),
      { key: `tx:${UUID}`, campaign_document_id: 'transactional:signup-confirmation', status: 'sent' },
      { key: 'campaign1:ana@x.io', campaign_document_id: 'campaign1', status: 'sent' },
    ], ['1']);
    expect(status.size).toBe(0);
  });

  it('keeps a failed first send when nothing came after it', () => {
    const status = confirmationStatusBySignup([row('1', { status: 'failed', error: 'x' })], ['1']);
    expect(status.get('1').status).toBe('failed');
  });
});

describe('resendWaitSeconds', () => {
  it('asks to wait a minute after a resend', () => {
    const now = new Date('2026-11-15T09:00:20.000Z');
    expect(resendWaitSeconds({ resent_at: '2026-11-15T09:00:00.000Z' }, now)).toBe(RESEND_COOLDOWN_SECONDS - 20);
    expect(resendWaitSeconds({ resent_at: '2026-11-15T08:58:00.000Z' }, now)).toBe(0);
    expect(resendWaitSeconds(null, now)).toBe(0);
  });
});

describe('confirmationFailureMessage', () => {
  it('says when the daily quota is the likely cause', () => {
    expect(confirmationFailureMessage('421 Domain example.com has exceeded its daily limit')).toMatch(/cota de e-mails do dia/);
  });

  it('shows the provider message otherwise', () => {
    expect(confirmationFailureMessage('connect ECONNREFUSED')).toBe(
      'Não foi possível enviar o e-mail (connect ECONNREFUSED). Tente novamente em instantes.',
    );
  });
});
