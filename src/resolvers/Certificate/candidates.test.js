import { describe, it, expect } from 'vitest';
import { buildCandidates, candidateKey } from './candidates';

describe('candidateKey', () => {
  it('prefers cpf, falls back to email, else null', () => {
    expect(candidateKey({ identifier: '529.982.247-25', email: 'A@x.com' })).toBe('52998224725');
    expect(candidateKey({ identifier: '', email: ' A@X.com ' })).toBe('a@x.com');
    expect(candidateKey({})).toBeNull();
  });
});

describe('buildCandidates', () => {
  const signups = [
    { name: 'ana silva', email: 'ana@x.com', phone_number: '62999990000', cpf: '52998224725', checked_in: true },
    { name: 'Bruno', email: 'bruno@x.com', phone_number: null, checked_in: false },
    { name: 'Sem chave', email: '', cpf: '' },
  ];
  const attendances = [
    { users_permissions_user: { name: 'Ana Silva', email: 'ana.pessoal@x.com', phone: '62988880000', cpf: '529.982.247-25' } },
    { users_permissions_user: null },
  ];
  const participants = [
    { name: 'Carla', email: 'carla@x.com', identifier: '11144477735', phone_number: '62977770000' },
    { name: 'Bruno Lima', email: 'BRUNO@x.com', identifier: '', phone_number: '62966660000' },
  ];
  const certificates = [
    { code: 'RCT-AAAAAAAA', identifier: '11144477735', name: 'Carla' },
    { code: 'RCT-BBBBBBBB', identifier: '98765432100', name: 'Diego', email: 'diego@x.com', source: 'SELF_REQUEST' },
  ];

  const result = buildCandidates({ signups, attendances, participants, certificates });
  const byKey = Object.fromEntries(result.map((c) => [c.key, c]));

  it('dedupes by cpf and lets attendance data win', () => {
    const ana = byKey['52998224725'];
    expect(ana.sources).toEqual(['ATTENDANCE', 'SIGNUP']);
    expect(ana.name).toBe('Ana Silva');
    expect(ana.email).toBe('ana.pessoal@x.com');
    expect(ana.phone).toBe('62988880000');
    expect(ana.checked_in).toBe(true);
    expect(ana.certificate).toBeNull();
  });

  it('dedupes by email when there is no cpf and keeps the best name', () => {
    const bruno = byKey['bruno@x.com'];
    expect(bruno.sources).toEqual(['SIGNUP', 'REQUEST']);
    expect(bruno.name).toBe('Bruno');
    expect(bruno.identifier).toBe('');
    expect(bruno.phone).toBe('62966660000'); // signup had none, request fills the gap
    expect(bruno.checked_in).toBe(false);
  });

  it('drops rows without cpf or email', () => {
    expect(result.find((c) => c.name === 'Sem chave')).toBeUndefined();
  });

  it('attaches issued certificates by identifier', () => {
    expect(byKey['11144477735'].certificate.code).toBe('RCT-AAAAAAAA');
    expect(byKey['11144477735'].sources).toEqual(['REQUEST']);
  });

  it('includes certificates whose person is in no list', () => {
    const diego = byKey['98765432100'];
    expect(diego.sources).toEqual([]);
    expect(diego.name).toBe('Diego');
    expect(diego.certificate.code).toBe('RCT-BBBBBBBB');
  });

  it('sorts by name, case-insensitive', () => {
    expect(result.map((c) => c.name)).toEqual(['Ana Silva', 'Bruno', 'Carla', 'Diego']);
  });
});
