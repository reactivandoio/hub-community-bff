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

describe('events', () => {
  const listableClause = { or: [{ unlisted: { eq: false } }, { unlisted: { null: true } }] };

  it('hides unlisted events by default', async () => {
    const dataSources = makeDataSources();
    await Event.Query.events(null, {}, { dataSources });
    expect(dataSources.manager.findEvents).toHaveBeenCalledWith(
      { and: [listableClause] },
      undefined,
      undefined,
      undefined,
    );
  });

  it('keeps the caller filters and adds the clause under `and`, never a top-level `or`', async () => {
    const dataSources = makeDataSources();
    const filters = { title: { contains: 'meetup' }, and: [{ slug: { eq: 'x' } }] };
    await Event.Query.events(null, { filters, search: 'meetup' }, { dataSources });
    expect(dataSources.manager.findEvents).toHaveBeenCalledWith(
      { title: { contains: 'meetup' }, and: [{ slug: { eq: 'x' } }, listableClause] },
      undefined,
      undefined,
      'meetup',
    );
  });

  it('returns the unlisted ones too when the caller asks for them', async () => {
    const dataSources = makeDataSources();
    const filters = { title: { contains: 'meetup' } };
    await Event.Query.events(null, { filters, include_unlisted: true }, { dataSources });
    expect(dataSources.manager.findEvents)
      .toHaveBeenCalledWith(filters, undefined, undefined, undefined);
  });
});

describe('Event.unlisted', () => {
  it('is false for an event saved before the field existed', () => {
    expect(Event.Event.unlisted({})).toBe(false);
    expect(Event.Event.unlisted({ unlisted: null })).toBe(false);
    expect(Event.Event.unlisted({ unlisted: true })).toBe(true);
  });
});

describe('createEvent', () => {
  const makeWriteDataSources = () => ({
    managerIntegration: {
      createEvent: vi.fn().mockResolvedValue({ data: { documentId: 'ev1' } }),
    },
    eventandoIntegration: {
      createEvent: vi.fn().mockResolvedValue({ data: { id: 1, uuid: 'ev1' } }),
    },
  });

  const data = { title: 'Meetup', start_date: '2026-10-01', end_date: '2026-10-01', unlisted: true };

  it('saves the listing visibility in the manager', async () => {
    const dataSources = makeWriteDataSources();
    await Event.Mutation.createEvent(null, { data }, { dataSources });
    expect(dataSources.managerIntegration.createEvent.mock.calls[0][0])
      .toMatchObject({ unlisted: true });
  });

  it('does not send `unlisted` to Eventando, which rejects unknown keys', async () => {
    const dataSources = makeWriteDataSources();
    await Event.Mutation.createEvent(null, { data }, { dataSources });
    expect(dataSources.eventandoIntegration.createEvent.mock.calls[0][0]).not.toHaveProperty('unlisted');
  });

  it('defaults to listed when the form omits the flag', async () => {
    const dataSources = makeWriteDataSources();
    await Event.Mutation.createEvent(null, { data: { title: 'Meetup' } }, { dataSources });
    expect(dataSources.managerIntegration.createEvent.mock.calls[0][0])
      .toMatchObject({ unlisted: false });
  });
});
