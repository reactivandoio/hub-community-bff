import { describe, it, expect, vi } from 'vitest';
import ShareArt, { assertRolesFit, buildShareArtData } from './index';

const ADMIN = { id: 1, documentId: 'u-root', role: { type: 'admin' } };
const ORGANIZER = { id: 2, documentId: 'u-ana', role: { type: 'community-manager' } };
const OTHER_MANAGER = { id: 3, documentId: 'u-bia', role: { type: 'community-manager' } };
const MEMBER = { id: 4, documentId: 'u-caio', role: { type: 'authenticated' } };

const EVENT = { documentId: 'ev-1', slug: 'sw-goiania', communities: [{ organizers: [{ documentId: 'u-ana' }] }] };
const STORY_BG = {
  id: 7, mime: 'image/png', url: '/uploads/story.png', width: 1080, height: 1920,
};
const FEED_BG = {
  id: 8, mime: 'image/jpeg', url: '/uploads/feed.jpg', width: 1080, height: 1350,
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
      story_name_text: null,
      story_role_text: null,
      feed_background: 8,
      feed_photo_area: { ...AREA, height: 0.5 },
    });
  });

  it('refuses a background with the wrong ratio before writing (the check runs on the server)', async () => {
    const ctx = makeCtx(ADMIN);
    // The feed (4:5) image sent as the stories background.
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

// ─── REA-47: name, role and the role of the person ─────────────────────────────────────────

const NAME = {
  x: 0.1, y: 0.7, width: 0.8, height: 0.06, font: 'inter_bold', size: 0.05, color: '#FFFFFF', align: 'center',
};
const ROLE = { ...NAME, y: 0.78, font: 'dancing_script', size: 0.04, align: 'left' };

describe('upsertShareArtConfig — name and role texts (REA-47)', () => {
  const withEventando = (ctx, products = [{ id: 11 }, { id: 12 }, { id: 13, deleted: true }]) => ({
    ...ctx,
    dataSources: {
      ...ctx.dataSources,
      eventandoIntegration: { findEventBySlug: vi.fn().mockResolvedValue({ data: [{ id: 5, products }] }) },
    },
  });

  it('writes the texts of a format, normalized (color in lower case)', async () => {
    const ctx = withEventando(makeCtx(ADMIN));
    await upsert(ctx, { story: { background: '7', photo_area: AREA, name_text: NAME, role_text: ROLE } });
    const data = ctx.dataSources.managerIntegration.createShareArtConfig.mock.calls[0][0];
    expect(data.story_name_text).toEqual({ ...NAME, color: '#ffffff' });
    expect(data.story_role_text).toEqual({ ...ROLE, color: '#ffffff' });
    // Only where and how: the role itself is what the person picks in the generator.
    expect(data).not.toHaveProperty('product_roles');
  });

  it('keeps a text left out, removes a text sent as null', async () => {
    const data = await buildShareArtData(
      { feed: { background: '8', photo_area: AREA, role_text: null } },
      async () => FEED_BG,
    );
    expect(data).not.toHaveProperty('feed_name_text');
    expect(data.feed_role_text).toBeNull();
  });

  it('refuses a text outside the image, with an unknown font, a bad color or size', async () => {
    const bad = [
      { ...NAME, x: 0.5, width: 0.6 },
      { ...NAME, font: 'comic_sans' },
      { ...NAME, color: 'red' },
      { ...NAME, size: 0.5 },
      { ...NAME, align: 'justify' },
      { ...NAME, height: 0.001 },
    ];
    for (const name_text of bad) {
      // eslint-disable-next-line no-await-in-loop
      expect(await codeOf(() => buildShareArtData(
        { story: { background: '7', photo_area: AREA, name_text } },
        async () => STORY_BG,
      ))).toBe('BAD_USER_INPUT');
    }
  });
});

// ─── REA-49: roles offered in the generator ─────────────────────────────────────────────────
describe('upsertShareArtConfig — roles offered in the generator (REA-49)', () => {
  const SAVED_WITH_ROLE = {
    documentId: 'sa-1',
    story_background: STORY_BG,
    story_photo_area: AREA,
    story_role_text: ROLE,
    roles: null,
  };

  it('writes the marked roles in the generator order', async () => {
    const ctx = makeCtx(ADMIN);
    await upsert(ctx, { roles: ['Palestrante', 'Mentor'] });
    const data = ctx.dataSources.managerIntegration.createShareArtConfig.mock.calls[0][0];
    expect(data.roles).toEqual(['Mentor', 'Palestrante']);
  });

  it('keeps the roles when left out and writes null (every role) when sent as null', async () => {
    expect(await buildShareArtData({ story: null }, async () => null)).not.toHaveProperty('roles');
    expect((await buildShareArtData({ roles: null }, async () => null)).roles).toBeNull();
  });

  it('refuses no role at all while a format places the role text, without writing', async () => {
    const findShareArtConfigByEvent = vi.fn().mockResolvedValue(SAVED_WITH_ROLE);
    const ctx = makeCtx(ADMIN, { findShareArtConfigByEvent });
    expect(await codeOf(() => upsert(ctx, { roles: [] }))).toBe('BAD_USER_INPUT');
    expect(ctx.dataSources.managerIntegration.updateShareArtConfig).not.toHaveBeenCalled();
  });

  it('accepts no role when no format places the role text', () => {
    const noRoleText = { ...SAVED_WITH_ROLE, story_role_text: null };
    expect(() => assertRolesFit({ roles: [] }, noRoleText)).not.toThrow();
    // The role text leaves the art in the same save.
    const textLeaves = { roles: [], story_role_text: null };
    expect(() => assertRolesFit(textLeaves, SAVED_WITH_ROLE)).not.toThrow();
    // Its format goes back to the default art.
    const backToDefault = { roles: [], story_background: null, story_role_text: null };
    expect(() => assertRolesFit(backToDefault, SAVED_WITH_ROLE)).not.toThrow();
    expect(() => assertRolesFit({ roles: [] }, null)).not.toThrow();
  });

  it('refuses placing the role text while the saved list is empty', () => {
    const saved = { ...SAVED_WITH_ROLE, story_role_text: null, roles: [] };
    expect(() => assertRolesFit({ story_background: 7, story_role_text: ROLE }, saved))
      .toThrow('Marque pelo menos um papel');
    expect(() => assertRolesFit({ story_role_text: ROLE, roles: ['Mentor'] }, saved)).not.toThrow();
  });
});
