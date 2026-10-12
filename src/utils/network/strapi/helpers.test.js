import axios from 'axios';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStrapiFetch, redactCpf } from './helpers';

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

describe('createStrapiFetch: REA-22', () => {
  const fetch = createStrapiFetch('https://ev.test');

  it('o code do erro de negócio do Eventando chega ao chamador', async () => {
    rejectWith(400, { status: 'error', message: 'Você já está inscrito neste evento!', code: 'ALREADY_SIGNED_UP' });
    await expect(fetch('/signup/1', 'POST')).rejects.toMatchObject({ code: 'ALREADY_SIGNED_UP' });
  });

  it('o CPF de uma busca não vai para o log', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    axios.mockResolvedValueOnce({ data: { data: [] } });
    await fetch('/users?filters[cpf][$in][0]=52998224725&filters[cpf][$in][1]=529.982.247-25&pagination[pageSize]=1', 'GET');
    const logged = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain('52998224725');
    expect(logged).not.toContain('529.982.247-25');
    expect(redactCpf('/signups?filters[cpf][$eq]=1&x=2')).toBe('/signups?filters[cpf][$eq]=***&x=2');
  });
});
