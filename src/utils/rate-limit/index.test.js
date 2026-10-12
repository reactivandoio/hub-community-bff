import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '.';

describe('createRateLimiter', () => {
  it('aceita até o limite na janela e recusa depois; a janela nova recomeça', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(true);
    expect(limiter.hit('a')).toBe(false);
    expect(limiter.hit('b')).toBe(true);
    t = 1000;
    expect(limiter.hit('a')).toBe(true);
  });

  it('limpa as chaves vencidas quando chega ao máximo', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 10, now: () => t, maxKeys: 2 });
    limiter.hit('a');
    limiter.hit('b');
    t = 20;
    limiter.hit('c');
    expect(limiter.size()).toBe(1);
  });
});
