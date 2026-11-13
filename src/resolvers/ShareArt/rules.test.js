import { describe, it, expect } from 'vitest';
import {
  assertBackground, mapShareArtConfig, normalizeArea, ratioMatches,
} from './rules';

const messageOf = (run) => {
  try {
    run();
    return null;
  } catch (err) {
    return `${err.extensions?.code}: ${err.message}`;
  }
};

describe('ratioMatches', () => {
  it('accepts the exact ratio and up to 1% off', () => {
    expect(ratioMatches(1080, 1920, 9 / 16)).toBe(true);
    expect(ratioMatches(2160, 3840, 9 / 16)).toBe(true);
    expect(ratioMatches(1080, 1910, 9 / 16)).toBe(true); // 0.5%
    expect(ratioMatches(1080, 1900, 9 / 16)).toBe(false); // 1.05%
    expect(ratioMatches(1080, 1080, 1)).toBe(true);
  });
  it('refuses other ratios and missing sizes', () => {
    expect(ratioMatches(1080, 1350, 9 / 16)).toBe(false); // 4:5
    expect(ratioMatches(1920, 1080, 9 / 16)).toBe(false); // landscape
    expect(ratioMatches(1080, 1350, 1)).toBe(false);
    expect(ratioMatches(undefined, 1080, 1)).toBe(false);
    expect(ratioMatches(0, 0, 1)).toBe(false);
  });
});

describe('assertBackground', () => {
  it('passes a 9:16 image for stories and a 4:5 one for the feed', () => {
    expect(messageOf(() => assertBackground('story', { mime: 'image/png', width: 1080, height: 1920 }))).toBeNull();
    expect(messageOf(() => assertBackground('feed', { mime: 'image/jpeg', width: 2048, height: 2560 }))).toBeNull();
  });
  it('tells the admin the expected ratio and what was sent', () => {
    expect(messageOf(() => assertBackground('story', { mime: 'image/png', width: 1080, height: 1080 })))
      .toBe('BAD_USER_INPUT: O fundo do Stories (9:16) precisa ter proporção 9:16 (a enviada tem 1080×1080).');
    expect(messageOf(() => assertBackground('feed', { mime: 'image/png', width: 1080, height: 1920 })))
      .toBe('BAD_USER_INPUT: O fundo do Feed (4:5) precisa ter proporção 4:5 (a enviada tem 1080×1920).');
    // REA-47: the old square feed is refused now.
    expect(messageOf(() => assertBackground('feed', { mime: 'image/png', width: 1080, height: 1080 })))
      .toBe('BAD_USER_INPUT: O fundo do Feed (4:5) precisa ter proporção 4:5 (a enviada tem 1080×1080).');
  });
  it('refuses a background smaller than the exported art', () => {
    expect(messageOf(() => assertBackground('feed', { mime: 'image/png', width: 800, height: 1000 })))
      .toMatch(/ao menos 1080×1350 pixels \(a enviada tem 800×1000\)/);
  });
  it('refuses a missing file and a file that is not an image', () => {
    expect(messageOf(() => assertBackground('story', null))).toMatch(/não encontrada/);
    expect(messageOf(() => assertBackground('story', { mime: 'application/pdf', width: 1080, height: 1920 })))
      .toMatch(/precisa ser uma imagem/);
  });
});

describe('normalizeArea', () => {
  const area = {
    x: 0.1, y: 0.2, width: 0.5, height: 0.3, radius: 1,
  };

  it('keeps a valid area, rounded to 6 places', () => {
    expect(normalizeArea('story', { ...area, x: 0.123456789 })).toEqual({ ...area, x: 0.123457 });
  });
  it('clamps a floating point overflow at the edge', () => {
    expect(normalizeArea('feed', {
      x: 0.6, y: 0, width: 0.4000000001, height: 1, radius: 0,
    })).toEqual({
      x: 0.6, y: 0, width: 0.4, height: 1, radius: 0,
    });
  });
  it('refuses an area outside the image', () => {
    expect(messageOf(() => normalizeArea('story', { ...area, x: 0.7 }))).toMatch(/dentro da imagem/);
    expect(messageOf(() => normalizeArea('story', { ...area, y: -0.1 }))).toMatch(/dentro da imagem/);
  });
  it('refuses a tiny area, a radius out of 0–1 and missing numbers', () => {
    expect(messageOf(() => normalizeArea('feed', { ...area, width: 0.01 }))).toMatch(/pequena demais/);
    expect(messageOf(() => normalizeArea('feed', { ...area, radius: 1.5 }))).toMatch(/0 \(canto reto\) a 1 \(círculo\)/);
    expect(messageOf(() => normalizeArea('feed', { ...area, x: NaN }))).toMatch(/Marque a área da foto no Feed/);
    expect(messageOf(() => normalizeArea('feed', null))).toMatch(/Marque a área/);
  });
});

