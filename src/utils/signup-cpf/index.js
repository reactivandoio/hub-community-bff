// The Eventando signup has no CPF. It lives on the HubCommunity account and, for
// Startup Weekend events, on the `sw-form` — matched by e-mail, the account first.

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

const cpfDigits = (value) => {
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
