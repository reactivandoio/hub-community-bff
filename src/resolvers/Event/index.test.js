import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSignupConfirmation } from '../../services/email/signup-confirmation';
import Event from './index';

// vi.mock is hoisted above the imports by vitest.
vi.mock('../../dataSources/pubsub', () => ({ default: { publish: vi.fn(), asyncIterator: vi.fn() } }));

// These tests cover what each resolver does once allowed; who is allowed is covered
// in utils/auth/index.test.js and in the authorization tests below.
const ADMIN = { documentId: 'u-admin', email: 'admin@x.io', role: { type: 'admin' } };
const ANA = { documentId: 'u-ana', email: 'ana@x.io', role: { type: 'authenticated' } };
vi.mock('../../services/email/signup-confirmation', () => ({
  sendSignupConfirmation: vi.fn().mockResolvedValue({ success: true }),
}));

const makeDataSources = ({ signup, existing = [] } = {}) => ({
  eventandoIntegration: {
    findEventBySlug: vi.fn().mockResolvedValue({ data: [{ id: 42, name: 'Meetup' }] }),
    findSignupByEmail: vi.fn().mockResolvedValue({ data: existing }),
    signup: vi.fn().mockResolvedValue(signup),
  },
  manager: {
    findEvents: vi.fn().mockResolvedValue({ data: [{ slug: 'meetup', call_link: null }] }),
  },
  managerIntegration: {},
});

beforeEach(() => vi.clearAllMocks());

describe('isUserSignedUp', () => {
  it('returns the signup id (documentId) so the page can render the ticket QR', async () => {
    const dataSources = makeDataSources({ existing: [{ id: 7, documentId: 'abc123', email: 'ana@x.io' }] });
    const out = await Event.Query.isUserSignedUp(null, { eventId: 'meetup', email: 'ana@x.io' }, { dataSources, user: ANA });
    expect(out).toEqual({ is_signed_up: true, call_link: null, signup_id: 'abc123' });
  });

  it('has no signup id when the user is not signed up', async () => {
    const dataSources = makeDataSources();
    const out = await Event.Query.isUserSignedUp(null, { eventId: 'meetup', email: 'ana@x.io' }, { dataSources, user: ANA });
    expect(out).toEqual({ is_signed_up: false, call_link: null });
  });
});

describe('signupToEvent', () => {
  const args = { eventId: 'meetup', name: 'Ana', email: 'ana@x.io', batch_id: '3', adult_declaration: true };

  it('returns the created signup id alongside the payment payload', async () => {
    const dataSources = makeDataSources({ signup: { id: 9, documentId: 'sig9', is_free: true, qr_code: null } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources, user: ADMIN });
    expect(out).toMatchObject({ success: true, is_free: true, signup_id: 'sig9' });
  });

  it('sends the confirmation e-mail with the signup id, without waiting for it', async () => {
    sendSignupConfirmation.mockReturnValueOnce(new Promise(() => {}));
    const dataSources = makeDataSources({ signup: { id: 9, documentId: 'sig9', is_free: true } });
    const out = await Event.Mutation.signupToEvent(null, { ...args, phone_number: '62999' }, { dataSources, user: ADMIN });
    expect(out.success).toBe(true);
    expect(sendSignupConfirmation).toHaveBeenCalledWith({
      dataSources,
      eventSlug: 'meetup',
      eventandoEvent: { id: 42, name: 'Meetup' },
      signupId: 'sig9',
      name: 'Ana',
      email: 'ana@x.io',
      phone: '62999',
      isFree: true,
    });
  });

  it('does not e-mail on a business error', async () => {
    const dataSources = makeDataSources({ signup: { status: 'error', message: 'Lote esgotado' } });
    await Event.Mutation.signupToEvent(null, args, { dataSources, user: ADMIN });
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
  });

  it('falls back to the numeric id when Eventando returns no documentId', async () => {
    const dataSources = makeDataSources({ signup: { data: { id: 9, is_free: false } } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources, user: ADMIN });
    expect(out.signup_id).toBe('9');
  });

  it('returns no signup id on a business error', async () => {
    const dataSources = makeDataSources({ signup: { status: 'error', message: 'Lote esgotado' } });
    const out = await Event.Mutation.signupToEvent(null, args, { dataSources, user: ADMIN });
    expect(out).toEqual({ success: false, message: 'Lote esgotado', payment: null, is_free: false });
  });
});

describe('events', () => {
  const listableClause = { or: [{ unlisted: { eq: false } }, { unlisted: { null: true } }] };

  it('hides unlisted events by default', async () => {
    const dataSources = makeDataSources();
    await Event.Query.events(null, {}, { dataSources, user: ADMIN });
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
    await Event.Query.events(null, { filters, search: 'meetup' }, { dataSources, user: ADMIN });
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
    await Event.Query.events(null, { filters, include_unlisted: true }, { dataSources, user: ADMIN });
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
    await Event.Mutation.createEvent(null, { data }, { dataSources, user: ADMIN });
    expect(dataSources.managerIntegration.createEvent.mock.calls[0][0])
      .toMatchObject({ unlisted: true });
  });

  it('does not send `unlisted` to Eventando, which rejects unknown keys', async () => {
    const dataSources = makeWriteDataSources();
    await Event.Mutation.createEvent(null, { data }, { dataSources, user: ADMIN });
    expect(dataSources.eventandoIntegration.createEvent.mock.calls[0][0]).not.toHaveProperty('unlisted');
  });

  it('defaults to listed when the form omits the flag', async () => {
    const dataSources = makeWriteDataSources();
    await Event.Mutation.createEvent(null, { data: { title: 'Meetup' } }, { dataSources, user: ADMIN });
    expect(dataSources.managerIntegration.createEvent.mock.calls[0][0])
      .toMatchObject({ unlisted: false });
  });
});

