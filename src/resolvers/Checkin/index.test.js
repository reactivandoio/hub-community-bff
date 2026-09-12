import { describe, it, expect, vi, beforeEach } from 'vitest';
import pubsub from '../../dataSources/pubsub';
import Checkin from './index';

// vi.mock is hoisted above the imports by vitest.
vi.mock('../../dataSources/pubsub', () => ({ default: { publish: vi.fn(), asyncIterator: vi.fn() } }));

const rawSignups = [
  { documentId: 's1', name: 'ana-4f2k', email: 'ana@x.io' },
  { documentId: 's2', name: 'Bia Lima', email: 'bia@x.io' },
];

const makeDataSources = ({ users = [], usersError = null } = {}) => ({
  eventandoIntegration: {
    findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42 }] }),
    findSignupsByEvent: vi.fn().mockResolvedValue(rawSignups),
    updateSignup: vi.fn().mockResolvedValue({ data: { ...rawSignups[0], checked_in_at: '2026-09-12T10:00:00.000Z' } }),
  },
  managerIntegration: {
    findUsersByEmails: usersError
      ? vi.fn().mockRejectedValue(usersError)
      : vi.fn().mockResolvedValue(users),
  },
});

beforeEach(() => vi.clearAllMocks());

describe('eventSignups', () => {
  it('uses the HubCommunity user name when the account has one', async () => {
    const dataSources = makeDataSources({ users: [{ email: 'ana@x.io', name: 'Ana Souza' }] });
    const out = await Checkin.Query.eventSignups(null, { eventSlug: 'ev' }, { dataSources });
    expect(out.map((s) => s.name)).toEqual(['Ana Souza', 'Bia Lima']);
    expect(dataSources.managerIntegration.findUsersByEmails).toHaveBeenCalledWith(['ana@x.io', 'bia@x.io']);
  });

  it('searches on the resolved name', async () => {
    const dataSources = makeDataSources({ users: [{ email: 'ana@x.io', name: 'Ana Souza' }] });
    const out = await Checkin.Query.eventSignups(null, { eventSlug: 'ev', search: 'souza' }, { dataSources });
    expect(out.map((s) => s.id)).toEqual(['s1']);
  });

  it('keeps the signup names when the user lookup fails', async () => {
    const dataSources = makeDataSources({ usersError: new Error('strapi down') });
    const out = await Checkin.Query.eventSignups(null, { eventSlug: 'ev' }, { dataSources });
    expect(out.map((s) => s.name)).toEqual(['ana-4f2k', 'Bia Lima']);
  });
});

describe('checkinSignup', () => {
  it('returns and publishes the signup with the resolved name', async () => {
    const dataSources = makeDataSources({ users: [{ email: 'ana@x.io', name: 'Ana Souza' }] });
    const out = await Checkin.Mutation.checkinSignup(null, { eventSlug: 'ev', signupId: 's1' }, { dataSources });
    expect(out.success).toBe(true);
    expect(out.signup).toMatchObject({ id: 's1', name: 'Ana Souza', checked_in: true, checked_in_at: '2026-09-12T10:00:00.000Z' });
    expect(pubsub.publish).toHaveBeenCalledWith('CHECKIN_ev', { credentialCheckedIn: out.signup });
    expect(dataSources.managerIntegration.findUsersByEmails).toHaveBeenCalledWith(['ana@x.io']);
  });
});

describe('manualSignup', () => {
  const input = { name: 'Ana Souza', email: 'ana@x.io', phone_number: '+55 62 9' };

  const walkInDataSources = ({ signUpError = null, existing = [] } = {}) => ({
    managerPublic: {
      signUp: signUpError
        ? vi.fn().mockRejectedValue(signUpError)
        : vi.fn().mockResolvedValue({ data: { user: { id: 1 } } }),
      forwardPassword: vi.fn().mockResolvedValue({ data: { ok: true } }),
    },
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42 }] }),
      findSignupByEmail: vi.fn().mockResolvedValue({ data: existing }),
      createPaymentDirect: vi.fn().mockResolvedValue({ data: { id: 7 } }),
      createSignupDirect: vi.fn().mockResolvedValue({
        data: { documentId: 's9', name: 'Ana Souza', email: 'ana@x.io', phone_number: '+55 62 9', checked_in: false },
      }),
    },
    managerIntegration: { findUsersByEmails: vi.fn().mockResolvedValue([]) },
  });

  it('sends the set-password e-mail when the account was just created and returns the signup', async () => {
    const dataSources = walkInDataSources();
    const out = await Checkin.Mutation.manualSignup(null, { eventSlug: 'ev', batchId: '3', input }, { dataSources });
    expect(out.success).toBe(true);
    expect(out.account_created).toBe(true);
    expect(dataSources.managerPublic.forwardPassword).toHaveBeenCalledWith({ email: 'ana@x.io' });
    expect(out.signup).toMatchObject({ id: 's9', name: 'Ana Souza', email: 'ana@x.io', checked_in: false });
  });

  it('does not e-mail an account that already existed', async () => {
    const dataSources = walkInDataSources({ signUpError: new Error('Email is already taken') });
    const out = await Checkin.Mutation.manualSignup(null, { eventSlug: 'ev', batchId: '3', input }, { dataSources });
    expect(out.success).toBe(true);
    expect(out.account_created).toBe(false);
    expect(dataSources.managerPublic.forwardPassword).not.toHaveBeenCalled();
    expect(out.signup).toMatchObject({ id: 's9' });
  });

  it('returns the existing signup when the person is already registered', async () => {
    const existing = [{ id: 5, name: 'ana-4f2k', email: 'ana@x.io', checked_in: true }];
    const dataSources = walkInDataSources({ signUpError: new Error('Email is already taken'), existing });
    const out = await Checkin.Mutation.manualSignup(null, { eventSlug: 'ev', batchId: '3', input }, { dataSources });
    expect(out.success).toBe(true);
    expect(dataSources.eventandoIntegration.createSignupDirect).not.toHaveBeenCalled();
    expect(out.signup).toMatchObject({ id: '5', checked_in: true });
  });

  it('still succeeds when the set-password e-mail fails', async () => {
    const dataSources = walkInDataSources();
    dataSources.managerPublic.forwardPassword.mockRejectedValue(new Error('smtp down'));
    const out = await Checkin.Mutation.manualSignup(null, { eventSlug: 'ev', batchId: '3', input }, { dataSources });
    expect(out.success).toBe(true);
    expect(out.signup).toMatchObject({ id: 's9' });
  });
});
