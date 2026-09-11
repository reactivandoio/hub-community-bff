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

describe('buildCandidates - orphan certificate dedup (F1)', () => {
  it('produces exactly one candidate when two certificates share an identifier matching no list', () => {
    const certificates = [
      { code: 'RCT-FIRST', identifier: '98765432100', name: 'Diego' },
      { code: 'RCT-SECOND', identifier: '98765432100', name: 'Diego' },
    ];

    const result = buildCandidates({ signups: [], attendances: [], participants: [], certificates });
    const matches = result.filter((c) => c.key === '98765432100');

    expect(matches).toHaveLength(1);
    expect(matches[0].certificate.code).toBe('RCT-FIRST');
  });
});

describe('buildCandidates - bogus identifier certificates (F2)', () => {
  it('does not attach or create an orphan row for a certificate whose identifier has no digits', () => {
    const signups = [{ name: 'Elis', email: 'elis@x.com' }];
    const certificates = [{ code: 'RCT-BOGUS', identifier: 'sem-cpf', name: 'Ninguem' }];

    const result = buildCandidates({ signups, attendances: [], participants: [], certificates });
    const byKey = Object.fromEntries(result.map((c) => [c.key, c]));

    expect(byKey['elis@x.com'].certificate).toBeNull();
    expect(result.find((c) => c.name === 'Ninguem')).toBeUndefined();
  });
});

describe('buildCandidates identity merge', () => {
  it('merges an email-only signup into a CPF-keyed attendance for the same person', () => {
    const attendances = [
      { users_permissions_user: { name: 'Ana Silva', email: 'ana@x.com', cpf: '52998224725' } },
    ];
    const signups = [{ name: 'ana silva', email: 'ANA@x.com', checked_in: true }];

    const result = buildCandidates({ signups, attendances, participants: [], certificates: [] });

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('52998224725');
    expect(result[0].sources).toEqual(['ATTENDANCE', 'SIGNUP']);
    expect(result[0].checked_in).toBe(true);
    expect(result[0].name).toBe('Ana Silva');
  });

  it('re-keys an email-only signup once a later participant row supplies the CPF, and attaches its certificate', () => {
    const signups = [{ name: 'Bruno', email: 'bruno@x.com' }];
    const participants = [{ name: 'Bruno Lima', email: 'bruno@x.com', identifier: '11144477735' }];
    const certificates = [{ code: 'RCT-CCCCCCCC', identifier: '11144477735', name: 'Bruno Lima' }];

    const result = buildCandidates({ signups, attendances: [], participants, certificates });

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('11144477735');
    expect(result[0].identifier).toBe('11144477735');
    expect(result[0].name).toBe('Bruno');
    expect(result[0].sources).toEqual(['SIGNUP', 'REQUEST']);
    expect(result[0].certificate.code).toBe('RCT-CCCCCCCC');
  });

  it('keeps two different CPFs sharing the same email as separate candidates', () => {
    const attendances = [
      { users_permissions_user: { cpf: '52998224725', email: 'shared@x.com', name: 'A' } },
      { users_permissions_user: { cpf: '11144477735', email: 'shared@x.com', name: 'B' } },
    ];

    const result = buildCandidates({ signups: [], attendances, participants: [], certificates: [] });

    expect(result).toHaveLength(2);
  });
});

describe('buildCandidates certificate by e-mail', () => {
  it('attaches an issued certificate to an email-only signup and adopts its CPF, with no orphan row', () => {
    const signups = [{ name: 'Elis', email: 'elis@x.com' }];
    const certificates = [{ code: 'RCT-ELIS', identifier: '52998224725', email: 'elis@x.com', name: 'Elis' }];

    const result = buildCandidates({ signups, attendances: [], participants: [], certificates });

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('elis@x.com');
    expect(result[0].identifier).toBe('52998224725');
    expect(result[0].certificate.code).toBe('RCT-ELIS');
    expect(result.find((c) => c.key === '52998224725')).toBeUndefined();
  });

  it('attaches a certificate to only the matching signup among several by e-mail, with no orphan', () => {
    const signups = [{ name: 'Fabio', email: 'fabio@x.com' }, { name: 'Gina', email: 'gina@x.com' }];
    const certificates = [{ code: 'RCT-GINA', identifier: '39053344705', email: 'gina@x.com', name: 'Gina' }];

    const result = buildCandidates({ signups, attendances: [], participants: [], certificates });
    const byKey = Object.fromEntries(result.map((c) => [c.key, c]));

    expect(byKey['fabio@x.com'].certificate).toBeNull();
    expect(byKey['gina@x.com'].certificate.code).toBe('RCT-GINA');
    expect(result.find((c) => c.key === '39053344705')).toBeUndefined();
  });

  it('lets CPF authority win: a candidate with its own CPF never adopts a different CPF via e-mail match', () => {
    const attendances = [
      { users_permissions_user: { name: 'Helio', email: 'helio@x.com', cpf: '11144477735' } },
    ];
    const certificates = [{ code: 'RCT-WRONG', identifier: '52998224725', email: 'helio@x.com', name: 'Helio' }];

    const result = buildCandidates({ signups: [], attendances, participants: [], certificates });
    const byKey = Object.fromEntries(result.map((c) => [c.key, c]));

    expect(byKey['11144477735'].identifier).toBe('11144477735');
    expect(byKey['11144477735'].certificate).toBeNull();
    expect(byKey['52998224725'].certificate.code).toBe('RCT-WRONG');
  });

  it('attaches by CPF over e-mail regardless of iteration order: an earlier email-only candidate never steals the CPF holder\'s certificate', () => {
    const signups = [{ name: 'Ana', email: 'shared@x.com' }];
    const participants = [{ name: 'Ze', email: 'ze@other.com', identifier: '52998224725' }];
    const certificates = [{ code: 'RCT-X', identifier: '52998224725', email: 'shared@x.com', name: 'Ze' }];

    const result = buildCandidates({ signups, attendances: [], participants, certificates });
    const byKey = Object.fromEntries(result.map((c) => [c.key, c]));

    expect(result).toHaveLength(2);
    expect(byKey['52998224725'].certificate.code).toBe('RCT-X');
    expect(byKey['shared@x.com'].certificate).toBeNull();
    expect(byKey['shared@x.com'].identifier).toBe('');
    expect(result.filter((c) => c.certificate?.code === 'RCT-X')).toHaveLength(1);
  });
});
