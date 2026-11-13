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

describe('upsertShareArtConfig — name, role and roles per product (REA-47)', () => {
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
    // The roles were not sent: the Eventando is not even asked.
    expect(ctx.dataSources.eventandoIntegration.findEventBySlug).not.toHaveBeenCalled();
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

  it("maps the event's products to roles; empty role → default; the default role falls back to Participante", async () => {
    const ctx = withEventando(makeCtx(ORGANIZER));
    await upsert(ctx, {
      product_roles: [
        { product_id: '11', role: '  Mentor  ' },
        { product_id: '12', role: '' },
      ],
      default_role: '   ',
    });
    const data = ctx.dataSources.managerIntegration.createShareArtConfig.mock.calls[0][0];
    expect(data.product_roles).toEqual([{ product_id: '11', role: 'Mentor' }]);
    expect(data.default_role).toBe('Participante');
    expect(ctx.dataSources.eventandoIntegration.findEventBySlug).toHaveBeenCalledWith('sw-goiania');
  });

  it('refuses a product of another event (or a deleted one) and a role too long', async () => {
    for (const product_roles of [
      [{ product_id: '99', role: 'Mentor' }],
      [{ product_id: '13', role: 'Mentor' }],
      [{ product_id: '11', role: 'x'.repeat(41) }],
    ]) {
      const ctx = withEventando(makeCtx(ADMIN));
      // eslint-disable-next-line no-await-in-loop
      expect(await codeOf(() => upsert(ctx, { product_roles }))).toBe('BAD_USER_INPUT');
      expect(ctx.dataSources.managerIntegration.createShareArtConfig).not.toHaveBeenCalled();
    }
  });
});

describe('myShareArtRole (REA-47)', () => {
  const ANA_USER = { documentId: 'u-ana', email: 'ana@x.io' };
  const BIA_USER = { documentId: 'u-bia', email: 'Bia@X.io' };
  const CAIO_USER = { documentId: 'u-caio', email: 'caio@x.io' };
  const ROLE_EVENT = {
    documentId: 'ev-1',
    slug: 'sw-goiania',
    communities: [{ organizers: [{ documentId: 'u-ana' }] }],
    talks: [{ speakers: [{ email: 'bia@x.io' }, { email: 'old@x.io', deleted_at: '2026-01-01' }] }],
  };
  const signup = (productId, status = 'CONFIRMED') => ({
    email: 'caio@x.io',
    payment: { status, batch: { product: { id: productId } } },
  });

  const roleCtx = (user, { signups = [], config = null, event = ROLE_EVENT } = {}) => {
    const eventandoIntegration = {
      findEventBySlug: vi.fn().mockResolvedValue({ data: [{ id: 5 }] }),
      findSignupWithProduct: vi.fn().mockResolvedValue({ data: signups }),
    };
    const managerIntegration = {
      findEventForShareArtRole: vi.fn().mockResolvedValue(event),
      findShareArtConfigByEvent: vi.fn().mockResolvedValue(config),
    };
    return { user, dataSources: { managerIntegration, eventandoIntegration } };
  };
  const role = (ctx) => Query.myShareArtRole(null, { eventId: 'sw-goiania' }, ctx);
  const CONFIG = { documentId: 'sa-1', product_roles: [{ product_id: '11', role: 'Mentor' }], default_role: 'Inscrito' };

  it('is null signed out, without asking anything', async () => {
    const ctx = roleCtx(undefined);
    expect(await role(ctx)).toBeNull();
    expect(ctx.dataSources.managerIntegration.findEventForShareArtRole).not.toHaveBeenCalled();
  });

  it('organizer of a community of the event, before anything else', async () => {
    expect(await role(roleCtx(ANA_USER, { signups: [{ ...signup(11), email: 'ana@x.io' }], config: CONFIG })))
      .toEqual({ role: 'Organizador', source: 'ORGANIZER' });
  });

  it('speaker of a talk of the event (by e-mail, any case; a removed speaker does not count)', async () => {
    expect(await role(roleCtx(BIA_USER))).toEqual({ role: 'Palestrante', source: 'SPEAKER' });
    expect(await role(roleCtx({ documentId: 'u-x', email: 'old@x.io' }))).toBeNull();
  });

  it('speaker by the linked account', async () => {
    const event = { ...ROLE_EVENT, talks: [{ speakers: [{ email: null, users_permissions_user: { documentId: 'u-caio' } }] }] };
    expect(await role(roleCtx(CAIO_USER, { event }))).toEqual({ role: 'Palestrante', source: 'SPEAKER' });
  });

  it('the role of the product of the signup, else the default role', async () => {
    expect(await role(roleCtx(CAIO_USER, { signups: [signup(11)], config: CONFIG })))
      .toEqual({ role: 'Mentor', source: 'PRODUCT' });
    expect(await role(roleCtx(CAIO_USER, { signups: [signup(12)], config: CONFIG })))
      .toEqual({ role: 'Inscrito', source: 'DEFAULT' });
    // No config at all: Participante.
    expect(await role(roleCtx(CAIO_USER, { signups: [signup(12)] })))
      .toEqual({ role: 'Participante', source: 'DEFAULT' });
  });

  it('is null for someone not signed up, or whose signup does not hold its place', async () => {
    expect(await role(roleCtx(CAIO_USER))).toBeNull();
    expect(await role(roleCtx(CAIO_USER, { signups: [signup(11, 'EXPIRED')], config: CONFIG }))).toBeNull();
  });

  it('treats an Eventando failure as not signed up', async () => {
    const ctx = roleCtx(CAIO_USER, { config: CONFIG });
    ctx.dataSources.eventandoIntegration.findEventBySlug.mockRejectedValue(new Error('down'));
    expect(await role(ctx)).toBeNull();
  });
});
