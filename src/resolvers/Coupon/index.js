import { requireAdmin } from '../../utils/auth';
import { findEventandoEvent } from '../../utils/eventando-event';
import { countsAsCouponUse } from '../../utils/payment-status';

const firstDefined = (...values) => values.find((v) => v !== undefined && v !== null);

// The Eventando answer of POST /api/coupon/preview, in either spelling.
const toPreview = (body) => {
  const data = body?.data && !Array.isArray(body.data) ? body.data : body || {};
  return {
    valid: data.valid !== false,
    message: data.message || null,
    discount_kind: data.discount_kind || data.discountKind || null,
    final_value: firstDefined(data.final_value, data.finalCents, null),
    original_value: firstDefined(data.original_value, data.originalCents, null),
    min_charge_applied: Boolean(firstDefined(data.min_charge_applied, data.minApplied, false)),
  };
};

const preview = async (dataSources, { eventSlug, batchId, code, isStudent }) => {
  const event = await findEventandoEvent(dataSources, eventSlug);
  if (!event) return { valid: false, message: 'Evento não encontrado.' };
  try {
    const response = await dataSources.eventandoIntegration.previewCoupon({
      event_id: event.id,
      batch_id: parseInt(batchId, 10),
      code: (code || '').trim(),
      is_student: Boolean(isStudent),
    });
    return toPreview(response?.data);
  } catch (err) {
    // A 400 of the Eventando carries the reason for the person ("Este cupom já expirou.").
    return { valid: false, message: err.message || 'Erro ao validar cupom.' };
  }
};

const numberOr = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

const toCoupon = (coupon) => {
  if (!coupon) return coupon;
  const { payments, ...rest } = coupon;
  return {
    ...rest,
    id: coupon.id !== undefined ? String(coupon.id) : coupon.id,
    discount_type: coupon.discount_type || 'percentage',
    discount_value_cents: numberOr(coupon.discount_value_cents),
    uses: Array.isArray(payments) ? payments.filter((p) => countsAsCouponUse(p)).length : null,
    batches: Array.isArray(coupon.batches) ? coupon.batches : [],
  };
};

// CouponInput → Eventando body: the event key becomes its id there, batches numbers.
const toEventandoCoupon = async (dataSources, data) => {
  const event = await findEventandoEvent(dataSources, data.event);
  if (!event) throw new Error('Evento não encontrado.');
  const body = {
    code: (data.code || '').trim(),
    discount_type: data.discount_type || 'percentage',
    event: event.id,
  };
  ['discount_percentage', 'discount_value_cents', 'max_uses', 'enabled', 'starts_at', 'expires_at']
    .forEach((field) => {
      if (data[field] !== undefined) body[field] = data[field] === '' ? null : data[field];
    });
  if (Array.isArray(data.batches)) {
    body.batches = data.batches.map((id) => parseInt(id, 10)).filter(Number.isInteger);
  }
  return body;
};

const Coupon = {
  Query: {
    validateCoupon: async (_, { eventSlug, code, batchId, isStudent }, { dataSources }) => {
      if (batchId) {
        const result = await preview(dataSources, { eventSlug, batchId, code, isStudent });
        return { valid: result.valid, message: result.message, discount_percentage: null };
      }
      try {
        // Look up the event in Eventando Manager
        const eventResponse = await dataSources.eventandoIntegration.findEventBySlug(eventSlug);
        const eventandoEvent = eventResponse?.data?.[0];

        if (!eventandoEvent) {
          return { valid: false, message: 'Evento não encontrado.' };
        }

        // Find the coupon by code and event
        const couponResponse = await dataSources.eventandoIntegration.findCoupons({
          code: { eq: code },
          event: { id: { eq: eventandoEvent.id } },
          enabled: { eq: true },
        });

        const coupon = couponResponse?.data?.[0];

        if (!coupon) {
          return { valid: false, message: 'Cupom inválido ou desativado.' };
        }

        // Check the validity window
        if (coupon.starts_at && new Date() < new Date(coupon.starts_at)) {
          return { valid: false, message: 'Este cupom ainda não está valendo.' };
        }
        if (coupon.expires_at && new Date() > new Date(coupon.expires_at)) {
          return { valid: false, message: 'Este cupom já expirou.' };
        }

        if (coupon.discount_type === 'fixed') {
          const reais = (Number(coupon.discount_value_cents || 0) / 100).toFixed(2).replace('.', ',');
          return { valid: true, discount_percentage: null, message: `Desconto de R$ ${reais} aplicado!` };
        }
        return {
          valid: true,
          discount_percentage: coupon.discount_percentage,
          message: `Desconto de ${coupon.discount_percentage}% aplicado!`,
        };
      } catch (err) {
        return { valid: false, message: 'Erro ao validar cupom.' };
      }
    },

    previewCoupon: async (_, args, { dataSources }) => preview(dataSources, args),

    eventCoupons: async (_, { eventId }, ctx) => {
      await requireAdmin(ctx);
      const event = await findEventandoEvent(ctx.dataSources, eventId);
      if (!event) return [];
      const response = await ctx.dataSources.eventandoIntegration.findCoupons(
        { event: { id: { eq: event.id } } },
        ['batches', 'payments'],
      );
      return (response?.data || []).map(toCoupon);
    },
  },
  Mutation: {
    createCoupon: async (_, { data }, ctx) => {
      await requireAdmin(ctx);
      try {
        const body = await toEventandoCoupon(ctx.dataSources, data);
        const response = await ctx.dataSources.eventandoIntegration.createCoupon(body);
        return toCoupon(response.data);
      } catch (err) {
        throw new Error(`Erro ao criar cupom: ${err.message}`);
      }
    },
    updateCoupon: async (_, { id, data }, ctx) => {
      await requireAdmin(ctx);
      try {
        const body = await toEventandoCoupon(ctx.dataSources, data);
        const response = await ctx.dataSources.eventandoIntegration.updateCoupon(id, body);
        return toCoupon(response.data);
      } catch (err) {
        throw new Error(`Erro ao atualizar cupom: ${err.message}`);
      }
    },
    deleteCoupon: async (_, { id }, ctx) => {
      await requireAdmin(ctx);
      try {
        const response = await ctx.dataSources.eventandoIntegration.deleteCoupon(id);
        return toCoupon(response.data);
      } catch (err) {
        throw new Error(`Erro ao apagar cupom: ${err.message}`);
      }
    },
  },
};

export default Coupon;
