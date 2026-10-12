import axios from 'axios';
import { describe, it, expect, vi } from 'vitest';
import signup from './eventando-manager/signup';
import accountSetup from './manager-integration/account-setup';

vi.mock('axios', () => ({ default: vi.fn() }));
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('datasources do REA-22', () => {
  it('findSignupHolder lê { holder } do Eventando e manda CPF e e-mails no corpo', async () => {
    axios.mockResolvedValueOnce({ data: { holder: { signup_id: 7, email: 'a@x.io', payment_status: 'CONFIRMED', value: 0 } } });
    const holder = await signup({ headers: {} }).findSignupHolder(42, { cpf: '52998224725', emails: ['a@x.io'] });
    expect(holder).toMatchObject({ signup_id: 7, email: 'a@x.io' });
    expect(axios).toHaveBeenLastCalledWith(expect.objectContaining({
      method: 'POST', url: expect.stringMatching(/\/api\/signup-holder\/42$/), data: { cpf: '52998224725', emails: ['a@x.io'] },
    }));
    axios.mockResolvedValueOnce({ data: { holder: null } });
    expect(await signup({ headers: {} }).findSignupHolder(42, { cpf: '52998224725', emails: [] })).toBeNull();
  });

  it('accountStatus lê { accounts } do manager', async () => {
    axios.mockResolvedValueOnce({ data: { accounts: [{ email: 'a@x.io', pending: true }] } });
    expect(await accountSetup({ headers: {} }).accountStatus(['a@x.io'])).toEqual([{ email: 'a@x.io', pending: true }]);
  });
});
