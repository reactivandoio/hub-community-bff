// Pure eligibility rules for certificate self-service. No I/O here.

export const normalizeIdentifier = (value) => (value || '').replace(/\D/g, '');

export const isValidCpf = (value) => {
  const cpf = normalizeIdentifier(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (slice, factor) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i += 1) sum += Number(slice[i]) * (factor - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(cpf.slice(0, 9), 10) === Number(cpf[9]) && digit(cpf.slice(0, 10), 11) === Number(cpf[10]);
};

export const hasEventEnded = (event, now = new Date()) => {
  if (!event?.end_date) return false;
  return new Date(event.end_date) <= now;
};

export const REVOKED_MESSAGE = 'Este certificado foi revogado. Fale com a organização do evento.';

export const SELF_REQUEST_MESSAGES = {
  DISABLED: 'Os certificados deste evento ainda não estão disponíveis.',
  NOT_ALLOWED: 'Este evento não aceita solicitação livre de certificado. Fale com a organização.',
  NOT_ENDED: 'O certificado estará disponível após o término do evento.',
};

export const selfRequestStatus = (config, event, now = new Date()) => {
  const fail = (reason) => ({ ok: false, reason, message: SELF_REQUEST_MESSAGES[reason] });
  if (!config || !config.enabled) return fail('DISABLED');
  if (config.allow_self_request === false) return fail('NOT_ALLOWED');
  if (!hasEventEnded(event, now)) return fail('NOT_ENDED');
  return { ok: true };
};

export const findAttendanceForIdentifier = (attendances, identifier) => {
  const wanted = normalizeIdentifier(identifier);
  if (!wanted) return null;
  return (
    (attendances || []).find(
      (a) => normalizeIdentifier(a?.users_permissions_user?.cpf) === wanted,
    ) || null
  );
};