// REA-45: "liberar a arte para quem não está inscrito", per event.
describe('share_art_open', () => {
  it('is false for an event saved before the field existed', () => {
    expect(Event.Event.share_art_open({})).toBe(false);
    expect(Event.Event.share_art_open({ share_art_open: null })).toBe(false);
    expect(Event.Event.share_art_open({ share_art_open: true })).toBe(true);
  });

  const makeCreateDataSources = () => ({
    managerIntegration: {
      createEvent: vi.fn().mockResolvedValue({ data: { documentId: 'ev1' } }),
    },
    eventandoIntegration: {
      createEvent: vi.fn().mockResolvedValue({ data: { id: 1, uuid: 'ev1' } }),
    },
  });

  const makeUpdateDataSources = () => ({
    managerIntegration: {
      updateEvent: vi.fn().mockResolvedValue({ data: { documentId: 'ev1' } }),
    },
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 1, uuid: 'ev1' }] }),
      updateEvent: vi.fn().mockResolvedValue({ data: { id: 1, uuid: 'ev1' } }),
    },
  });

  const base = { title: 'Meetup', start_date: '2026-10-01', end_date: '2026-10-01' };

  it('is saved in the manager on create, off when omitted, never sent to Eventando', async () => {
    const on = makeCreateDataSources();
    await Event.Mutation.createEvent(null, { data: { ...base, share_art_open: true } }, { dataSources: on, user: ADMIN });
    expect(on.managerIntegration.createEvent.mock.calls[0][0]).toMatchObject({ share_art_open: true });
    expect(on.eventandoIntegration.createEvent.mock.calls[0][0]).not.toHaveProperty('share_art_open');

    const omitted = makeCreateDataSources();
    await Event.Mutation.createEvent(null, { data: base }, { dataSources: omitted, user: ADMIN });
    expect(omitted.managerIntegration.createEvent.mock.calls[0][0]).toMatchObject({ share_art_open: false });
  });

  it('is switched on and off on update, never sent to Eventando', async () => {
    for (const value of [true, false]) {
      const dataSources = makeUpdateDataSources();
      await Event.Mutation.updateEvent(null, { id: 'ev1', data: { ...base, share_art_open: value } }, { dataSources, user: ADMIN });
      expect(dataSources.managerIntegration.updateEvent.mock.calls[0][1]).toMatchObject({ share_art_open: value });
      expect(dataSources.eventandoIntegration.updateEvent.mock.calls[0][1]).not.toHaveProperty('share_art_open');
    }
  });

  it('is left as it is when the form does not send it (an older frontend)', async () => {
    for (const data of [base, { ...base, share_art_open: null }]) {
      const dataSources = makeUpdateDataSources();
      await Event.Mutation.updateEvent(null, { id: 'ev1', data }, { dataSources, user: ADMIN });
      expect(dataSources.managerIntegration.updateEvent.mock.calls[0][1]).not.toHaveProperty('share_art_open');
    }
  });
});

// REA-48: a manager of the event edits it, but neither moves it to another community nor deletes it.
describe('updateEvent / deleteEvent — event managers (REA-48)', () => {
  const EVA = { id: 7, documentId: 'u-eva', email: 'eva@x.io', role: { type: 'event-manager' } };
  const ANA_CM = { id: 2, documentId: 'u-ana', email: 'ana@x.io', role: { type: 'community-manager' } };
  const MANAGED = {
    documentId: 'ev1',
    slug: 'meetup',
    communities: [{ documentId: 'c-1', organizers: [{ documentId: 'u-ana' }] }],
    managers: [{ documentId: 'u-eva' }],
  };
  const makeUpdate = () => ({
    managerIntegration: {
      findEventWithOrganizers: vi.fn().mockResolvedValue(MANAGED),
      updateEvent: vi.fn().mockResolvedValue({ data: { documentId: 'ev1' } }),
      deleteEvent: vi.fn().mockResolvedValue({ data: { documentId: 'ev1' } }),
      findCommunityById: vi.fn().mockResolvedValue({ data: { events: [] } }),
      updateCommunity: vi.fn().mockResolvedValue({}),
      updateTalk: vi.fn().mockResolvedValue({}),
    },
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 1, uuid: 'ev1' }] }),
      updateEvent: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      findEventBySlug: vi.fn().mockResolvedValue({ data: [] }),
    },
  });
  const base = { title: 'Meetup', start_date: '2026-10-01', end_date: '2026-10-01' };

  it('lets the manager save the event, ignoring the communities it sends', async () => {
    const dataSources = makeUpdate();
    await Event.Mutation.updateEvent(null, { id: 'ev1', data: { ...base, communities: ['c-other'] } }, { dataSources, user: EVA });
    expect(dataSources.managerIntegration.updateEvent.mock.calls[0][1].communities).toBeUndefined();
    expect(dataSources.managerIntegration.updateCommunity).not.toHaveBeenCalled();
  });

  it('keeps the communities of an owner', async () => {
    const dataSources = makeUpdate();
    await Event.Mutation.updateEvent(null, { id: 'ev1', data: { ...base, communities: ['c-1'] } }, { dataSources, user: ANA_CM });
    expect(dataSources.managerIntegration.updateEvent.mock.calls[0][1].communities).toEqual(['c-1']);
  });

  it('does not let the manager delete the event', async () => {
    const dataSources = makeUpdate();
    let code = null;
    try {
      await Event.Mutation.deleteEvent(null, { id: 'ev1' }, { dataSources, user: EVA });
    } catch (err) {
      code = err.extensions?.code;
    }
    expect(code).toBe('FORBIDDEN');
    expect(dataSources.managerIntegration.deleteEvent).not.toHaveBeenCalled();
  });
});
