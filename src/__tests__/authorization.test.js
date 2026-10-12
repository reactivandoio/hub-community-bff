import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { EVENT_TYPES } from '../resolvers/Tracking';

vi.mock('../dataSources/pubsub', () => ({ default: { publish: vi.fn(), asyncIterator: vi.fn(() => 'iterator') } }));
vi.mock('../services/email/signup-confirmation', () => ({
  sendSignupConfirmation: vi.fn().mockResolvedValue({ success: true }),
  sendSignupConfirmationBatch: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}));

// Every operation that acts with the integration token on behalf of someone must
// check who that someone is. This table is the list from the LGPD audit (phase 1).
// Merged like src/resolvers/index.js does at boot (which uses require, not available here).
const resolvers = { Query: {}, Mutation: {}, Subscription: {} };
const folders = fs.readdirSync('./src/resolvers', { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);
const modules = await Promise.all(folders.map((folder) => import(`../resolvers/${folder}/index.js`)));
modules.forEach(({ default: resolver }) => {
  ['Query', 'Mutation', 'Subscription'].forEach((type) => Object.assign(resolvers[type], resolver[type]));
});

const ANA = { id: 1, documentId: 'u-ana', email: 'ana@x.io', role: { type: 'authenticated' } };
const BIA = { id: 2, documentId: 'u-bia', email: 'bia@x.io', role: { type: 'authenticated' } };

const EVENT = {
  documentId: 'ev-1',
  slug: 'meetup',
  communities: [{ documentId: 'c-1', organizers: [{ documentId: 'u-ana' }] }],
};

// A data source whose every call fails loudly: a refused request must never reach it.
const untouchable = () => new Proxy({}, {
  get: (_, name) => vi.fn(() => { throw new Error(`reached dataSources.${String(name)}`); }),
});

// Only the reads the authorization needs, all pointing at EVENT (organized by Ana).
const authzDataSources = () => ({
  managerIntegration: new Proxy({
    findEventWithOrganizers: vi.fn().mockResolvedValue(EVENT),
    findCommunityWithOrganizers: vi.fn().mockResolvedValue({ documentId: 'c-1', organizers: [{ documentId: 'u-ana' }] }),
    findTalkWithEvent: vi.fn().mockResolvedValue({ documentId: 't-1', event: { documentId: 'ev-1' } }),
    findCertificateRequestFormWithEvent: vi.fn().mockResolvedValue({ documentId: 'f-1', event: { documentId: 'ev-1' } }),
    findCommentWithAuthor: vi.fn().mockResolvedValue({ documentId: 'cm-1', user_creator: { documentId: 'u-ana' } }),
    findCommentReplyWithAuthor: vi.fn().mockResolvedValue({ documentId: 'r-1', user_creator: { documentId: 'u-ana' } }),
    findRateWithAuthor: vi.fn().mockResolvedValue({ documentId: 'rt-1', users_permissions_user: { documentId: 'u-ana' } }),
  }, {
    get: (target, name) => target[name] || vi.fn(() => { throw new Error(`reached managerIntegration.${String(name)}`); }),
  }),
  eventandoIntegration: untouchable(),
  manager: untouchable(),
  managerAuthenticated: untouchable(),
});

const call = (type, name, args, ctx) => {
  const field = resolvers[type][name];
  if (type === 'Subscription') return field.subscribe(null, args, ctx);
  return field(null, args, ctx);
};

// Takes the call itself, so a resolver that throws synchronously is caught too.
const codeOf = async (run) => {
  try {
    await (typeof run === 'function' ? run() : run);
    return null;
  } catch (err) {
    return err.extensions?.code || err.message;
  }
};

const ev = { eventSlug: 'meetup' };

// [type, name, args, who may do it besides an admin]
const PROTECTED = [
  ['Mutation', 'createEvent', { data: { title: 'x', communities: ['c-1'] } }, 'organizer'],
  ['Mutation', 'updateEvent', { id: 'ev-1', data: { title: 'x' } }, 'organizer'],
  ['Mutation', 'updateEventSale', { id: 'ev-1', data: {} }, 'organizer'],
  ['Mutation', 'deleteEvent', { id: 'ev-1' }, 'organizer'],
  ['Mutation', 'createCommunity', { data: {} }, 'admin'],
  ['Mutation', 'updateCommunity', { id: 'c-1', data: {} }, 'organizer'],
  ['Mutation', 'deleteCommunity', { id: 'c-1' }, 'organizer'],
  ['Mutation', 'createSpeaker', { data: {} }, 'admin'],
  ['Mutation', 'updateSpeaker', { id: 's', data: {} }, 'admin'],
  ['Mutation', 'deleteSpeaker', { id: 's' }, 'admin'],
  ['Mutation', 'createTalk', { data: { title: 'x', event: 'ev-1' } }, 'organizer'],
  ['Mutation', 'updateTalk', { id: 't-1', data: { title: 'x' } }, 'organizer'],
  ['Mutation', 'deleteTalk', { id: 't-1' }, 'organizer'],
  ['Mutation', 'createLocation', { data: {} }, 'admin'],
  ['Mutation', 'updateLocation', { id: 'l', data: {} }, 'admin'],
  ['Mutation', 'deleteLocation', { id: 'l' }, 'admin'],
  ['Mutation', 'createCoupon', { data: {} }, 'admin'],
  ['Mutation', 'updateCoupon', { id: '1', data: {} }, 'admin'],
  ['Mutation', 'deleteCoupon', { id: '1' }, 'admin'],
  ['Mutation', 'createBatch', { data: {} }, 'admin'],
  ['Mutation', 'updateBatch', { id: '1', data: {} }, 'admin'],
  ['Mutation', 'deleteBatch', { id: '1' }, 'admin'],
  ['Mutation', 'createProduct', { data: {} }, 'admin'],
  ['Mutation', 'updateProduct', { id: '1', data: {} }, 'admin'],
  ['Mutation', 'deleteProduct', { id: '1' }, 'admin'],
  ['Mutation', 'importSignups', { ...ev, batchId: '1', signups: [] }, 'organizer'],
  ['Mutation', 'manualSignup', { ...ev, batchId: '1', input: { name: 'x', email: 'x@x.io' } }, 'organizer'],
  ['Mutation', 'updateSignup', { ...ev, signupId: 's1', input: {} }, 'organizer'],
  ['Mutation', 'updateCpfs', { rows: [] }, 'admin'],
  ['Mutation', 'sendImportedSignupConfirmations', ev, 'organizer'],
  ['Mutation', 'checkinSignup', { ...ev, signupId: 's1' }, 'organizer'],
  ['Mutation', 'issueCertificates', { eventId: 'ev-1', entries: [], actions: { register: false } }, 'organizer'],
  ['Mutation', 'upsertCertificateConfig', { eventId: 'ev-1', data: {} }, 'organizer'],
  ['Mutation', 'copyCertificateConfig', { fromEventId: 'ev-0', toEventId: 'ev-1' }, 'organizer'],
  ['Mutation', 'createCertificateRequestForm', { eventId: 'ev-1', data: {} }, 'organizer'],
  ['Mutation', 'updateCertificateRequestForm', { id: 'f-1', data: {} }, 'organizer'],
  ['Mutation', 'deleteCertificateRequestForm', { id: 'f-1' }, 'organizer'],
  ['Query', 'eventSignups', ev, 'organizer'],
  ['Query', 'eventAnalytics', { slugOrId: 'meetup' }, 'organizer'],
  ['Query', 'eventAttendances', { eventDocumentId: 'ev-1' }, 'organizer'],
  ['Query', 'certificateCandidates', { eventId: 'ev-1' }, 'organizer'],
  ['Query', 'certificateRequestForms', { eventId: 'ev-1' }, 'organizer'],
  ['Query', 'users', {}, 'admin'],
  ['Query', 'votingSessions', {}, 'admin'],
  ['Query', 'votingSession', { id: 'vs-1' }, 'admin'],
  ['Mutation', 'createVotingSession', { data: { title: 'x' } }, 'admin'],
  ['Mutation', 'updateVotingSession', { id: 'vs-1', data: {} }, 'admin'],
  ['Mutation', 'deleteVotingSession', { id: 'vs-1' }, 'admin'],
  ['Mutation', 'createVotingOption', { data: { name: 'x', voting_session: 'vs-1' } }, 'admin'],
  ['Mutation', 'updateVotingOption', { id: 'vo-1', data: {} }, 'admin'],
  ['Mutation', 'deleteVotingOption', { id: 'vo-1' }, 'admin'],
  ['Subscription', 'credentialCheckedIn', ev, 'organizer'],
];

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe('protected operations', () => {
  it.each(PROTECTED)('%s.%s refuses an anonymous request before any data source', async (type, name, args) => {
    expect(await codeOf(() => call(type, name, args, { dataSources: untouchable() }))).toBe('UNAUTHENTICATED');
  });

  it.each(PROTECTED)('%s.%s refuses a signed-in user who is not allowed', async (type, name, args) => {
    expect(await codeOf(() => call(type, name, args, { user: BIA, dataSources: authzDataSources() })))
      .toBe('FORBIDDEN');
  });

  it.each(PROTECTED.filter(([, , , who]) => who === 'admin'))(
    '%s.%s refuses an event organizer too (admin only)',
    async (type, name, args) => {
      expect(await codeOf(() => call(type, name, args, { user: ANA, dataSources: authzDataSources() })))
        .toBe('FORBIDDEN');
    },
  );
});

describe('ownership', () => {
  const OWNED = [
    ['deleteComment', { id: 'cm-1' }],
    ['updateCommentReply', { id: 'r-1', input: { message: 'x' } }],
    ['deleteCommentReply', { id: 'r-1' }],
    ['updateRate', { id: 'rt-1', input: { value: 1 } }],
    ['deleteRate', { id: 'rt-1' }],
  ];

  it.each(OWNED)('%s refuses anonymous and somebody who is not the author', async (name, args) => {
    expect(await codeOf(() => call('Mutation', name, args, { dataSources: authzDataSources() }))).toBe('UNAUTHENTICATED');
    expect(await codeOf(() => call('Mutation', name, args, { user: BIA, dataSources: authzDataSources() }))).toBe('FORBIDDEN');
  });

  it('deleteComment deletes for the author', async () => {
    const dataSources = authzDataSources();
    dataSources.managerIntegration.deleteComment = vi.fn().mockResolvedValue({ data: null });
    expect(await call('Mutation', 'deleteComment', { id: 'cm-1' }, { user: ANA, dataSources })).toBe(true);
    expect(dataSources.managerIntegration.deleteComment).toHaveBeenCalledWith('cm-1');
  });

  it('createRate writes the signed-in user as the author, whatever the input says', async () => {
    const dataSources = authzDataSources();
    dataSources.managerIntegration.createRateAsIntegration = vi.fn().mockResolvedValue({ data: {} });
    await call('Mutation', 'createRate', { input: { user: 'u-bia', talk: 't-1', value: 5 } }, { user: ANA, dataSources });
    expect(dataSources.managerIntegration.createRateAsIntegration)
      .toHaveBeenCalledWith({ talk: 't-1', value: 5, users_permissions_user: 'u-ana' });
  });

  it('updateCommentReply cannot hand the reply over to somebody else', async () => {
    const dataSources = authzDataSources();
    dataSources.managerIntegration.updateCommentReplyAsIntegration = vi.fn().mockResolvedValue({ data: {} });
    await call('Mutation', 'updateCommentReply', { id: 'r-1', input: { message: 'x', user_creator: 'u-bia' } }, { user: ANA, dataSources });
    expect(dataSources.managerIntegration.updateCommentReplyAsIntegration).toHaveBeenCalledWith('r-1', { message: 'x' });
  });
});

describe('isUserSignedUp', () => {
  it('needs a user, and only an organizer asks about somebody else', async () => {
    const args = { eventId: 'meetup', email: 'ana@x.io' };
    expect(await codeOf(() => call('Query', 'isUserSignedUp', args, { dataSources: untouchable() }))).toBe('UNAUTHENTICATED');
    expect(await codeOf(() => call('Query', 'isUserSignedUp', args, { user: BIA, dataSources: authzDataSources() }))).toBe('FORBIDDEN');
  });
});

describe('checkinSignup / updateSignup', () => {
  const organizerDataSources = (signupEventId) => {
    const dataSources = authzDataSources();
    dataSources.eventandoIntegration = {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42 }] }),
      findSignupById: vi.fn().mockResolvedValue({ data: { documentId: 's1', email: 'x@x.io', event: { id: signupEventId } } }),
      updateSignup: vi.fn(),
    };
    return dataSources;
  };

  it('refuses a signup from another event, even for the organizer', async () => {
    const dataSources = organizerDataSources(7);
    const out = await call('Mutation', 'checkinSignup', { ...ev, signupId: 's1' }, { user: ANA, dataSources });
    expect(out.success).toBe(false);
    const edit = await call('Mutation', 'updateSignup', { ...ev, signupId: 's1', input: { name: 'x' } }, { user: ANA, dataSources });
    expect(edit.success).toBe(false);
    expect(dataSources.eventandoIntegration.updateSignup).not.toHaveBeenCalled();
  });
});

