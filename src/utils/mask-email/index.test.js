import { describe, it, expect } from 'vitest';
import { maskEmail } from '.';

describe('maskEmail', () => {
  it('segue o formato pedido: glad****@***ail.com', () => {
    expect(maskEmail('glad.pedro@gmail.com')).toBe('glad****@***ail.com');
    expect(maskEmail('Glad.Pedro@GMAIL.com')).toBe('glad****@***ail.com');
    expect(maskEmail('pedro.paulods@hotmail.com')).toBe('pedr****@***ail.com');
  });

  it('esconde ao menos metade do usuário e 2 letras do domínio', () => {
    expect(maskEmail('ana@uol.com.br')).toBe('a****@***l.com.br');
    expect(maskEmail('jo@x.io')).toBe('j****@***.io');
    expect(maskEmail('a@empresa.com.br')).toBe('****@***esa.com.br');
  });

  it('valor estranho vira só asteriscos', () => {
    expect(maskEmail('')).toBe('****');
    expect(maskEmail('sem-arroba')).toBe('****');
    expect(maskEmail(null)).toBe('****');
  });
});
