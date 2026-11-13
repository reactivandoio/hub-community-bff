// REA-43 — pure rules of the custom "eu vou" art: formats, photo area and background checks.
// The frontend has the same numbers in lib/share-art-config.ts; this is the one that decides.
import { GraphQLError } from 'graphql';

export const SHARE_ART_FORMATS = Object.freeze({
  story: { label: 'Stories (9:16)', ratioLabel: '9:16', ratio: 9 / 16, minWidth: 1080, minHeight: 1920 },
  feed: { label: 'Feed (1:1)', ratioLabel: '1:1', ratio: 1, minWidth: 1080, minHeight: 1080 },
});

export const FORMAT_KEYS = Object.keys(SHARE_ART_FORMATS);

/** How far (relative) a background may be from its format's ratio: 1%, e.g. 1080×1910 passes for 9:16, 1080×1900 does not. */
export const RATIO_TOLERANCE = 0.01;

/** Smallest side of the photo area, as a fraction of the image. */
export const MIN_AREA_SIDE = 0.05;

const EPSILON = 1e-6;
const round = (n) => Math.round(n * 1e6) / 1e6;

export const badInput = (message) => new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });

export const ratioMatches = (width, height, ratio) => {
  if (!(width > 0) || !(height > 0)) return false;
  return Math.abs(width / height - ratio) / ratio <= RATIO_TOLERANCE;
};

/**
 * Checks a background against its format. `media` is a file of the Strapi media library
 * ({ mime, width, height }). Throws BAD_USER_INPUT with a message the admin can act on.
 */
export const assertBackground = (format, media) => {
  const spec = SHARE_ART_FORMATS[format];
  if (!media) throw badInput(`Imagem de fundo do ${spec.label} não encontrada. Envie de novo.`);
  if (media.mime && !String(media.mime).startsWith('image/')) {
    throw badInput(`O fundo do ${spec.label} precisa ser uma imagem.`);
  }
  const { width, height } = media;
  if (!ratioMatches(width, height, spec.ratio)) {
    const size = width && height ? ` (a enviada tem ${width}×${height})` : '';
    throw badInput(`O fundo do ${spec.label} precisa ter proporção ${spec.ratioLabel}${size}.`);
  }
  if (width < spec.minWidth) {
    throw badInput(
      `O fundo do ${spec.label} precisa ter ao menos ${spec.minWidth}×${spec.minHeight} pixels (a enviada tem ${width}×${height}).`,
    );
  }
};

/**
 * Validates the photo area (fractions of the image) and returns it rounded to 6 places.
 * A tiny overflow from floating point (x + width = 1.0000001) is clamped, anything else refused.
 */
export const normalizeArea = (format, area) => {
  const { label } = SHARE_ART_FORMATS[format];
  const keys = ['x', 'y', 'width', 'height', 'radius'];
  if (!area || keys.some((k) => typeof area[k] !== 'number' || !Number.isFinite(area[k]))) {
    throw badInput(`Marque a área da foto no ${label}.`);
  }
  const { x, y, width, height, radius } = area;
  if (x < -EPSILON || y < -EPSILON || x + width > 1 + EPSILON || y + height > 1 + EPSILON) {
    throw badInput(`A área da foto no ${label} precisa ficar dentro da imagem.`);
  }
  if (width < MIN_AREA_SIDE || height < MIN_AREA_SIDE) {
    throw badInput(`A área da foto no ${label} está pequena demais.`);
  }
  if (radius < 0 || radius > 1) {
    throw badInput(`O arredondamento da área no ${label} vai de 0 (canto reto) a 1 (círculo).`);
  }
  const nx = round(Math.max(0, x));
  const ny = round(Math.max(0, y));
  return {
    x: nx,
    y: ny,
    width: round(Math.min(width, 1 - nx)),
    height: round(Math.min(height, 1 - ny)),
    radius: round(radius),
  };
};

const mediaUrl = (media, baseUrl) => {
  const url = media?.url;
  if (!url) return null;
  return url.startsWith('http') ? url : `${baseUrl}${url}`;
};

const mapFormat = (media, area, baseUrl) => {
  const background = mediaUrl(media, baseUrl);
  if (!background || !area) return null;
  return {
    background,
    background_id: String(media.id),
    background_width: media.width ?? null,
    background_height: media.height ?? null,
    photo_area: {
      x: Number(area.x),
      y: Number(area.y),
      width: Number(area.width),
      height: Number(area.height),
      radius: Number(area.radius ?? 0),
    },
  };
};

/** Raw Strapi record → GraphQL ShareArtConfig. A format without background or area is null. */
export const mapShareArtConfig = (raw, baseUrl = process.env.MANAGER_URL) => {
  if (!raw) return null;
  return {
    id: raw.documentId ?? null,
    story: mapFormat(raw.story_background, raw.story_photo_area, baseUrl),
    feed: mapFormat(raw.feed_background, raw.feed_photo_area, baseUrl),
  };
};
