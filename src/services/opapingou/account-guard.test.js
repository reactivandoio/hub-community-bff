import { describe, it, expect, vi } from 'vitest';
import { hasPaidBatch, requirePaymentAccount } from './account-guard';
import { OpaPingouConnectionError } from '../../dataSources/eventando-manager/opapingou';

const paid = [{ name: 'Ingresso', batches: [{ value: 2500 }] }];

describe('hasPaidBatch', () => {
  it('só conta lote ativo com valor, em produto ativo', () => {
    expect(hasPaidBatch(paid)).toBe(true);
    expect(hasPaidBatch([{ batches: [{ value: 0 }, { value: '0' }] }])).toBe(false);
    expect(hasPaidBatch([{ batches: [{ value: 2500, enabled: false }] }])).toBe(false);
    expect(hasPaidBatch([{ enabled: false, batches: [{ value: 2500 }] }])).toBe(false);
    expect(hasPaidBatch(undefined)).toBe(false);
  });
});

describe('requirePaymentAccount', () => {
  const eventando = (state) => ({ eventConnection: vi.fn().mockResolvedValue(state) });

  it('lote gratuito: nem consulta', async () => {
    const e = eventando(null);
    await requirePaymentAccount({ eventando: e, eventUuid: 'ev', products: [{ batches: [{ value: 0 }] }] });
    expect(e.eventConnection).not.toHaveBeenCalled();
  });

  it('lote pago com conta ou evento legado: passa', async () => {
    await requirePaymentAccount({ eventando: eventando({ connection: { id: 'opc_1' }, legacy: false }), eventUuid: 'ev', products: paid });
    await requirePaymentAccount({ eventando: eventando({ connection: null, legacy: true }), eventUuid: 'ev', products: paid });
  });

  it('lote pago sem conta: OPAPINGOU_ACCOUNT_REQUIRED', async () => {
    const err = await requirePaymentAccount({ eventando: eventando({ connection: null, legacy: false }), eventUuid: 'ev', products: paid }).catch((e) => e);
    expect(err.extensions.code).toBe('OPAPINGOU_ACCOUNT_REQUIRED');
    expect(err.message).toMatch(/conecte a conta Opa Pingou/);
  });

  it('evento ainda sem registro no Eventando conta como sem conta', async () => {
    const e = { eventConnection: vi.fn().mockRejectedValue(new OpaPingouConnectionError({ code: 'EVENT_NOT_FOUND' })) };
    const err = await requirePaymentAccount({ eventando: e, eventUuid: 'ev', products: paid }).catch((x) => x);
    expect(err.extensions.code).toBe('OPAPINGOU_ACCOUNT_REQUIRED');
  });

  it('Eventando fora do ar: o erro sobe (o save falharia de qualquer jeito)', async () => {
    const e = { eventConnection: vi.fn().mockRejectedValue(new Error('down')) };
    await expect(requirePaymentAccount({ eventando: e, eventUuid: 'ev', products: paid })).rejects.toThrow('down');
  });
});
