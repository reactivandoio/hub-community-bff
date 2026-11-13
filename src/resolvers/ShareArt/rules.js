// REA-43 — pure rules of the custom "eu vou" art: formats, photo area and background checks;
// REA-47 — where the name and the role the person typed/picked in the generator go, and how they look;
// REA-49 — which roles the generator offers.
// The frontend has the same numbers in lib/share-art-config.ts; this is the one that decides.
import { GraphQLError } from 'graphql';

export const SHARE_ART_FORMATS = Object.freeze({
  story: { label: 'Stories (9:16)', ratioLabel: '9:16', ratio: 9 / 16, minWidth: 1080, minHeight: 1920 },
  // REA-47: the Instagram feed portrait; it was 1:1 before (see mapShareArtConfig).
  feed: { label: 'Feed (4:5)', ratioLabel: '4:5', ratio: 4 / 5, minWidth: 1080, minHeight: 1350 },
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

// ─── REA-47: the name and the role (as filled in the generator) on the art ─────────────────────────────

/** Fonts the art draws (the frontend maps each one to a loaded font). */
export const TEXT_FONTS = Object.freeze([
  'inter', 'inter_bold', 'serif', 'serif_bold', 'dancing_script', 'great_vibes', 'allura',
]);
export const TEXT_ALIGNS = Object.freeze(['left', 'center', 'right']);
/** Font size, as a fraction of the image width (0.05 → 54px on a 1080px art). */
export const TEXT_SIZE_MIN = 0.01;
export const TEXT_SIZE_MAX = 0.2;
/** Smallest side of a text area: a line of text is much thinner than a photo. */
export const MIN_TEXT_SIDE = 0.02;

const TEXT_LABEL = { name: 'do nome', role: 'do papel' };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Validates a text area (name or role) and returns it normalized; throws BAD_USER_INPUT. */
export const normalizeText = (format, kind, text) => {
  const { label } = SHARE_ART_FORMATS[format];
  const what = `A área ${TEXT_LABEL[kind]} no ${label}`;
  const keys = ['x', 'y', 'width', 'height', 'size'];
  if (!text || keys.some((k) => typeof text[k] !== 'number' || !Number.isFinite(text[k]))) {
    throw badInput(`Marque a área ${TEXT_LABEL[kind]} no ${label}.`);
  }
  const { x, y, width, height, size } = text;
  if (x < -EPSILON || y < -EPSILON || x + width > 1 + EPSILON || y + height > 1 + EPSILON) {
    throw badInput(`${what} precisa ficar dentro da imagem.`);
  }
  if (width < MIN_TEXT_SIDE || height < MIN_TEXT_SIDE) {
    throw badInput(`${what} está pequena demais.`);
  }
  if (!TEXT_FONTS.includes(text.font)) throw badInput(`Escolha a fonte ${TEXT_LABEL[kind]} no ${label}.`);
  if (!TEXT_ALIGNS.includes(text.align)) throw badInput(`Escolha o alinhamento ${TEXT_LABEL[kind]} no ${label}.`);
  if (typeof text.color !== 'string' || !HEX_COLOR.test(text.color)) {
    throw badInput(`A cor ${TEXT_LABEL[kind]} no ${label} precisa ser uma cor como #ffffff.`);
  }
  if (size < TEXT_SIZE_MIN || size > TEXT_SIZE_MAX) {
    const range = `${TEXT_SIZE_MIN * 100}% a ${TEXT_SIZE_MAX * 100}%`;
    throw badInput(`O tamanho ${TEXT_LABEL[kind]} no ${label} vai de ${range} da largura da imagem.`);
  }
  const nx = round(Math.max(0, x));
  const ny = round(Math.max(0, y));
  return {
    x: nx,
    y: ny,
    width: round(Math.min(width, 1 - nx)),
    height: round(Math.min(height, 1 - ny)),
    font: text.font,
    size: round(size),
    color: text.color.toLowerCase(),
    align: text.align,
  };
};

// ─── REA-49: which roles the generator offers ───────────────────────────────────────────────────

/**
 * The roles of "Seu papel no evento", in the generator's order (the frontend's SHARE_ART_ROLES).
 * The organizer may offer only some of them; null (nothing configured) = all.
 */
export const SHARE_ART_ROLES = Object.freeze([
  'Participante', 'Líder', 'Mentor', 'Voluntário', 'Palestrante', 'Organizador',
]);

const roleKey = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .trim()
  .toLowerCase();
const ROLE_BY_KEY = new Map(SHARE_ART_ROLES.map((role) => [roleKey(role), role]));

/**
 * Input list → what is saved: the known roles in the generator's order, without repeats; null when
 * every role is marked (so a role added later shows up too). An unknown name is refused.
 */
export const normalizeRoles = (roles) => {
  if (roles === null || roles === undefined) return null;
  if (!Array.isArray(roles)) throw badInput('Escolha os papéis da arte.');
  const picked = new Set();
  roles.forEach((value) => {
    const role = ROLE_BY_KEY.get(roleKey(value));
    if (!role) throw badInput(`Papel desconhecido: ${String(value)}.`);
    picked.add(role);
  });
  if (picked.size === SHARE_ART_ROLES.length) return null;
  return SHARE_ART_ROLES.filter((role) => picked.has(role));
};

/** Saved value → GraphQL: null (all) unless it is a list; unknown names dropped, order fixed. */
export const mapRoles = (saved) => {
  if (!Array.isArray(saved)) return null;
  const keys = new Set(saved.map(roleKey));
  return SHARE_ART_ROLES.filter((role) => keys.has(roleKey(role)));
};

/** Message when no role is marked while a format draws the role text. */
export const NO_ROLE_MESSAGE = 'Marque pelo menos um papel: o texto do papel está na arte.';

const mapText = (text) => {
  if (!text) return null;
  return {
    x: Number(text.x),
    y: Number(text.y),
    width: Number(text.width),
    height: Number(text.height),
    font: text.font || 'inter_bold',
    size: Number(text.size),
    color: text.color || '#ffffff',
    align: text.align || 'center',
  };
};

const mediaUrl = (media, baseUrl) => {
  const url = media?.url;
  if (!url) return null;
  return url.startsWith('http') ? url : `${baseUrl}${url}`;
};

/**
 * A background saved in another ratio than its format's — the 1:1 feed backgrounds saved before
 * the feed became 4:5 (REA-47). Its area would be stretched, so the format goes back to the default
 * art until a new background is sent. Without a known size it is kept.
 */
const isRetired = (format, media) => Boolean(media?.width && media?.height)
  && !ratioMatches(media.width, media.height, SHARE_ART_FORMATS[format].ratio);

const mapFormat = (format, media, area, baseUrl, texts = {}) => {
  const background = mediaUrl(media, baseUrl);
  if (!background || !area || isRetired(format, media)) return null;
  return {
    name_text: mapText(texts.name),
    role_text: mapText(texts.role),
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
    story: mapFormat('story', raw.story_background, raw.story_photo_area, baseUrl, {
      name: raw.story_name_text,
      role: raw.story_role_text,
    }),
    feed: mapFormat('feed', raw.feed_background, raw.feed_photo_area, baseUrl, {
      name: raw.feed_name_text,
      role: raw.feed_role_text,
    }),
    retired_formats: FORMAT_KEYS.filter((format) => isRetired(format, raw[`${format}_background`])),
    roles: mapRoles(raw.roles),
  };
};
