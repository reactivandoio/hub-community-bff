import { GraphQLError } from 'graphql';
import { OpaPingouConnectionError } from '../../dataSources/eventando-manager/opapingou';

// REA-12: a paid lot needs the event's Opa Pingou account (or the event to be legacy, still on the
// Hub key). Free lots need nothing. Checked before any lot is written.

export const ACCOUNT_REQUIRED_MESSAGE = 'Para criar lote pago, conecte a conta Opa Pingou do evento (bloco "Conta Opa Pingou do evento", na aba de produtos e lotes). Lotes gratuitos não precisam.';

/** Any enabled lot with a price, inside an enabled product. */
export const hasPaidBatch = (products) => (products || []).some((p) => p && p.enabled !== false
  && (p.batches || []).some((b) => b && b.enabled !== false && Number(b.value) > 0));

export const requirePaymentAccount = async ({ eventando, eventUuid, products }) => {
  if (!hasPaidBatch(products)) return;
  let state = null;
  try {
    state = await eventando.eventConnection(eventUuid);
  } catch (err) {
    if (!(err instanceof OpaPingouConnectionError && err.code === 'EVENT_NOT_FOUND')) throw err;
  }
  if (state?.connection || state?.legacy) return;
  throw new GraphQLError(ACCOUNT_REQUIRED_MESSAGE, { extensions: { code: 'OPAPINGOU_ACCOUNT_REQUIRED' } });
};
