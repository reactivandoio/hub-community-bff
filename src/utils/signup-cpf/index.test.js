import { describe, it, expect } from 'vitest';
import { withCpf } from './index';

describe('withCpf', () => {
  const signups = [
    { name: 'Ana', email: 'Ana@X.io' },
    { name: 'Bia', email: 'bia@x.io' },
    { name: 'Caio', email: 'caio@x.io' },
    { name: 'Sem email', email: null },
  ];

  it('takes the CPF from the account, then from the Startup Weekend form, by e-mail', () => {
    const result = withCpf(
      signups,
      [{ email: 'ana@x.io', cpf: '123.456.789-09' }, { email: 'bia@x.io', cpf: null }],
      [{ email: 'BIA@x.io', cpf: '98765432100' }, { email: 'ana@x.io', cpf: '11111111111' }],
    );

    expect(result.map((s) => s.cpf)).toEqual(['12345678909', '98765432100', null, null]);
  });

  it('keeps only the digits and drops values that are not 11 digits', () => {
    const result = withCpf(
      [{ email: 'a@x.io' }, { email: 'b@x.io' }],
      [{ email: 'a@x.io', cpf: '071.234.567-8' }, { email: 'b@x.io', cpf: '071.234.567-89' }],
      [],
    );

    expect(result.map((s) => s.cpf)).toEqual([null, '07123456789']);
  });

  it('never mutates the signups', () => {
    const input = [{ email: 'ana@x.io' }];
    withCpf(input, [{ email: 'ana@x.io', cpf: '12345678909' }], []);
    expect(input[0]).toEqual({ email: 'ana@x.io' });
  });
});
