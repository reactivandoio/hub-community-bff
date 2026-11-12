import { requireAdmin } from '../../utils/auth';
import { findEventandoEvent } from '../../utils/eventando-event';
import {
  effectiveStatus, isManuallyApproved, manualApproverOf, OPAPINGOU,
} from '../../utils/payment-status';
import { signupIdOf } from '../../utils/signup-id';
import { sendSignupConfirmation } from '../../services/email/signup-confirmation';

const numberOrNull = (value) => (value === null || value === undefined || value === '' ? null : Number(value));

const refundSupport = (payment) => {
  const fromEventando = payment?.refund_support || {};
  const text = fromEventando.text || process.env.REFUND_SUPPORT_TEXT || null;
  const whatsapp = fromEventando.whatsapp || process.env.REFUND_SUPPORT_WHATSAPP || null;
  return text || whatsapp ? { text, whatsapp } : null;
};

// REA-34: os códigos de erro da aprovação manual no Eventando, para o admin.
const APPROVAL_ERRORS = {
  NOT_FOUND: 'Inscrição não encontrada neste evento.',
  NO_PAYMENT: 'Esta inscrição não tem pagamento: ela já ocupa a vaga, não precisa de aprovação.',
  ALREADY_CONFIRMED: 'Esta inscrição já está confirmada (o pagamento foi recebido).',
  REFUNDED: 'Esta inscrição foi reembolsada e não pode ser aprovada.',
};

const warningsOf = (value) => (Array.isArray(value) ? value.filter((w) => typeof w === 'string') : []);

// Quem aprovou, gravado no payment pelo Eventando.
const approverOf = (user) => ({
  id: String(user.documentId || user.id),
  email: user.email || null,
  name: user.name || user.username || null,
});

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
          manual_approved: isManuallyApproved(p),
          manual_approved_at: p.manual_approved_at || null,
          manual_approved_by: manualApproverOf(p),
        }));
    },

    // REA-34: se a inscrição pode ser aprovada sem cobrança, e o que a confirmação deve
    // avisar (lote / evento lotado, cupom esgotado).
    signupApprovalPreview: async (_, { event: key, signup_id: signupId }, ctx) => {
      requireAdmin(ctx);
      const event = await findEventandoEvent(ctx.dataSources, key);
      if (!event) return { approvable: false, reason: 'NOT_FOUND', status: null, warnings: [] };
      const preview = await ctx.dataSources.eventandoIntegration.manualApprovalPreview({
        eventId: event.id,
        signupId,
      });
      return {
        approvable: Boolean(preview?.approvable),
        reason: preview?.reason || null,
        status: preview?.status || null,
        warnings: warningsOf(preview?.warnings),
      };
    },
  },

  Mutation: {
    // REA-34: confirma uma inscrição pendente, expirada ou cancelada sem gerar cobrança
    // (nada muda no Opa Pingou) e manda o "Inscrição confirmada" com o ingresso, como o
    // webhook faz num pagamento confirmado. Repetir a chamada não manda outro e-mail.
    approveSignupManually: async (_, { event: key, signup_id: signupId }, ctx) => {
      const user = requireAdmin(ctx);
      const { dataSources } = ctx;
      const event = await findEventandoEvent(dataSources, key);
      if (!event) {
        return { success: false, message: `Evento "${key}" não encontrado.`, warnings: [] };
      }

      let result;
      try {
        result = await dataSources.eventandoIntegration.approveSignupManually({
          eventId: event.id,
          signupId,
          approvedBy: approverOf(user),
        });
      } catch (err) {
        if (APPROVAL_ERRORS[err.code]) {
          return { success: false, message: APPROVAL_ERRORS[err.code], warnings: [] };
        }
        console.error(`[ManualApproval] inscrição ${signupId} do evento ${event.id}:`, err.message);
        return { success: false, message: `Não foi possível aprovar a inscrição: ${err.message}`, warnings: [] };
      }

      const warnings = warningsOf(result?.warnings);
      if (result?.already_approved) {
        return {
          success: true,
          message: 'Esta inscrição já tinha sido aprovada manualmente.',
          already_approved: true,
          warnings,
          email_sent: false,
        };
      }

      const signup = result?.signup || {};
      const sent = await sendSignupConfirmation({
        dataSources,
        eventSlug: result?.event?.slug || event.slug || event.uuid,
        eventandoEvent: event,
        signupId: signupIdOf(signup),
        name: signup.name,
        email: signup.email,
        phone: signup.phone_number || null,
        cpf: signup.cpf || null,
        isFree: false,
        isPaid: true,
      });
      const emailSent = Boolean(sent?.success);
      console.log(
        `[ManualApproval] inscrição ${signupId} do evento ${event.id} aprovada por ${user.email || user.id}`
          + `; e-mail ${emailSent ? 'enviado' : `não enviado (${sent?.error || 'erro'})`}`,
      );
      return {
        success: true,
        message: emailSent
          ? 'Inscrição aprovada. A pessoa recebeu o e-mail de confirmação com o ingresso.'
          : 'Inscrição aprovada, mas o e-mail de confirmação não foi enviado.',
        already_approved: false,
        warnings,
        email_sent: emailSent,
      };
    },
  },
};

export default Payment;
