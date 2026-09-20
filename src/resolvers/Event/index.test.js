import { describe, it, expect, vi, beforeEach } from 'vitest';
import Event from './index';

// vi.mock is hoisted above the imports by vitest.
vi.mock('../../dataSources/pubsub', () => ({ default: { publish: vi.fn(), asyncIterator: vi.fn() } }));
vi.mock('../../services/email', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

const makeDataSources = ({ signup, existing = [] } = {}) => ({
  eventandoIntegration: {
    findEventBySlug: vi.fn().mockResolvedValue({ data: [{ id: 42, name: 'Meetup' }] }),
    findSignupByEmail: vi.fn().mockResolvedValue({ data: existing }),
    signup: vi.fn().mockResolvedValue(signup),
  },
  manager: {
    findEvents: vi.fn().mockResolvedValue({ data: [{ slug: 'meetup', call_link: null }] }),
  },
  // Used by the fire-and-forget confirmation email after signupToEvent.
  managerIntegration: {
    findEventBySlug: vi.fn().mockResolvedValue({ data: [] }),
    findUserByEmail: vi.fn().mockResolvedValue(null),
  },
});

beforeEach(() => vi.clearAllMocks());

describe('isUserSignedUp', () => {
  it('returns the signup id (documentId) so the page can render the ticket QR', async () => {
    const dataSources = makeDataSources({ existing: [{ id: 7, documentId: 'abc123', email: 'ana@x.io' }] });
    const out = await Event.Query.isUserSignedUp(null, { eventId: 'meetup', email: 'ana@x.io' }, { dataSources });
    expect(out).toEqual({ is_signed_up: true, call_link: null, signup_id: 'abc123' });
  });

  it('has no signup id when the user is not signed up', async () => {
    const dataSources = makeDataSources();
    const out = await Event.Query.isUserSignedUp(null, { eventId: 'meetup', email: 'ana@x.io' }, { dataSources });
    expect(out).toEqual({ is_signed_up: false, call_link: null });
  });
});

describe('signupToEvent', () => {
  const args = { eventId: 'meetup', name: 'Ana', email: 'ana@x.io', batch_id: '3' };

  it('returns the created signup id alongside the payment payload', async () => {
    const dataSources = makeDataSources({ signup: { id: 9, documentId: 'sig9', is_free: true, qr_code: null } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources });
    expect(out).toMatchObject({ success: true, is_free: true, signup_id: 'sig9' });
  });

  it('falls back to the numeric id when Eventando returns no documentId', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: false } } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources });
    expect(out.signup_id).toBe('9');
  });

  it('returns no signup id on a business error', async () => {
    const dataSources = makeDataSources({ signup: { status: 'error', message: 'Lote esgotado' } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources });
    expect(out).toEqual({ success: false, message: 'Lote esgotado', payment: null, is_free: false });
  });
});
