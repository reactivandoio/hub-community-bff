import { describe, it, expect, vi } from 'vitest';
import Attendance from './index';

const ctx = (user = { id: 9, documentId: 'u9' }) => ({
  user,
  dataSources: {
    managerAuthenticated: { updateUser: vi.fn().mockResolvedValue({}) },
    managerIntegration: { createAttendance: vi.fn().mockResolvedValue({}) },
  },
});

const args = (extra = {}) => ({
  eventDocumentId: 'ev', cpf: '52998224725', date_of_birth: '1990-01-01', phone: '62999', name: 'Ana', adult_declaration: true, ...extra,
});

const run = (c, extra) => Attendance.Mutation.createAttendance(null, args(extra), c);

describe('createAttendance (REA-36)', () => {
  it('records the attendance, the date of birth and the 18+ declaration', async () => {
    const c = ctx();
    expect(await run(c)).toMatchObject({ success: true });
    expect(c.dataSources.managerAuthenticated.updateUser).toHaveBeenCalledWith(9, expect.objectContaining({
      date_of_birth: '1990-01-01', adult_declaration: true,
    }));
  });

  it('refuses without the declaration', async () => {
    const c = ctx();
    expect(await run(c, { adult_declaration: false })).toMatchObject({ success: false, message: 'Confirme que você tem 18 anos ou mais.' });
    expect(c.dataSources.managerIntegration.createAttendance).not.toHaveBeenCalled();
  });

  it('refuses an invalid date (it used to pass) and a minor', async () => {
    const c = ctx();
    expect(await run(c, { date_of_birth: 'abc' })).toMatchObject({ success: false, message: 'Informe uma data de nascimento válida.' });
    expect(await run(c, { date_of_birth: '2015-01-01' })).toMatchObject({ success: false });
    expect(c.dataSources.managerIntegration.createAttendance).not.toHaveBeenCalled();
  });
});
