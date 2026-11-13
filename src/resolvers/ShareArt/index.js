// REA-43 — arte "eu vou" personalizada: fundo e área da foto por formato.
// REA-47 — nome e papel da pessoa na arte, e o papel por produto do Eventando.
import { requireEventOrganizer } from '../../utils/auth';
import { holdsPlace } from '../../utils/payment-status';
import {
  FORMAT_KEYS,
  assertBackground,
  badInput,
  mapShareArtConfig,
  normalizeArea,
  normalizeDefaultRole,
  normalizeProductRoles,
  normalizeText,
  resolveShareArtRole,
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
 * REA-47: inside a format, a text left out is kept and a null text is removed; `product_roles` and
 * `default_role` left out are kept. `loadProductIds` lists the event's products (only called when
 * the roles are sent).
 */
export const buildShareArtData = async (input, findUploadFile, loadProductIds = async () => []) => {
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
  if (input?.default_role !== undefined) {
    data.default_role = normalizeDefaultRole(input.default_role);
  }
  if (input?.product_roles !== undefined) {
    data.product_roles = input.product_roles === null
      ? []
      : normalizeProductRoles(input.product_roles, await loadProductIds());
  }
  return data;
};

// The signups of `email` in the event, with the product of each one's batch. Eventando down → none.
const findSignups = async (eventando, slug, email) => {
  if (!slug || !email) return [];
  try {
    const eventandoEvent = (await eventando.findEventBySlug(slug))?.data?.[0];
    if (!eventandoEvent) return [];
    return (await eventando.findSignupWithProduct(eventandoEvent.id, email))?.data || [];
  } catch {
    return [];
  }
};

// Ids of the event's products in the Eventando (not deleted), to accept a role per product.
const eventProductIds = async (eventando, slug) => {
  const eventandoEvent = slug ? (await eventando.findEventBySlug(slug))?.data?.[0] : null;
  return (eventandoEvent?.products || []).filter((p) => !p.deleted).map((p) => String(p.id));
};

const ShareArt = {
  Query: {
    shareArtConfig: async (_, { eventId }, { dataSources }) => {
      if (!eventId) return null;
      const raw = await dataSources.managerIntegration.findShareArtConfigByEvent(String(eventId));
      return mapShareArtConfig(raw);
    },

    // REA-47: the role of the logged-in person on the art; null when signed out or not part of
    // the event (then the art has no role).
    myShareArtRole: async (_, { eventId }, ctx) => {
      const { user, dataSources } = ctx;
      if (!user || !eventId) return null;
      const manager = dataSources.managerIntegration;
      const event = await manager.findEventForShareArtRole(String(eventId));
      if (!event) return null;
      const [config, signups] = await Promise.all([
        manager.findShareArtConfigByEvent(event.documentId).then(mapShareArtConfig),
        findSignups(dataSources.eventandoIntegration, event.slug, user.email),
      ]);
      return resolveShareArtRole({ user, event, signups, config, holdsPlace });
    },
  },

  Mutation: {
    upsertShareArtConfig: async (_, { eventId, data }, ctx) => {
      await requireEventOrganizer(ctx, eventId);
      const ds = ctx.dataSources.managerIntegration;
      const event = await ds.findEventWithOrganizers(String(eventId));
      if (!event?.documentId) throw badInput('Evento não encontrado.');

      const payload = await buildShareArtData(
        data,
        (id) => ds.findUploadFile(id),
        () => eventProductIds(ctx.dataSources.eventandoIntegration, event.slug),
      );
      const existing = await ds.findShareArtConfigByEvent(event.documentId);
      const response = existing
        ? await ds.updateShareArtConfig(existing.documentId, payload)
        : await ds.createShareArtConfig({ ...payload, event: event.documentId });
      return mapShareArtConfig(response?.data);
    },
  },
};

export default ShareArt;
