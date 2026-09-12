// Signup names as they should be shown: the HubCommunity profile name wins over the
// name stored on the Eventando Manager signup. Signups made from the event page while
// logged in used to be created with the username, and both the badge printer and the
// analytics CSV print the signup name — so the profile is the source of truth whenever
// the account has one.

const normalizeEmail = (email) => (email || '').trim().toLowerCase();

/** Never mutates the input. */
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

/**
 * HubCommunity users for these e-mails. A failure here must not break the caller —
 * fall back to the names stored on the signups.
 */
export const resolveUsers = async (dataSources, emails) => {
  try {
    return await dataSources.managerIntegration.findUsersByEmails(emails);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[signup-names] could not resolve user names:', err.message);
    return [];
  }
};
