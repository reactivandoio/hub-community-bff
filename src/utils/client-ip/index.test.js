import { describe, it, expect } from 'vitest';
import { clientIpOf } from '.';

describe('clientIpOf', () => {
  it('prefere o cabeçalho do Cloudflare, depois os do proxy, depois o socket', () => {
    expect(clientIpOf({ headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' } })).toBe('1.1.1.1');
    expect(clientIpOf({ headers: { 'x-real-ip': '3.3.3.3' } })).toBe('3.3.3.3');
    expect(clientIpOf({ headers: { 'x-forwarded-for': '4.4.4.4, 10.0.0.1' } })).toBe('4.4.4.4');
    expect(clientIpOf({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
    expect(clientIpOf(undefined)).toBe('unknown');
  });
});
