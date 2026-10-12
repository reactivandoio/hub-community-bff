import { describe, it, expect, vi } from 'vitest';
import Coupon from './index';

const admin = { id: 1, role: { type: 'admin' } };
const makeCtx = (over = {}, user = admin) => ({
  user,
  dataSources: {
    managerIntegration: {},
    eventandoIntegration: {
      findEvents: vi.fn().mockResolvedValue({ data: [{ id: 3, slug: 'meetup' }] }),
      previewCoupon: vi.fn().mockResolvedValue({ data: { valid: true, message: 'Cupom aplicado', discountKind: 'coupon', finalCents: 2549, originalCents: 2999, minApplied: false } }),
      findCoupons: vi.fn().mockResolvedValue({ data: [] }),
      createCoupon: vi.fn().mockResolvedValue({ data: { id: 7, code: 'X' } }),
      updateCoupon: vi.fn().mockResolvedValue({ data: { id: 7, code: 'X' } }),
      deleteCoupon: vi.fn().mockResolvedValue({ data: { id: 7 } }),
      ...over,
    },
  },
});

describe('previewCoupon', () => {
  it('delegado ao Eventando com o id interno do evento e do lote', async () => {
    const ctx = makeCtx();
    const out = await Coupon.Query.previewCoupon(null, { eventSlug: 'meetup', batchId: '4', code: ' DESC15 ', isStudent: true }, ctx);
    expect(ctx.dataSources.eventandoIntegration.previewCoupon).toHaveBeenCalledWith({ event_id: 3, batch_id: 4, code: 'DESC15', is_student: true });
    expect(out).toEqual({ valid: true, message: 'Cupom aplicado', discount_kind: 'coupon', final_value: 2549, original_value: 2999, min_charge_applied: false });
  });

  it('recusa do Eventando vira valid false com a mensagem', async () => {
    const ctx = makeCtx({ previewCoupon: vi.fn().mockRejectedValue(new Error('Você já usou um cupom neste evento.')) });
    const out = await Coupon.Query.previewCoupon(null, { eventSlug: 'meetup', batchId: '4', code: 'X' }, ctx);
    expect(out).toEqual({ valid: false, message: 'Você já usou um cupom neste evento.' });
  });

  it('validateCoupon com batchId usa o preview', async () => {
    const ctx = makeCtx();
    const out = await Coupon.Query.validateCoupon(null, { eventSlug: 'meetup', code: 'X', batchId: '4' }, ctx);
    expect(out.valid).toBe(true);
    expect(ctx.dataSources.eventandoIntegration.previewCoupon).toHaveBeenCalled();
  });
});

describe('cupons do admin', () => {
  it('create/update/delete/eventCoupons exigem admin', async () => {
    const data = { code: 'X', event: 'u1' };
    for (const call of [
      (c) => Coupon.Mutation.createCoupon(null, { data }, c),
      (c) => Coupon.Mutation.updateCoupon(null, { id: '7', data }, c),
      (c) => Coupon.Mutation.deleteCoupon(null, { id: '7' }, c),
      (c) => Coupon.Query.eventCoupons(null, { eventId: 'u1' }, c),
    ]) {
      const anon = makeCtx({}, null);
      // eslint-disable-next-line no-await-in-loop
      await expect(call(anon)).rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
      const user = makeCtx({}, { id: 2, role: { type: 'authenticated' } });
      // eslint-disable-next-line no-await-in-loop
      await expect(call(user)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
      expect(user.dataSources.eventandoIntegration.createCoupon).not.toHaveBeenCalled();
      expect(user.dataSources.eventandoIntegration.deleteCoupon).not.toHaveBeenCalled();
    }
  });

  it('createCoupon traduz o evento do Hub para o id do Eventando e os lotes para números', async () => {
    const ctx = makeCtx();
    await Coupon.Mutation.createCoupon(null, { data: {
      code: ' MEIA10 ', discount_type: 'fixed', discount_value_cents: 1000, event: 'u1', batches: ['4', '5'], max_uses: 10,
    } }, ctx);
    expect(ctx.dataSources.eventandoIntegration.createCoupon).toHaveBeenCalledWith({
      code: 'MEIA10', discount_type: 'fixed', discount_value_cents: 1000, event: 3, batches: [4, 5], max_uses: 10,
    });
  });

  it('erro do Eventando (tipo/valor travado) chega ao admin', async () => {
    const ctx = makeCtx({ updateCoupon: vi.fn().mockRejectedValue(new Error('Tipo e valor não podem mudar depois do primeiro uso.')) });
    await expect(Coupon.Mutation.updateCoupon(null, { id: '7', data: { code: 'X', event: 'u1', discount_percentage: 20 } }, ctx))
      .rejects.toThrow('Tipo e valor não podem mudar depois do primeiro uso.');
  });

  it('eventCoupons conta os usos válidos', async () => {
    const ctx = makeCtx({ findCoupons: vi.fn().mockResolvedValue({ data: [{
      id: 7, code: 'X', discount_percentage: 10, batches: [{ id: 4, batch_number: 1 }],
      payments: [
        { status: 'CONFIRMED' },
        { status: 'PEDING_PAYMENT', expires_at: '2099-01-01T00:00:00Z' },
        { status: 'PEDING_PAYMENT', expires_at: '2000-01-01T00:00:00Z' },
        { status: 'CANCELED' },
      ],
    }] }) });
    const [coupon] = await Coupon.Query.eventCoupons(null, { eventId: 'u1' }, ctx);
    expect(coupon).toMatchObject({ id: '7', discount_type: 'percentage', uses: 2, batches: [{ id: 4, batch_number: 1 }] });
    expect(coupon.payments).toBeUndefined();
    expect(ctx.dataSources.eventandoIntegration.findCoupons).toHaveBeenCalledWith({ event: { id: { eq: 3 } } }, ['batches', 'payments']);
  });
});
