import { requireAdmin } from '../../utils/auth';
import { findEventandoEvent } from '../../utils/eventando-event';
import { effectiveStatus, OPAPINGOU } from '../../utils/payment-status';

const numberOrNull = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

const refundSupport = (payment) => {
  const fromEventando = payment?.refund_support || {};
  const text = fromEventando.text || process.env.REFUND_SUPPORT_TEXT || null;
  const whatsapp = fromEventando.whatsapp || process.env.REFUND_SUPPORT_WHATSAPP || null;
  return text || whatsapp ? { text, whatsapp } : null;
};

const Payment = {
  Query: {
    signupPaymentStatus: async (_, { signupId }, { dataSources }) => {
      const signup = await dataSources.eventandoIntegration.findSignupWithPayment(signupId);
      const payment = signup?.payment;
      if (!payment) return null;
      return {
        signup_id: String(signup.id),
        status: effectiveStatus(payment),
        provider: payment.provider || null,
        kind: payment.kind || null,
        expires_at: payment.expires_at || null,
        confirmed_at: payment.confirmed_at || null,
        pix_br_code: payment.pix_br_code || null,
        payment_link: payment.payment_link || null,
        value: numberOrNull(payment.value),
        refund_support: refundSupport(payment),
      };
    },

    eventPaymentSettings: async (_, { eventId }, ctx) => {
      await requireAdmin(ctx);
      const event = await findEventandoEvent(ctx.dataSources, eventId);
      return { payment_provider: event ? OPAPINGOU : null };
    },

    eventPayments: async (_, { slugOrId }, ctx) => {
      await requireAdmin(ctx);
      const event = await findEventandoEvent(ctx.dataSources, slugOrId);
      if (!event) return [];
      const payments = await ctx.dataSources.eventandoIntegration.findPaymentsByEvent(event.id);
      return payments
        .filter((p) => p?.status)
        .map((p) => ({
          email: p.signup?.email || '',
          name: p.signup?.name || null,
          status: effectiveStatus(p),
          value: numberOrNull(p.value),
          expires_at: p.expires_at || null,
        }));
    },
  },
};

export default Payment;
