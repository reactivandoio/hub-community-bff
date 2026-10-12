// REA-22: the only part of another account the guest signup ever shows — the format
// Pedro asked for, glad.pedro@gmail.com → glad****@***ail.com. Up to 4 characters of
// the local part (never more than half of it), up to 3 of the domain name (always
// hiding at least 2) and the public suffix (.com, .com.br).
const SUFFIX = /(\.(?:com|net|org|gov|edu|io|co)\.[a-z]{2}|\.[a-z]{2,})$/i;

export const maskEmail = (email) => {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return '****';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const suffix = (domain.match(SUFFIX) || [''])[0];
  const name = domain.slice(0, domain.length - suffix.length);
  const keepLocal = Math.min(4, Math.floor(local.length / 2));
  const keepName = Math.max(0, Math.min(3, name.length - 2));
  return `${local.slice(0, keepLocal)}****@***${name.slice(name.length - keepName)}${suffix}`;
};

export default maskEmail;
