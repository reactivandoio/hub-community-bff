// Eventando Manager signup → EventSignup GraphQL type.
export const mapSignup = (signup) => ({
  id: String(signup.documentId || signup.id),
  name: signup.name || '',
  email: signup.email || '',
  phone_number: signup.phone_number || '',
  checked_in: signup.checked_in || false,
  checked_in_at: signup.checked_in_at || null,
  product_name: signup.payment?.batch?.product?.name || null,
});

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

/**
 * Prefer the HubCommunity user's name (matched by e-mail) over the one stored on the
 * signup. Signups made from the event page while logged in used to be created with the
 * username, and the badge printer prints the signup name — so the profile name is the
 * source of truth whenever it exists. Never mutates the input.
 */
export const withUserNames = (signups, users) => {
  const names = new Map();
  (users || []).forEach((user) => {
    const name = (user?.name || '').trim();
    if (name) names.set(normalizeEmail(user.email), name);
  });
  return signups.map((signup) => {
    const name = names.get(normalizeEmail(signup.email));
    return name ? { ...signup, name } : { ...signup };
  });
};
