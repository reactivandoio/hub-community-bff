import axios from 'axios';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStrapiFetch } from './helpers';

vi.mock('axios', () => ({ default: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const rejectWith = (status, data) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  axios.mockRejectedValueOnce(err);
};

describe('createStrapiFetch: mensagem de erro', () => {
  const fetch = createStrapiFetch('https://ev.test');
  vi.spyOn(console, 'log').mockImplementation(() => {});

  it('erro no formato do Strapi', async () => {
    rejectWith(400, { error: { message: 'Lote esgotado' } });
    await expect(fetch('/signup/1', 'POST')).rejects.toThrow('Lote esgotado');
  });

  it('erro de negócio do Eventando ({ status: "error", message })', async () => {
    rejectWith(400, { status: 'error', message: 'Informe um CPF válido.' });
    await expect(fetch('/signup/1', 'POST')).rejects.toThrow('Informe um CPF válido.');
  });

  it('sem corpo útil: a mensagem do axios', async () => {
    rejectWith(502, '<html>bad gateway</html>');
    await expect(fetch('/signup/1', 'POST')).rejects.toThrow('Request failed with status code 502');
  });
});
