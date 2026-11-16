import { describe, it, expect, vi, beforeEach } from 'vitest';
import emailCampaigns from './index';

// The shared fetch (utils/network/strapi createStrapiFetch) answers { data, meta } with `meta`
// already being Strapi's pagination object — not { pagination: {...} }.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../../../utils/network/manager', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: { ...actual.default, fetch: fetchMock } };
});

const ds = () => emailCampaigns({ headers: {} });
const page = (rows, { page: p = 1, pageCount = 1, total = rows.length } = {}) => ({
  data: rows, meta: { page: p, pageSize: 100, pageCount, total },
});

beforeEach(() => fetchMock.mockReset());

describe('findEmailDeliveriesByEmail (REA-52)', () => {
  it('gives the total of the address, not of the page (the "E-mails (0)" bug)', async () => {
    fetchMock.mockResolvedValue({ data: [{ documentId: 'a' }, { documentId: 'b' }], meta: { page: 1, pageSize: 20, pageCount: 1, total: 2 } });
    const out = await ds().findEmailDeliveriesByEmail('ana@x.io', { page: 1, pageSize: 20 });
    expect(out.total).toBe(2);
    expect(out.items).toHaveLength(2);
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain('filters[email][$eqi]=ana@x.io');
  });
});

describe('findTransactionalDeliveries (REA-50)', () => {
  it('reads every page of a chunk', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ key: `k${i}` }));
    fetchMock
      .mockResolvedValueOnce(page(full, { page: 1, pageCount: 2, total: 101 }))
      .mockResolvedValueOnce(page([{ key: 'last' }], { page: 2, pageCount: 2, total: 101 }));
    const rows = await ds().findTransactionalDeliveries(['ana@x.io'], ['signup-confirmation']);
    expect(rows).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(fetchMock.mock.calls[1][0])).toContain('pagination[page]=2');
  });
});
