/**
 * Check-in numbers for the event analytics page. Days and hours are São Paulo
 * calendar time: a signup at 23:00 on the event night belongs to the event day
 * even though it is already the next day in UTC.
 */
const TIME_ZONE = 'America/Sao_Paulo';
const ORIGINS = ['SITE', 'MANUAL', 'IMPORT'];

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

const localParts = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour };
};

// importSignups and manualSignup tag the zero-value payment they create;
// everything else came through the public signup (site or ticket QR).
export const signupOrigin = (signup) => {
  const id = signup?.payment?.payment_identification || '';
  if (id.startsWith('IMPORT_')) return 'IMPORT';
  if (id.startsWith('MANUAL_')) return 'MANUAL';
  return 'SITE';
};

export const eventDays = (startDate, endDate) => {
  const start = startDate && localParts(startDate);
  if (!start) return [];
  const end = (endDate && localParts(endDate)) || start;

  const days = [];
  const cursor = new Date(`${start.day}T12:00:00Z`);
  const last = new Date(`${end.day}T12:00:00Z`);
  while (cursor <= last && days.length < 31) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

export const checkinMetrics = (signups, days) => {
  const eventDaySet = new Set(days);
  const byOrigin = Object.fromEntries(ORIGINS.map((o) => [o, { total: 0, checked_in: 0, day_of: 0 }]));
  const perHour = {};
  let checkedIn = 0;
  let dayOf = 0;

  signups.forEach((signup) => {
    const origin = byOrigin[signupOrigin(signup)];
    origin.total++;

    const created = localParts(signup.createdAt || signup.created_at);
    if (created && eventDaySet.has(created.day)) {
      dayOf++;
      origin.day_of++;
    }

    if (signup.checked_in) {
      checkedIn++;
      origin.checked_in++;
      const at = signup.checked_in_at && localParts(signup.checked_in_at);
      if (at) {
        const key = `${at.day}T${at.hour}:00`;
        perHour[key] = (perHour[key] || 0) + 1;
      }
    }
  });

  return {
    checked_in_count: checkedIn,
    attendance_rate: signups.length
      ? Math.round((checkedIn / signups.length) * 10000) / 100
      : null,
    day_of_signups: dayOf,
    day_of_signups_by_origin: ORIGINS.map((o) => ({ origin: o, count: byOrigin[o].day_of })),
    signups_by_origin: ORIGINS.map((o) => ({
      origin: o,
      total: byOrigin[o].total,
      checked_in: byOrigin[o].checked_in,
    })),
    checkins_timeline: Object.entries(perHour)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
  };
};
