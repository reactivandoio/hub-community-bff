// E-mail → CPF from an admin spreadsheet onto HubCommunity accounts. The CPF lives on
// the account (the Eventando signup has no field for it), so an e-mail without an
// account gets one — no e-mail sent; the set-password link comes with the signup
// confirmation. A CPF already on the account is never overwritten.
import { cpfDigits } from '../signup-cpf';

const CONCURRENCY = 5;

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

/** Splits the rows into the ones to apply and the ones skipped (INVALID / CONFLICT). */
export const planCpfRows = (rows) => {
  const byEmail = new Map();
  const skipped = [];

  (rows || []).forEach((row) => {
    const email = normalizeEmail(row.email);
    const cpf = cpfDigits(row.cpf);
    if (!email || !cpf) {
      skipped.push({ email: row.email || '', cpf: row.cpf || '', status: 'INVALID' });
      return;
    }
    const entry = byEmail.get(email) || { email, cpfs: new Set(), name: null };
    entry.cpfs.add(cpf);
    entry.name = entry.name || (row.name || '').trim() || null;
    byEmail.set(email, entry);
  });

  const valid = [];
  byEmail.forEach(({ email, cpfs, name }) => {
    if (cpfs.size > 1) {
      skipped.push({ email, cpf: [...cpfs].join(' / '), status: 'CONFLICT' });
    } else {
      valid.push({ email, cpf: [...cpfs][0], name });
    }
  });

  return { valid, skipped };
};

/**
 * Resolves 'SAVED' | 'CREATED' | 'UNCHANGED' | 'DIFFERENT' | 'FAILED'. Never throws.
 * `onError` gets the step and message of a failure, so the admin sees why.
 */
export const applyCpfRow = async (dataSources, { email, cpf, name }, onError = () => {}) => {
  let step = 'buscar conta';
  const integration = dataSources.managerIntegration;
  try {
    let user = await integration.findUserByEmail(email);
    let status = 'SAVED';

    if (!user) {
      step = 'criar conta';
      await integration.accountSetup({ email, name: name || undefined });
      step = 'buscar conta criada';
      user = await integration.findUserByEmail(email);
      if (!user) {
        onError(`${step}: conta não encontrada depois de criada`);
        return 'FAILED';
      }
      status = 'CREATED';
    }

    const current = cpfDigits(user.cpf);
    if (current) return current === cpf ? 'UNCHANGED' : 'DIFFERENT';

    step = 'gravar CPF';
    await integration.updateUser(user.id, { cpf });
    return status;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[cpf-mapping] ${email} (${step}):`, err.message);
    onError(`${step}: ${err.message}`);
    return 'FAILED';
  }
};

export const updateCpfs = async (dataSources, rows) => {
  const { valid, skipped } = planCpfRows(rows);
  const applied = new Map();
  const details = new Map();
  const queue = [...valid];

  const worker = async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      applied.set(row.email, await applyCpfRow(dataSources, row, (d) => details.set(row.email, d)));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, valid.length) }, worker));

  // One item per input row, in the order sent.
  const skippedByEmail = new Map(skipped.map((s) => [normalizeEmail(s.email), s]));
  const items = (rows || []).map((row) => {
    const email = normalizeEmail(row.email);
    const status = applied.get(email)
      || (cpfDigits(row.cpf) && email ? skippedByEmail.get(email)?.status : 'INVALID')
      || 'INVALID';
    return { email: row.email || '', cpf: row.cpf || '', status, detail: details.get(email) || null };
  });

  const count = (status) => items.filter((i) => i.status === status).length;
  return {
    items,
    saved: count('SAVED'),
    created: count('CREATED'),
    unchanged: count('UNCHANGED'),
    different: count('DIFFERENT'),
    skipped: count('INVALID') + count('CONFLICT'),
    failed: count('FAILED'),
  };
};
