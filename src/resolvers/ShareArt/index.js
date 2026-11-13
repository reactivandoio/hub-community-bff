// REA-43 — arte "eu vou" personalizada: fundo e área da foto por formato.
// REA-47 — onde ficam o nome e o papel que a pessoa preenche no gerador, e com que estilo.
// REA-49 — quais papéis o gerador oferece.
import { requireEventOrganizer } from '../../utils/auth';
import {
  FORMAT_KEYS,
  NO_ROLE_MESSAGE,
  assertBackground,
  badInput,
  mapShareArtConfig,
  normalizeArea,
  normalizeRoles,
  normalizeText,
} from './rules';

const mediaId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const TEXT_KINDS = ['name', 'role'];

/**
 * GraphQL input → Strapi payload. Formats left out are not touched; a null format goes back to
 * the default art (background, areas and texts cleared). Each background is read from the media
 * library to check its ratio and size, so a crafted request cannot skip the frontend check.
 * REA-47: inside a format, a text left out is kept and a null text is removed.
 */
export const buildShareArtData = async (input, findUploadFile) => {
  const data = {};
  // eslint-disable-next-line no-restricted-syntax
  for (const format of FORMAT_KEYS) {
    const value = input?.[format];
    // eslint-disable-next-line no-continue
    if (value === undefined) continue;
    if (value === null) {
      data[`${format}_background`] = null;
      data[`${format}_photo_area`] = null;
      data[`${format}_name_text`] = null;
      data[`${format}_role_text`] = null;
      // eslint-disable-next-line no-continue
      continue;
    }
    const id = mediaId(value.background);
    if (!id) throw badInput('Escolha a imagem de fundo.');
    const area = normalizeArea(format, value.photo_area);
    // eslint-disable-next-line no-await-in-loop
    const media = await findUploadFile(id).catch(() => null);
    assertBackground(format, media);
    data[`${format}_background`] = id;
    data[`${format}_photo_area`] = area;
    TEXT_KINDS.forEach((kind) => {
      const text = value[`${kind}_text`];
      if (text === undefined) return;
      data[`${format}_${kind}_text`] = text === null ? null : normalizeText(format, kind, text);
    });
  }
  // REA-49: left out → kept; null → every role.
  if (input?.roles !== undefined) data.roles = normalizeRoles(input.roles);
  return data;
};

/**
 * REA-49: after the save, some role must be left to pick while a format draws the role text.
 * `payload` is what will be written, `existing` the saved record (null on the first save); a field
 * left out of the payload keeps its saved value.
 */
export const assertRolesFit = (payload, existing) => {
  const value = (key) => (key in payload ? payload[key] : existing?.[key]);
  const roles = value('roles');
  if (!Array.isArray(roles) || roles.length > 0) return;
  const placed = FORMAT_KEYS.some((format) => value(`${format}_background`) && value(`${format}_role_text`));
  if (placed) throw badInput(NO_ROLE_MESSAGE);
};

const ShareArt = {
  Query: {
    shareArtConfig: async (_, { eventId }, { dataSources }) => {
      if (!eventId) return null;
      const raw = await dataSources.managerIntegration.findShareArtConfigByEvent(String(eventId));
      return mapShareArtConfig(raw);
    },

  },

  Mutation: {
    upsertShareArtConfig: async (_, { eventId, data }, ctx) => {
      await requireEventOrganizer(ctx, eventId);
      const ds = ctx.dataSources.managerIntegration;
      const event = await ds.findEventWithOrganizers(String(eventId));
      if (!event?.documentId) throw badInput('Evento não encontrado.');

      const payload = await buildShareArtData(data, (id) => ds.findUploadFile(id));
      const existing = await ds.findShareArtConfigByEvent(event.documentId);
      assertRolesFit(payload, existing);
      const response = existing
        ? await ds.updateShareArtConfig(existing.documentId, payload)
        : await ds.createShareArtConfig({ ...payload, event: event.documentId });
      return mapShareArtConfig(response?.data);
    },
  },
};

export default ShareArt;
