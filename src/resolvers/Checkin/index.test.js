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
    findSignupById: vi.fn().mockResolvedValue({ data: rawSignups[0] }),
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
    expect(out.signup.name).toBe('Ana Souza');
    expect(dataSources.managerIntegration.findUsersByEmails).toHaveBeenCalledWith(['ana@x.io']);
    expect(pubsub.publish).toHaveBeenCalledTimes(1);
  });

  it('stores the checkedInAt sent by the device', async () => {
    const dataSources = makeDataSources();
    await Checkin.Mutation.checkinSignup(
      null,
      { eventSlug: 'ev', signupId: 's1', checkedInAt: '2026-09-12T08:15:00.000Z' },
      { dataSources },
    );
    expect(dataSources.eventandoIntegration.updateSignup).toHaveBeenCalledWith('s1', {
      checked_in: true,
      checked_in_at: '2026-09-12T08:15:00.000Z',
    });
  });

  it('falls back to now when checkedInAt is not a valid date', async () => {
    const dataSources = makeDataSources();
    await Checkin.Mutation.checkinSignup(null, { eventSlug: 'ev', signupId: 's1', checkedInAt: 'ontem' }, { dataSources });
    const [, data] = dataSources.eventandoIntegration.updateSignup.mock.calls[0];
    expect(Number.isNaN(Date.parse(data.checked_in_at))).toBe(false);
  });

  it('is idempotent: an already checked-in signup is returned without overwriting', async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.findSignupById.mockResolvedValue({
      data: { ...rawSignups[0], checked_in: true, checked_in_at: '2026-09-12T07:00:00.000Z' },
    });
    const out = await Checkin.Mutation.checkinSignup(
      null,
      { eventSlug: 'ev', signupId: 's1', checkedInAt: '2026-09-12T09:00:00.000Z' },
      { dataSources },
    );
    expect(out.success).toBe(true);
    expect(out.signup.checked_in_at).toBe('2026-09-12T07:00:00.000Z');
    expect(dataSources.eventandoIntegration.updateSignup).not.toHaveBeenCalled();
    expect(pubsub.publish).not.toHaveBeenCalled();
  });

  it('reports a missing signup', async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.findSignupById.mockResolvedValue(null);
    const out = await Checkin.Mutation.checkinSignup(null, { eventSlug: 'ev', signupId: 'nope' }, { dataSources });
    expect(out).toEqual({ success: false, message: 'Inscrição não encontrada.', signup: null });
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

describe('updateSignup', () => {
  const args = (input) => ({ eventSlug: 'meetup', signupId: 's1', input });

  it('changes only the fields it was given', async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.updateSignup = vi
      .fn()
      .mockResolvedValue({ data: { ...rawSignups[0], phone_number: '62981219249' } });

    const out = await Checkin.Mutation.updateSignup(null, args({ phone_number: ' 62981219249 ' }), { dataSources });

    expect(dataSources.eventandoIntegration.updateSignup)
      .toHaveBeenCalledWith('s1', { phone_number: '62981219249' });
    expect(out).toMatchObject({ success: true, message: 'Inscrição atualizada.' });
    expect(out.signup.phone_number).toBe('62981219249');
  });

  it('never touches the check-in, so fixing a name cannot un-credential anyone', async () => {
    const dataSources = makeDataSources();
    await Checkin.Mutation.updateSignup(null, args({ name: 'Ana Souza' }), { dataSources });

    const [, patch] = dataSources.eventandoIntegration.updateSignup.mock.calls[0];
    expect(patch).toEqual({ name: 'Ana Souza' });
    expect(patch).not.toHaveProperty('checked_in');
  });

  it('says so when the signup does not exist', async () => {
    const dataSources = makeDataSources();
    dataSources.eventandoIntegration.findSignupById = vi.fn().mockResolvedValue(null);

    const out = await Checkin.Mutation.updateSignup(null, args({ name: 'Ana' }), { dataSources });
    expect(out).toMatchObject({ success: false, message: 'Inscrição não encontrada.', signup: null });
  });

  it('is a no-op for an empty input instead of writing nothing over everything', async () => {
    const dataSources = makeDataSources();
    const out = await Checkin.Mutation.updateSignup(null, args({}), { dataSources });

    expect(dataSources.eventandoIntegration.updateSignup).not.toHaveBeenCalled();
    expect(out).toMatchObject({ success: true, message: 'Nada para alterar.' });
  });
});
