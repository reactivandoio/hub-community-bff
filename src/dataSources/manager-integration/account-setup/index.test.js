import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import accountSetup from './index';

// vi.mock is hoisted above the imports by vitest.
vi.mock('axios', () => ({ default: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('accountSetup', () => {
  it('POSTs to /api/account-setup with the integration headers and returns { created, token }', async () => {
    axios.mockResolvedValue({ data: { created: true, token: 'tok' } });
    const out = await accountSetup({ headers: { Authorization: 'Bearer int' } })
      .accountSetup({ email: 'ana@x.io', name: 'Ana', phone: '62999' });
    expect(out).toEqual({ created: true, token: 'tok' });
    const [{ method, url, headers, data }] = axios.mock.calls[0];
    expect(method).toBe('POST');
    expect(url).toMatch(/\/api\/account-setup$/);
    expect(headers.Authorization).toBe('Bearer int');
    expect(data).toEqual({ email: 'ana@x.io', name: 'Ana', phone: '62999' });
  });

  it('propagates a manager error to the caller', async () => {
    axios.mockRejectedValue(Object.assign(new Error('boom'), { response: { data: { error: { message: 'Not Found' } } } }));
    await expect(accountSetup({ headers: {} }).accountSetup({ email: 'ana@x.io' })).rejects.toThrow('Not Found');
  });
});
