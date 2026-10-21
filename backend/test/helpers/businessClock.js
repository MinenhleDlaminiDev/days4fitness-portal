// `sessions_start_time_check` only allows start_time from 05:00 up to 20:00.
// A test that places a session "half an hour ago" or "three hours from now"
// therefore only works while the business clock reads mid-trading-day: run it
// at 18:30 and now + 3 hours is 21:30, which the constraint rejects outright.
//
// Skipping in the evening would be worse than failing, because the test would
// quietly stop covering anything. Instead the test chooses its own business
// timezone: the sessions repository takes `businessTimezone` as an option and
// compares against it, so a fixed-offset zone whose local clock reads midday
// makes the fixture legal whatever time the suite is actually run.
//
// Etc/GMT zones are used because they never observe DST. Their sign is
// inverted by the POSIX convention they inherit: `Etc/GMT-3` is UTC+3.

/** A timezone whose current local hour is `targetHour`, for fixture timing. */
export function timezoneWhereLocalHourIs(targetHour = 12) {
  const offset = targetHour - new Date().getUTCHours();
  if (offset === 0) return "UTC";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Today's ISO date in `timezone`, which may differ from the machine's date. */
export async function businessToday(db, timezone) {
  const result = await db.query(
    "SELECT (CURRENT_TIMESTAMP AT TIME ZONE $1)::date::text AS today",
    [timezone]
  );
  return result.rows[0].today;
}
