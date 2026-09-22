// The Eventando signup has no CPF. It lives on the HubCommunity account and, for
// Startup Weekend events, on the `sw-form` — matched by e-mail, the account first.

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

export const cpfDigits = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
};

const cpfByEmail = (rows) => {
  const map = new Map();
  (rows || []).forEach((row) => {
    const cpf = cpfDigits(row?.cpf);
    const email = normalizeEmail(row?.email);
    if (cpf && email && !map.has(email)) map.set(email, cpf);
  });
  return map;
};

/** Never mutates the input. */
export const withCpf = (signups, users, swForms) => {
  const fromUsers = cpfByEmail(users);
  const fromSwForms = cpfByEmail(swForms);
  return signups.map((signup) => {
    const email = normalizeEmail(signup.email);
    return { ...signup, cpf: fromUsers.get(email) || fromSwForms.get(email) || null };
  });
};

/**
 * Puts the CPF read from a spreadsheet import or typed at the door on the
 * HubCommunity account, unless the account already has one. Never throws.
 * Resolves 'saved' | 'kept' | 'no-account' | 'invalid' | 'failed'.
 */
export const saveMissingCpf = async (dataSources, email, cpf) => {
  const normalized = normalizeEmail(email);
  const digits = cpfDigits(cpf);
  if (!normalized || !digits) return 'invalid';

  try {
    const user = await dataSources.managerIntegration.findUserByEmail(normalized);
    if (!user) return 'no-account';
    if (cpfDigits(user.cpf)) return 'kept';
    await dataSources.managerIntegration.updateUser(user.id, { cpf: digits });
    return 'saved';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[signup-cpf] could not save the CPF of ${normalized}:`, err.message);
    return 'failed';
  }
};
