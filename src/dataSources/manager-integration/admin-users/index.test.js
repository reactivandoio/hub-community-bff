import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import adminUsers from './index';

vi.mock('axios');
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('../../../utils/network/manager', () => ({ default: { fetch: fetchMock, buildQuery: vi.fn() } }));

beforeEach(() => {
  process.env.MANAGER_URL = 'http://strapi';
  axios.get = vi.fn().mockResolvedValue({ data: 3 });
});

const urlOf = () => decodeURIComponent(axios.get.mock.calls[0][0]);

describe('admin users counts', () => {
  it('sends the /users/count filters bare (the plugin uses the query as `where`)', async () => {
    const ds = adminUsers({ headers: { Authorization: 'Bearer t' } });
    expect(await ds.adminCountUsers({ search: 'ana', roleType: 'admin' })).toBe(3);
    expect(urlOf()).toBe('http://strapi/api/users/count?$or[0][username][$containsi]=ana'
      + '&$or[1][email][$containsi]=ana&$or[2][name][$containsi]=ana&role[type][$eq]=admin');
  });

  it('counts the admins who can sign in', async () => {
    await adminUsers({ headers: {} }).adminCountActiveAdmins();
    expect(urlOf()).toBe('http://strapi/api/users/count?role[type][$eq]=admin'
      + '&$or[0][blocked][$eq]=false&$or[1][blocked][$null]=true');
  });
});

describe('admin users list', () => {
  it('pages with start/limit (the plugin ignores pagination[...])', async () => {
    fetchMock.mockResolvedValue({ data: [] });
    await adminUsers({ headers: {} }).adminFindUsers({ search: '', roleType: null, page: 3, pageSize: 20 });
    const url = decodeURIComponent(fetchMock.mock.calls[0][0]);
    expect(url).toContain('start=40&limit=20');
    expect(url).not.toContain('pagination');
  });
});
