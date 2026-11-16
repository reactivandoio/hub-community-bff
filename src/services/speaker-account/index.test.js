import { describe, it, expect, vi } from 'vitest';
import {
  linkSpeakerAccount,
  normalize,
  speakerAccountReview,
  unlinkSpeakerAccount,
} from './index';
import SpeakerResolvers from '../../resolvers/Speaker';

const ADMIN = { id: 1, documentId: 'u-admin', role: { type: 'admin' } };
const ANA = { id: 2, documentId: 'u-ana', email: 'ana@x.io', name: 'Ana Souza', role: { type: 'community-manager' } };

const OLD = { documentId: 's-old', name: 'Ana Souza', email: null, biography: [], avatar: null, talks: [{ documentId: 't1' }, { documentId: 't2' }] };
const EMPTY = { documentId: 's-empty', name: 'Ana', email: 'ana@x.io', biography: [{ type: 'paragraph' }], avatar: { id: 77 }, talks: [] };

const makeCtx = (user, overrides = {}) => {
  const ds = {
    findSpeakerWithAccount: vi.fn(async (id) => (id === 's-old' ? OLD : null)),
    findSpeakersOfAccount: vi.fn().mockResolvedValue([]),
    adminFindUser: vi.fn().mockResolvedValue(ANA),
    setSpeakerAccount: vi.fn().mockResolvedValue({}),
    deleteSpeakerById: vi.fn().mockResolvedValue({}),
    findAllSpeakersForReview: vi.fn().mockResolvedValue([]),
    findAllAccountsForReview: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return { user, dataSources: { managerIntegration: ds }, ds };
};

describe('linkSpeakerAccount', () => {
  it('is admin only', async () => {
    const ctx = makeCtx(ANA);
    await expect(linkSpeakerAccount(ctx, { speakerId: 's-old', userId: '2' })).rejects.toThrow(/permissão/);
    expect(ctx.ds.setSpeakerAccount).not.toHaveBeenCalled();
    await expect(linkSpeakerAccount(makeCtx(null), { speakerId: 's-old', userId: '2' })).rejects.toThrow(/autenticado/);
  });

  it('links the account and copies its e-mail to the speaker', async () => {
    const ctx = makeCtx(ADMIN);
    const result = await linkSpeakerAccount(ctx, { speakerId: 's-old', userId: '2' });
    expect(ctx.ds.adminFindUser).toHaveBeenCalledWith('2');
    expect(ctx.ds.setSpeakerAccount).toHaveBeenCalledWith('s-old', 'u-ana', { email: 'ana@x.io' });
    expect(ctx.ds.deleteSpeakerById).not.toHaveBeenCalled();
    expect(result.joined).toEqual([]);
  });

  it('joins the empty speaker the account got at its first login, keeping its avatar and biography', async () => {
    const ctx = makeCtx(ADMIN, { findSpeakersOfAccount: vi.fn().mockResolvedValue([EMPTY]) });
    const result = await linkSpeakerAccount(ctx, { speakerId: 's-old', userId: '2' });
    expect(ctx.ds.setSpeakerAccount).toHaveBeenNthCalledWith(1, 's-empty', null);
    expect(ctx.ds.setSpeakerAccount).toHaveBeenNthCalledWith(2, 's-old', 'u-ana', {
      avatar: 77,
      biography: EMPTY.biography,
      email: 'ana@x.io',
    });
    expect(ctx.ds.deleteSpeakerById).toHaveBeenCalledWith('s-empty');
    expect(result.joined).toEqual(['Ana']);
  });

  it('never overwrites what the speaker already has', async () => {
    const full = { ...OLD, avatar: { id: 5 }, biography: [{ type: 'paragraph' }] };
    const ctx = makeCtx(ADMIN, {
      findSpeakerWithAccount: vi.fn().mockResolvedValue(full),
      findSpeakersOfAccount: vi.fn().mockResolvedValue([EMPTY]),
    });
    await linkSpeakerAccount(ctx, { speakerId: 's-old', userId: '2' });
    expect(ctx.ds.setSpeakerAccount).toHaveBeenNthCalledWith(2, 's-old', 'u-ana', { email: 'ana@x.io' });
  });

  it('refuses when the account is already a speaker with talks, touching nothing', async () => {
    const other = { ...EMPTY, name: 'Ana S.', talks: [{ documentId: 't9' }] };
    const ctx = makeCtx(ADMIN, { findSpeakersOfAccount: vi.fn().mockResolvedValue([other]) });
    await expect(linkSpeakerAccount(ctx, { speakerId: 's-old', userId: '2' }))
      .rejects.toThrow('ana@x.io já é o palestrante "Ana S.", com 1 palestra.');
    expect(ctx.ds.setSpeakerAccount).not.toHaveBeenCalled();
    expect(ctx.ds.deleteSpeakerById).not.toHaveBeenCalled();
  });

  it('refuses a speaker that is already another account\'s', async () => {
    const linked = { ...OLD, users_permissions_user: { documentId: 'u-bia', email: 'bia@x.io' } };
    const ctx = makeCtx(ADMIN, { findSpeakerWithAccount: vi.fn().mockResolvedValue(linked) });
    await expect(linkSpeakerAccount(ctx, { speakerId: 's-old', userId: '2' })).rejects.toThrow(/já está vinculado a bia@x.io/);
    expect(ctx.ds.setSpeakerAccount).not.toHaveBeenCalled();
  });

  it('does nothing when linking the same account again', async () => {
    const linked = { ...OLD, users_permissions_user: { documentId: 'u-ana' } };
    const ctx = makeCtx(ADMIN, { findSpeakerWithAccount: vi.fn().mockResolvedValue(linked) });
    const result = await linkSpeakerAccount(ctx, { speakerId: 's-old', userId: '2' });
    expect(result).toEqual({ speaker: linked, joined: [] });
    expect(ctx.ds.setSpeakerAccount).not.toHaveBeenCalled();
  });

  it('answers not found for a deleted speaker or an unknown account', async () => {
    const deleted = makeCtx(ADMIN, { findSpeakerWithAccount: vi.fn().mockResolvedValue({ ...OLD, deleted_at: '2026-01-01' }) });
    await expect(linkSpeakerAccount(deleted, { speakerId: 's-old', userId: '2' })).rejects.toThrow('Palestrante não encontrado.');
    const noUser = makeCtx(ADMIN, { adminFindUser: vi.fn().mockRejectedValue(new Error('404')) });
    await expect(linkSpeakerAccount(noUser, { speakerId: 's-old', userId: '9' })).rejects.toThrow('Conta não encontrada.');
  });
});

describe('unlinkSpeakerAccount', () => {
  it('unlinks, keeping the speaker', async () => {
    const linked = { ...OLD, users_permissions_user: { documentId: 'u-ana' } };
    const ctx = makeCtx(ADMIN, { findSpeakerWithAccount: vi.fn().mockResolvedValue(linked) });
    await unlinkSpeakerAccount(ctx, { speakerId: 's-old' });
    expect(ctx.ds.setSpeakerAccount).toHaveBeenCalledWith('s-old', null);
    expect(ctx.ds.deleteSpeakerById).not.toHaveBeenCalled();
  });

  it('is admin only', async () => {
    await expect(unlinkSpeakerAccount(makeCtx(ANA), { speakerId: 's-old' })).rejects.toThrow(/permissão/);
  });
});

describe('speakerAccountReview', () => {
  const account = (id, name, email, extra = {}) => ({ id, documentId: `u-${id}`, name, email, ...extra });
  const speaker = (id, name, extra = {}) => ({ documentId: id, name, email: null, talks: [], ...extra });

  it('counts the speakers and suggests links by e-mail, then by a unique name', async () => {
    const speakers = [
      speaker('s1', 'João Silva', { users_permissions_user: { documentId: 'u-1' }, talks: [{}] }),
      speaker('s2', 'Maria', { email: 'MARIA@x.io', talks: [{}] }),
      speaker('s3', 'José Ávila', { talks: [{}, {}] }),
      speaker('s4', 'Pedro'), // two accounts named Pedro: no suggestion
      speaker('s5', 'João Silva'), // u-1 is already a speaker with talks
      speaker('s6', 'Lia'), // the account is blocked
      speaker('s7', 'Rui'),
      speaker('s8', 'rui'), // two speakers named Rui: neither is suggested
    ];
    const accounts = [
      account(1, 'João Silva', 'joao@x.io'),
      account(2, 'Maria Clara', 'maria@x.io'),
      account(3, 'jose avila', 'jose@x.io'),
      account(4, 'Pedro', 'p1@x.io'),
      account(5, 'Pedro', 'p2@x.io'),
      account(6, 'Lia', 'lia@x.io', { blocked: true }),
      account(7, 'Rui', 'rui@x.io'),
    ];
    const ctx = makeCtx(ADMIN, {
      findAllSpeakersForReview: vi.fn().mockResolvedValue(speakers),
      findAllAccountsForReview: vi.fn().mockResolvedValue(accounts),
    });
    const review = await speakerAccountReview(ctx);
    expect(review).toMatchObject({ total: 8, withAccount: 1, withoutAccount: 7, withoutAccountWithTalks: 2 });
    expect(review.suggestions).toEqual([
      { reason: 'EMAIL', speakerId: 's2', speakerName: 'Maria', talks: 1, account: { id: '2', documentId: 'u-2', name: 'Maria Clara', email: 'maria@x.io' } },
      { reason: 'NAME', speakerId: 's3', speakerName: 'José Ávila', talks: 2, account: { id: '3', documentId: 'u-3', name: 'jose avila', email: 'jose@x.io' } },
    ]);
  });

  it('is admin only', async () => {
    const ctx = makeCtx(ANA);
    await expect(speakerAccountReview(ctx)).rejects.toThrow(/permissão/);
    expect(ctx.ds.findAllAccountsForReview).not.toHaveBeenCalled();
  });

  it('compares without case or accents', () => {
    expect(normalize('  José   ÁVILA ')).toBe('jose avila');
  });
});

describe('Speaker fields (REA-53)', () => {
  const source = { documentId: 's1', email: 'ana@x.io', users_permissions_user: { id: 2, documentId: 'u-ana', email: 'ana@x.io', name: 'Ana' } };
  const { Speaker } = SpeakerResolvers;

  it('shows the e-mail and the account to the admin only', () => {
    expect(Speaker.email(source, {}, { user: ADMIN })).toBe('ana@x.io');
    expect(Speaker.account(source, {}, { user: ADMIN })).toEqual({ id: '2', documentId: 'u-ana', name: 'Ana', email: 'ana@x.io', username: null });
    expect(Speaker.email(source, {}, { user: ANA })).toBeNull();
    expect(Speaker.account(source, {}, { user: ANA })).toBeNull();
    expect(Speaker.account(source, {}, {})).toBeNull();
  });

  it('lists only speakers not deleted, with the account for the admin', async () => {
    const findSpeakers = vi.fn().mockResolvedValue({ data: [] });
    const dataSources = { managerIntegration: { findSpeakers } };
    await SpeakerResolvers.Query.speakers(null, { filters: { name: { eq: 'x' } } }, { dataSources, user: ADMIN });
    expect(findSpeakers).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: { name: { eq: 'x' }, deleted_at: { null: true } },
      populate: ['talks', 'avatar', 'users_permissions_user'],
    }));
    await SpeakerResolvers.Query.speakers(null, {}, { dataSources, user: null });
    expect(findSpeakers).toHaveBeenLastCalledWith(expect.objectContaining({
      filters: { deleted_at: { null: true } },
      populate: ['talks', 'avatar'],
    }));
  });
});
