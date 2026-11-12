import axios from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import payments from './eventando-manager/payments';

vi.mock('axios', () => ({ default: vi.fn() }));
vi.spyOn(console, 'log').mockImplementation(() => {});
beforeEach(() => vi.clearAllMocks());

const rejectWith = (status, data) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  axios.mockRejectedValueOnce(err);
};

describe('datasources do REA-34 (aprovação manual)', () => {
  it('manualApprovalPreview: GET com event_id e signup_id, avisos preservados', async () => {
    axios.mockResolvedValueOnce({
      data: { approvable: true, reason: null, status: 'EXPIRED', warnings: ['BATCH_FULL', 'COUPON_EXHAUSTED'] },
    });
    const out = await payments({ headers: {} }).manualApprovalPreview({ eventId: 42, signupId: '9' });
    expect(out).toEqual({ approvable: true, reason: null, status: 'EXPIRED', warnings: ['BATCH_FULL', 'COUPON_EXHAUSTED'] });
    expect(axios).toHaveBeenLastCalledWith(expect.objectContaining({
      method: 'GET', url: expect.stringMatching(/\/api\/payment\/manual-approval\/preview\?event_id=42&signup_id=9$/),
    }));
  });

  it('approveSignupManually: POST com quem aprovou', async () => {
    axios.mockResolvedValueOnce({
      data: {
        approved: true,
        already_approved: false,
        warnings: [],
        payment: { id: 5, status: 'CONFIRMED', manual_approved_by: { id: 'u1', email: 'a@x.io', name: 'A' } },
        signup: { id: 9, documentId: 'doc-9', email: 'ana@x.io' },
        event: { id: 42, uuid: 'u', slug: 'meetup' },
      },
    });
    const approvedBy = { id: 'u1', email: 'a@x.io', name: 'A' };
    const out = await payments({ headers: {} }).approveSignupManually({ eventId: 42, signupId: '9', approvedBy });
    expect(out).toMatchObject({ approved: true, signup: { documentId: 'doc-9' }, event: { slug: 'meetup' } });
    expect(axios).toHaveBeenLastCalledWith(expect.objectContaining({
      method: 'POST',
      url: expect.stringMatching(/\/api\/payment\/manual-approval$/),
      data: { event_id: 42, signup_id: '9', approved_by: approvedBy },
    }));
  });

  it('404/409 do Eventando chegam com o code', async () => {
    rejectWith(409, { error: { code: 'REFUNDED' } });
    await expect(payments({ headers: {} }).approveSignupManually({ eventId: 42, signupId: '9', approvedBy: {} }))
      .rejects.toMatchObject({ code: 'REFUNDED', status: 409 });
    rejectWith(404, { error: { code: 'NOT_FOUND' } });
    await expect(payments({ headers: {} }).approveSignupManually({ eventId: 42, signupId: '9', approvedBy: {} }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
