// Same id `eventSignups` exposes (see resolvers/Checkin/mappers.js), so the
// ticket QR the web renders — and the one in the confirmation e-mail — matches
// the check-in cache on the devices.
export const signupIdOf = (signup) => {
  const id = signup?.documentId || signup?.id;
  return id ? String(id) : null;
};

export default signupIdOf;
