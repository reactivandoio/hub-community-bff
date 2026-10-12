import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { verifyOpaSignature } from './signature';

const secret = 'whsec_test';
const body = Buffer.from('{"id":"e1", "type":"charge.paid","nome":"João"}');
const sign = (t, b = body) => crypto.createHmac('sha256', secret).update(`${t}.${b}`).digest('hex');

describe('verifyOpaSignature', () => {
  it('aceita assinatura válida', () => {
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${sign(1000)}`, secret, nowS: 1100 }).ok).toBe(true);
  });
  it('aceita quando um dos vários v1 confere', () => {
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${'0'.repeat(64)},v1=${sign(1000)}`, secret, nowS: 1000 }).ok).toBe(true);
  });
  it('aceita espaços depois das vírgulas', () => {
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000, v1=${sign(1000)}`, secret, nowS: 1000 }).ok).toBe(true);
  });
  it('recusa corpo adulterado', () => {
    expect(verifyOpaSignature({ rawBody: Buffer.from('{}'), header: `t=1000,v1=${sign(1000)}`, secret, nowS: 1000 }).reason).toBe('mismatch');
  });
  it('recusa corpo reserializado (o mesmo JSON sem os espaços originais)', () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body.toString())));
    expect(verifyOpaSignature({ rawBody: reserialized, header: `t=1000,v1=${sign(1000)}`, secret, nowS: 1000 }).reason).toBe('mismatch');
  });
  it('recusa assinatura com outro segredo', () => {
    const other = crypto.createHmac('sha256', 'whsec_outro').update(`1000.${body}`).digest('hex');
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${other}`, secret, nowS: 1000 }).reason).toBe('mismatch');
  });
  it('recusa timestamp fora de 300 s, para trás e para a frente', () => {
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${sign(1000)}`, secret, nowS: 1301 }).reason).toBe('stale');
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${sign(1000)}`, secret, nowS: 699 }).reason).toBe('stale');
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${sign(1000)}`, secret, nowS: 1300 }).ok).toBe(true);
  });
  it('recusa header ausente ou malformado', () => {
    expect(verifyOpaSignature({ rawBody: body, header: undefined, secret, nowS: 1000 }).reason).toBe('missing');
    expect(verifyOpaSignature({ rawBody: body, header: 'v1=abc', secret, nowS: 1000 }).reason).toBe('malformed');
    expect(verifyOpaSignature({ rawBody: body, header: `t=abc,v1=${sign(1000)}`, secret, nowS: 1000 }).reason).toBe('malformed');
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${sign(1000).toUpperCase()}`, secret, nowS: 1000 }).reason).toBe('malformed');
  });
  it('recusa quando não há segredo configurado', () => {
    expect(verifyOpaSignature({ rawBody: body, header: `t=1000,v1=${sign(1000)}`, secret: '', nowS: 1000 }).reason).toBe('missing');
  });
});