describe('credentialCheckedIn', () => {
  it('subscribes an organizer', async () => {
    expect(await call('Subscription', 'credentialCheckedIn', ev, { user: ANA, dataSources: authzDataSources() }))
      .toBe('iterator');
  });
});

describe('trackEvent', () => {
  const track = (input, dataSources) => call('Mutation', 'trackEvent', { input }, { dataSources });

  it('stays public for the known event types', async () => {
    const dataSources = { managerIntegration: { trackAnalyticsEvent: vi.fn().mockResolvedValue({ data: { id: 1 } }) } };
    for (const eventType of EVENT_TYPES) {
      // eslint-disable-next-line no-await-in-loop
      expect((await track({ event_type: eventType }, dataSources)).success).toBe(true);
    }
  });

  it('refuses an unknown type and metadata over 2 KB without writing', async () => {
    const dataSources = { managerIntegration: { trackAnalyticsEvent: vi.fn() } };
    expect((await track({ event_type: 'anything' }, dataSources)).success).toBe(false);
    expect((await track({ event_type: 'page_visit', metadata: { blob: 'x'.repeat(2100) } }, dataSources)).success)
      .toBe(false);
    expect(dataSources.managerIntegration.trackAnalyticsEvent).not.toHaveBeenCalled();
  });
});
