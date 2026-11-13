// REA-43 — arte "eu vou" personalizada: fundo e área da foto por formato.
import { requireEventOrganizer } from '../../utils/auth';
import {
  FORMAT_KEYS,
  assertBackground,
  badInput,
  mapShareArtConfig,
  normalizeArea,
} from './rules';

const mediaId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * GraphQL input → Strapi payload. Formats left out are not touched; a null format goes back to
 * the default art (background and area cleared). Each background is read from the media library
 * to check its ratio and size, so a crafted request cannot skip the frontend check.
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
  }
  return data;
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
      const response = existing
        ? await ds.updateShareArtConfig(existing.documentId, payload)
        : await ds.createShareArtConfig({ ...payload, event: event.documentId });
      return mapShareArtConfig(response?.data);
    },
  },
};

export default ShareArt;
