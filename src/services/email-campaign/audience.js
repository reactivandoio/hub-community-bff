import { holdsPlace } from '../../utils/payment-status';
import { normalizeEmail } from './token';

// REA-29: who gets each campaign.
// invite: every Hub user who is not blocked, walked by id (campaign.cursor), minus the event's signups.
// share / reminder: the event's signups that hold a place (free, or paid), one per e-mail.
// Everyone in the suppression list (unsubscribed) is left out, and nobody gets a campaign twice.

export const USERS_PAGE = 50;

export const deliveryKey = (campaignDocumentId, email) => `${campaignDocumentId}:${normalizeEmail(email)}`;

/** Signups of the Hub event in Eventando (keyed by slug), or [] when there are none. */
export const loadEventSignups = async (dataSources, eventSlug) => {
  const response = await dataSources.eventandoIntegration.findEvents({
    filters: { or: [{ slug: { eq: eventSlug } }, { uuid: { eq: eventSlug } }] },
  });
  const eventandoEvent = response?.data?.[0];
  if (!eventandoEvent) return [];
  return (await dataSources.eventandoIntegration.findSignupsByEvent(eventandoEvent.id)) || [];
};

/** The signups that hold a place, one per normalized e-mail. */
export const signupRecipients = (signups) => {
  const seen = new Map();
  (signups || []).filter(holdsPlace).forEach((signup) => {
    const email = normalizeEmail(signup.email);
    if (email && !seen.has(email)) seen.set(email, { email, name: signup.name || '' });
  });
  return [...seen.values()];
};

/**
 * The next people to consider, in order. `cursor` (invite only) is the user id to resume from.
 * `exhausted` says there is nobody after them.
 */
export const loadCandidates = async ({ dataSources, campaign, signups }) => {
  if (campaign.type === 'invite') {
    const users = await dataSources.managerIntegration.findUsersAfterId(campaign.cursor || 0, USERS_PAGE);
    const candidates = users.map((user) => ({
      email: user.blocked ? '' : normalizeEmail(user.email),
      name: user.name || user.username || '',
      cursor: user.id,
    }));
    return { candidates, exhausted: users.length < USERS_PAGE };
  }
  return { candidates: signupRecipients(signups), exhausted: true };
};

/**
 * Marks why a candidate is not sent: blocked/without e-mail, unsubscribed, already a signup
 * (invite), or already sent by this campaign.
 */
export const screenCandidates = async ({ dataSources, campaign, candidates, signups }) => {
  const emails = candidates.map((c) => c.email).filter(Boolean);
  const integration = dataSources.managerIntegration;
  const [suppressed, deliveries] = await Promise.all([
    emails.length ? integration.findSuppressedEmails(emails) : new Set(),
    emails.length ? integration.findEmailDeliveriesByKeys(emails.map((e) => deliveryKey(campaign.documentId, e))) : [],
  ]);
  const delivered = new Set(deliveries.map((d) => normalizeEmail(d.email)));
  const signedUp = campaign.type === 'invite'
    ? new Set(signupRecipients(signups).map((s) => s.email))
    : new Set();
  const suppressedSet = new Set([...suppressed].map(normalizeEmail));

  return candidates.map((candidate) => {
    let skip = null;
    if (!candidate.email || !candidate.email.includes('@')) skip = 'no-email';
    else if (suppressedSet.has(candidate.email)) skip = 'unsubscribed';
    else if (delivered.has(candidate.email)) skip = 'delivered';
    else if (signedUp.has(candidate.email)) skip = 'signed-up';
    return { ...candidate, skip };
  });
};

/**
 * How many people a new campaign reaches. Exact for signups; for the whole base it is the
 * reachable users minus the suppression list, so `approximate`.
 */
export const countAudience = async ({ dataSources, eventSlug, type }) => {
  const integration = dataSources.managerIntegration;
  if (type === 'invite') {
    const [users, suppressions] = await Promise.all([
      integration.countReachableUsers(),
      integration.countEmailSuppressions(),
    ]);
    return { total: Math.max(0, users - suppressions), approximate: true };
  }
  const recipients = signupRecipients(await loadEventSignups(dataSources, eventSlug));
  const suppressed = recipients.length
    ? await integration.findSuppressedEmails(recipients.map((r) => r.email))
    : new Set();
  return { total: recipients.filter((r) => !suppressed.has(r.email)).length, approximate: false };
};
