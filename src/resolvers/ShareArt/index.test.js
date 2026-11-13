import { describe, it, expect, vi } from 'vitest';
import ShareArt, { buildShareArtData } from './index';

const ADMIN = { id: 1, documentId: 'u-root', role: { type: 'admin' } };
const ORGANIZER = { id: 2, documentId: 'u-ana', role: { type: 'community-manager' } };
const OTHER_MANAGER = { id: 3, documentId: 'u-bia', role: { type: 'community-manager' } };
const MEMBER = { id: 4, documentId: 'u-caio', role: { type: 'authenticated' } };

const EVENT = { documentId: 'ev-1', slug: 'sw-goiania', communities: [{ organizers: [{ documentId: 'u-ana' }] }] };
const STORY_BG = {
  id: 7, mime: 'image/png', url: '/uploads/story.png', width: 1080, height: 1920,
};
const FEED_BG = {
  id: 8, mime: 'image/jpeg', url: '/uploads/feed.jpg', width: 1080, height: 1080,
};
const AREA = {
  x: 0.1, y: 0.2, width: 0.8, height: 0.45, radius: 1,
};

const makeCtx = (user, overrides = {}) => {
  const managerIntegration = {
    findEventWithOrganizers: vi.fn().mockResolvedValue(EVENT),
    findShareArtConfigByEvent: vi.fn().mockResolvedValue(null),
    findUploadFile: vi.fn(async (id) => ({ 7: STORY_BG, 8: FEED_BG }[id] || null)),
    createShareArtConfig: vi.fn(async (data) => ({
      data: {
        documentId: 'sa-new',
        story_background: data.story_background ? STORY_BG : null,
        story_photo_area: data.story_photo_area,
      },
    })),
    updateShareArtConfig: vi.fn(async (documentId) => ({ data: { documentId } })),
    ...overrides,
  };
  return { user, dataSources: { managerIntegration } };
};

const codeOf = async (run) => {
  try {
    await run();
    return null;
  } catch (err) {
    return err.extensions?.code || err.message;
  }
};

const { Query, Mutation } = ShareArt;
const upsert = (ctx, data, eventId = 'sw-goiania') => Mutation.upsertShareArtConfig(null, { eventId, data }, ctx);

describe('upsertShareArtConfig — who may', () => {
  it('lets the admin and the organizer of the event save', async () => {
    expect(await codeOf(() => upsert(makeCtx(ADMIN), { story: { background: '7', photo_area: AREA } }))).toBeNull();
    expect(await codeOf(() => upsert(makeCtx(ORGANIZER), { story: { background: '7', photo_area: AREA } }))).toBeNull();
  });

  it('refuses anonymous, plain users and managers of other communities, without writing', async () => {
    for (const [user, code] of [[undefined, 'UNAUTHENTICATED'], [MEMBER, 'FORBIDDEN'], [OTHER_MANAGER, 'FORBIDDEN']]) {
      const ctx = makeCtx(user);
      // eslint-disable-next-line no-await-in-loop
      expect(await codeOf(() => upsert(ctx, { story: { background: '7', photo_area: AREA } }))).toBe(code);
      expect(ctx.dataSources.managerIntegration.createShareArtConfig).not.toHaveBeenCalled();
      expect(ctx.dataSources.managerIntegration.updateShareArtConfig).not.toHaveBeenCalled();
    }
  });
});

describe('upsertShareArtConfig — what is written', () => {
  it('creates the config linked to the event documentId (even when called with the slug)', async () => {
    const ctx = makeCtx(ADMIN);
    const out = await upsert(ctx, { story: { background: '7', photo_area: AREA } });
    expect(ctx.dataSources.managerIntegration.createShareArtConfig).toHaveBeenCalledWith({
      event: 'ev-1',
      story_background: 7,
      story_photo_area: AREA,
    });
    expect(out.story.photo_area).toEqual(AREA);
    expect(out.feed).toBeNull();
  });

  it('updates the existing config and clears a format sent as null', async () => {
    const ctx = makeCtx(ORGANIZER, {
      findShareArtConfigByEvent: vi.fn().mockResolvedValue({ documentId: 'sa-1' }),
    });
    await upsert(ctx, { story: null, feed: { background: '8', photo_area: { ...AREA, height: 0.5 } } });
    expect(ctx.dataSources.managerIntegration.updateShareArtConfig).toHaveBeenCalledWith('sa-1', {
      story_background: null,
      story_photo_area: null,
      feed_background: 8,
      feed_photo_area: { ...AREA, height: 0.5 },
    });
  });

  it('refuses a background with the wrong ratio before writing (the check runs on the server)', async () => {
    const ctx = makeCtx(ADMIN);
    // The feed (square) image sent as the stories background.
    expect(await codeOf(() => upsert(ctx, { story: { background: '8', photo_area: AREA } }))).toBe('BAD_USER_INPUT');
    expect(ctx.dataSources.managerIntegration.createShareArtConfig).not.toHaveBeenCalled();
  });

  it('refuses a background id that is not in the media library', async () => {
    expect(await codeOf(() => upsert(makeCtx(ADMIN), { feed: { background: '99', photo_area: AREA } })))
      .toBe('BAD_USER_INPUT');
  });
});

describe('buildShareArtData', () => {
  it('leaves out the formats that were not sent', async () => {
    expect(await buildShareArtData({}, vi.fn())).toEqual({});
  });
  it('refuses an area outside the image before looking up the file', async () => {
    const find = vi.fn();
    expect(await codeOf(() => buildShareArtData({ feed: { background: '8', photo_area: { ...AREA, x: 0.5 } } }, find)))
      .toBe('BAD_USER_INPUT');
    expect(find).not.toHaveBeenCalled();
  });
});

describe('shareArtConfig (public)', () => {
  it('reads by slug or id and is null without a config', async () => {
    const ctx = makeCtx(undefined);
    expect(await Query.shareArtConfig(null, { eventId: 'sw-goiania' }, ctx)).toBeNull();
    expect(ctx.dataSources.managerIntegration.findShareArtConfigByEvent).toHaveBeenCalledWith('sw-goiania');
  });
});
