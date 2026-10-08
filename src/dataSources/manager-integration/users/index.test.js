import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import users from './index';

// vi.mock is hoisted above the imports by vitest.
vi.mock('axios', () => ({ default: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('findUsersByEmails', () => {
  it('asks Strapi with an indexed $in filter, deduplicated and lower-cased', async () => {
    axios.mockResolvedValue({ data: [{ email: 'ana@x.io', name: 'Ana' }] });
    const out = await users({ headers: {} }).findUsersByEmails(['Ana@x.io', 'ana@x.io', '', 'bia@x.io']);
    expect(out).toEqual([{ email: 'ana@x.io', name: 'Ana' }]);
    expect(axios).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent(axios.mock.calls[0][0].url);
    expect(url).toContain('/api/users?');
    expect(url).toContain('filters[email][$in][0]=ana@x.io');
    expect(url).toContain('filters[email][$in][1]=bia@x.io');
    expect(url).not.toContain('$in][2]');
    expect(url).toContain('pagination[pageSize]=100');
  });

  it('splits into requests of 50 e-mails and concatenates the results', async () => {
    axios.mockResolvedValueOnce({ data: [{ email: 'u0@x.io' }] }).mockResolvedValueOnce({ data: [{ email: 'u50@x.io' }] });
    const emails = Array.from({ length: 60 }, (_, i) => `u${i}@x.io`);
    const out = await users({ headers: {} }).findUsersByEmails(emails);
    expect(axios).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(axios.mock.calls[0][0].url)).toContain('$in][49]=u49@x.io');
    expect(decodeURIComponent(axios.mock.calls[1][0].url)).toContain('$in][0]=u50@x.io');
    expect(out).toEqual([{ email: 'u0@x.io' }, { email: 'u50@x.io' }]);
  });

  it('returns nothing without hitting Strapi when there are no e-mails', async () => {
    expect(await users({ headers: {} }).findUsersByEmails([])).toEqual([]);
    expect(axios).not.toHaveBeenCalled();
  });
});

describe('findUserByCpf', () => {
  it('asks for the digits and the formatted CPF and returns the first account', async () => {
    axios.mockResolvedValue({ data: [{ id: 7, email: 'ana@x.io', cpf: '529.982.247-25' }] });
    const out = await users({ headers: {} }).findUserByCpf('52998224725');
    expect(out).toEqual({ id: 7, email: 'ana@x.io', cpf: '529.982.247-25' });
    const url = decodeURIComponent(axios.mock.calls[0][0].url);
    expect(url).toContain('filters[cpf][$in][0]=52998224725');
    expect(url).toContain('filters[cpf][$in][1]=529.982.247-25');
  });

  it('returns null without hitting Strapi for something that is not 11 digits', async () => {
    expect(await users({ headers: {} }).findUserByCpf('123')).toBeNull();
    expect(await users({ headers: {} }).findUserByCpf(null)).toBeNull();
    expect(axios).not.toHaveBeenCalled();
  });

  it('returns null when no account has the CPF', async () => {
    axios.mockResolvedValue({ data: [] });
    expect(await users({ headers: {} }).findUserByCpf('52998224725')).toBeNull();
  });
});
