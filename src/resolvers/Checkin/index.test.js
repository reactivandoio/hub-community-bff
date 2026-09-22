import { describe, it, expect, vi, beforeEach } from 'vitest';
import pubsub from '../../dataSources/pubsub';
import { sendSignupConfirmation, sendSignupConfirmationBatch } from '../../services/email/signup-confirmation';
import Checkin from './index';

// vi.mock is hoisted above the imports by vitest. The e-mail service is mocked whole:
// these tests only check who gets an e-mail, never send one.
vi.mock('../../dataSources/pubsub', () => ({ default: { publish: vi.fn(), asyncIterator: vi.fn() } }));
vi.mock('../../services/email/signup-confirmation', () => ({
  sendSignupConfirmation: vi.fn().mockResolvedValue({ success: true }),
  sendSignupConfirmationBatch: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}));

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

  const walkInDataSources = ({ account = { created: true, token: 'tok' }, setupError = null, existing = [] } = {}) => ({
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42, slug: 'ev' }] }),
      findSignupByEmail: vi.fn().mockResolvedValue({ data: existing }),
      createPaymentDirect: vi.fn().mockResolvedValue({ data: { id: 7 } }),
      createSignupDirect: vi.fn().mockResolvedValue({
        data: { documentId: 's9', name: 'Ana Souza', email: 'ana@x.io', phone_number: '+55 62 9', checked_in: false },
      }),
    },
    managerIntegration: {
      accountSetup: setupError
        ? vi.fn().mockRejectedValue(setupError)
        : vi.fn().mockResolvedValue(account),
      findUsersByEmails: vi.fn().mockResolvedValue([]),
    },
  });

  const run = (dataSources) =>
    Checkin.Mutation.manualSignup(null, { eventSlug: 'ev', batchId: '3', input }, { dataSources });

  it('sets up the account and sends the confirmation with the new signup id', async () => {
    const dataSources = walkInDataSources();
    const out = await run(dataSources);
    expect(out.success).toBe(true);
    expect(out.account_created).toBe(true);
    expect(dataSources.managerIntegration.accountSetup)
      .toHaveBeenCalledWith({ email: 'ana@x.io', name: 'Ana Souza', phone: '+55 62 9' });
    expect(sendSignupConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      dataSources,
      eventSlug: 'ev',
      signupId: 's9',
      name: 'Ana Souza',
      email: 'ana@x.io',
      isFree: true,
      account: { created: true, token: 'tok' },
    }));
    expect(out.signup).toMatchObject({ id: 's9', name: 'Ana Souza', email: 'ana@x.io', checked_in: false });
  });

  it('reports account_created false for an account that already existed', async () => {
    const dataSources = walkInDataSources({ account: { created: false, token: null } });
    const out = await run(dataSources);
    expect(out.success).toBe(true);
    expect(out.account_created).toBe(false);
    expect(sendSignupConfirmation).toHaveBeenCalledTimes(1);
    expect(out.signup).toMatchObject({ id: 's9' });
  });

  it('returns the existing signup without creating one or e-mailing an account with a password', async () => {
    const existing = [{ id: 5, name: 'ana-4f2k', email: 'ana@x.io', checked_in: true }];
    const dataSources = walkInDataSources({ account: { created: false, token: null }, existing });
    const out = await run(dataSources);
    expect(out.success).toBe(true);
    expect(dataSources.eventandoIntegration.createSignupDirect).not.toHaveBeenCalled();
    expect(sendSignupConfirmation).not.toHaveBeenCalled();
    expect(out.signup).toMatchObject({ id: '5', checked_in: true });
  });

  it('still e-mails an existing signup whose account has no password yet', async () => {
    const existing = [{ id: 5, name: 'ana-4f2k', email: 'ana@x.io' }];
    const dataSources = walkInDataSources({ account: { created: false, token: 'tok2' }, existing });
    await run(dataSources);
    expect(sendSignupConfirmation).toHaveBeenCalledWith(expect.objectContaining({ signupId: '5' }));
  });

  it('still signs up when account-setup fails', async () => {
    const dataSources = walkInDataSources({ setupError: new Error('Not Found') });
    const out = await run(dataSources);
    expect(out.success).toBe(true);
    expect(out.account_created).toBe(false);
    expect(out.signup).toMatchObject({ id: 's9' });
    expect(sendSignupConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      signupId: 's9',
      account: { created: false, token: null },
    }));
  });

  it('still succeeds when the confirmation e-mail rejects', async () => {
    sendSignupConfirmation.mockRejectedValueOnce(new Error('smtp down'));
    const out = await run(walkInDataSources());
    expect(out.success).toBe(true);
    expect(out.signup).toMatchObject({ id: 's9' });
  });
});