describe('mapShareArtConfig', () => {
  const BASE = 'https://manager.test';
  it('maps each configured format with an absolute background url', () => {
    const raw = {
      documentId: 'sa1',
      story_background: {
        id: 7, url: '/uploads/story.png', width: 1080, height: 1920,
      },
      story_photo_area: {
        id: 1, x: 0.1, y: 0.2, width: 0.8, height: 0.45, radius: 0.5,
      },
      feed_background: null,
      feed_photo_area: null,
    };
    expect(mapShareArtConfig(raw, BASE)).toEqual({
      id: 'sa1',
      story: {
        background: 'https://manager.test/uploads/story.png',
        background_id: '7',
        background_width: 1080,
        background_height: 1920,
        photo_area: {
          x: 0.1, y: 0.2, width: 0.8, height: 0.45, radius: 0.5,
        },
        // REA-47: a config saved before the texts existed has none.
        name_text: null,
        role_text: null,
      },
      feed: null,
      product_roles: [],
      default_role: 'Participante',
      retired_formats: [],
    });
  });
  it('treats a format with a background but no area as not configured', () => {
    expect(mapShareArtConfig({ documentId: 'x', feed_background: { id: 1, url: 'https://cdn/f.png' } }, BASE).feed)
      .toBeNull();
  });
  it('is null without a record', () => {
    expect(mapShareArtConfig(null, BASE)).toBeNull();
  });
});

describe('mapShareArtConfig — REA-47 texts and roles', () => {
  const BASE = 'https://manager.test';
  it('maps the texts of a format and the roles per product', () => {
    const text = {
      id: 3, x: 0.1, y: 0.7, width: 0.8, height: 0.06, font: 'serif', size: 0.05, color: '#112233', align: 'right',
    };
    const out = mapShareArtConfig({
      documentId: 'sa1',
      feed_background: { id: 8, url: 'https://cdn/f.png', width: 1080, height: 1350 },
      feed_photo_area: { x: 0, y: 0, width: 0.5, height: 0.5, radius: 0 },
      feed_name_text: text,
      product_roles: [{ id: 1, product_id: '11', role: 'Mentor' }, { id: 2, product_id: '12', role: '' }],
      default_role: 'Inscrito',
    }, BASE);
    const { id, ...expected } = text;
    expect(out.feed.name_text).toEqual(expected);
    expect(out.feed.role_text).toBeNull();
    expect(out.product_roles).toEqual([{ product_id: '11', role: 'Mentor' }]);
    expect(out.default_role).toBe('Inscrito');
  });
});

describe('mapShareArtConfig — the feed became 4:5 (REA-47)', () => {
  const BASE = 'https://manager.test';
  const area = { x: 0.2, y: 0.2, width: 0.6, height: 0.6, radius: 1 };

  it('ignores a square feed background saved before: default art in 4:5 until a new one is sent', () => {
    const out = mapShareArtConfig({
      documentId: 'sa1',
      story_background: { id: 7, url: '/uploads/s.png', width: 1080, height: 1920 },
      story_photo_area: area,
      feed_background: { id: 8, url: '/uploads/f.png', width: 1080, height: 1080 },
      feed_photo_area: area,
    }, BASE);
    expect(out.feed).toBeNull();
    expect(out.story).not.toBeNull();
    expect(out.retired_formats).toEqual(['feed']);
  });

  it('keeps a background whose size is unknown', () => {
    const out = mapShareArtConfig({
      documentId: 'sa1',
      feed_background: { id: 8, url: '/uploads/f.png' },
      feed_photo_area: area,
    }, BASE);
    expect(out.feed).not.toBeNull();
    expect(out.retired_formats).toEqual([]);
  });
});