describe('importSignups', () => {
  const importDataSources = () => {
    let n = 0;
    return {
      eventandoIntegration: {
        findEvents: vi.fn().mockResolvedValue({ data: [{ id: 42, slug: 'ev' }] }),
        findSignupsByEvent: vi.fn().mockResolvedValue([{ documentId: 'old', email: 'dup@x.io' }]),
        createPaymentDirect: vi.fn().mockResolvedValue({ data: { id: 7 } }),
        createSignupDirect: vi.fn().mockImplementation(async (data) => {
          n += 1;
          return { data: { ...data, documentId: `new${n}` } };
        }),
      },
      managerIntegration: {},
    };
  };

  const signups = [
    { name: 'Ana', email: 'Ana@x.io', phone_number: '62' },
    { name: 'Sem Email' },
    { name: 'Dup', email: 'dup@x.io' },
    { name: 'Bia', email: 'bia@x.io' },
  ];

  it('sends the confirmation, in the background, to each imported signup with an e-mail', async () => {
    const dataSources = importDataSources();
    const out = await Checkin.Mutation.importSignups(null, { eventSlug: 'ev', batchId: 3, signups }, { dataSources });

    expect(out).toMatchObject({ success: true, imported_count: 3, skipped_count: 1 });
    expect(sendSignupConfirmationBatch).toHaveBeenCalledTimes(1);
    const call = sendSignupConfirmationBatch.mock.calls[0][0];
    expect(call).toMatchObject({ dataSources, eventSlug: 'ev', isFree: true, label: 'import' });
    expect(call.eventandoEvent).toMatchObject({ id: 42 });
    expect(call.signups).toEqual([
      { signupId: 'new1', name: 'Ana', email: 'Ana@x.io', phone: '62' },
      { signupId: 'new3', name: 'Bia', email: 'bia@x.io', phone: null },
    ]);
  });

  it('does not wait for the e-mails to answer', async () => {
    sendSignupConfirmationBatch.mockReturnValueOnce(new Promise(() => {}));
    const out = await Checkin.Mutation.importSignups(
      null,
      { eventSlug: 'ev', batchId: 3, signups: signups.slice(0, 1) },
      { dataSources: importDataSources() },
    );
    expect(out.success).toBe(true);
  });

  it('sends nothing when no one was imported', async () => {
    await Checkin.Mutation.importSignups(
      null,
      { eventSlug: 'ev', batchId: 3, signups: [{ name: 'Dup', email: 'dup@x.io' }] },
      { dataSources: importDataSources() },
    );
    expect(sendSignupConfirmationBatch).not.toHaveBeenCalled();
  });
});

describe('sendImportedSignupConfirmations', () => {
  const eventSignups = [
    { documentId: 'i1', name: 'Ana', email: 'ana@x.io', phone_number: '62', payment: { payment_identification: 'IMPORT_1_a' } },
    { documentId: 'i2', name: 'Sem Email', email: null, payment: { payment_identification: 'IMPORT_2_b' } },
    { documentId: 'm1', name: 'Manual', email: 'man@x.io', payment: { payment_identification: 'MANUAL_1_c' } },
    { documentId: 'p1', name: 'Site', email: 'site@x.io', payment: { payment_identification: 'pix-123' } },
    { documentId: 'n1', name: 'Sem Pagamento', email: 'np@x.io', payment: null },
    { id: 77, name: 'Bia', email: 'bia@x.io', payment: { payment_identification: 'IMPORT_3_d' } },
  ];

  const bulkDataSources = (event = { id: 42, slug: 'ev' }) => ({
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: event ? [event] : [] }),
      findSignupsByEvent: vi.fn().mockResolvedValue(eventSignups),
    },
    managerIntegration: {},
  });

  it('queues only the imported signups that have an e-mail and answers right away', async () => {
    sendSignupConfirmationBatch.mockReturnValueOnce(new Promise(() => {}));
    const dataSources = bulkDataSources();
    const out = await Checkin.Mutation.sendImportedSignupConfirmations(null, { eventSlug: 'ev' }, { dataSources });

    expect(out).toEqual({ success: true, message: '2 e-mails na fila de envio.', queued_count: 2 });
    expect(dataSources.eventandoIntegration.findSignupsByEvent).toHaveBeenCalledWith(42);
    const call = sendSignupConfirmationBatch.mock.calls[0][0];
    expect(call).toMatchObject({ eventSlug: 'ev', isFree: true });
    expect(call.signups).toEqual([
      { signupId: 'i1', name: 'Ana', email: 'ana@x.io', phone: '62' },
      { signupId: '77', name: 'Bia', email: 'bia@x.io', phone: null },
    ]);
  });

  it('queues nothing for an event without imported signups', async () => {
    const dataSources = bulkDataSources();
    dataSources.eventandoIntegration.findSignupsByEvent.mockResolvedValue(eventSignups.slice(2, 5));
    const out = await Checkin.Mutation.sendImportedSignupConfirmations(null, { eventSlug: 'ev' }, { dataSources });
    expect(out).toMatchObject({ success: true, queued_count: 0 });
    expect(sendSignupConfirmationBatch).not.toHaveBeenCalled();
  });

  it('reports an unknown event', async () => {
    const out = await Checkin.Mutation.sendImportedSignupConfirmations(
      null,
      { eventSlug: 'nope' },
      { dataSources: bulkDataSources(null) },
    );
    expect(out).toEqual({ success: false, message: 'Evento "nope" não encontrado.', queued_count: 0 });
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
