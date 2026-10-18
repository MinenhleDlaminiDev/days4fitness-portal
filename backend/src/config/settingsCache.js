// The business rules the trainer owns now live in the database, but they are
// read on every booking validation and written only from the settings screen.
// This holds one in-memory snapshot so the hot path stays synchronous, exactly
// as it was when these were module constants.
//
// The defaults below are the values that were hardcoded in businessRules.js.
// They are what the cache serves until refresh() runs, so anything that never
// refreshes (unit tests, a failed boot read) behaves as it always did.

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

function hourlySlots(fromHour, toHour) {
  return Array.from({ length: toHour - fromHour + 1 }, (_, index) =>
    `${String(fromHour + index).padStart(2, "0")}:00`
  );
}

const DEFAULTS = Object.freeze({
  packageSizes: [1, 4, 8, 12, 16],
  businessHours: [
    { day: "Monday", timeSlots: hourlySlots(5, 19) },
    { day: "Tuesday", timeSlots: hourlySlots(5, 19) },
    { day: "Wednesday", timeSlots: hourlySlots(5, 19) },
    { day: "Thursday", timeSlots: hourlySlots(5, 19) },
    { day: "Friday", timeSlots: hourlySlots(5, 19) },
    { day: "Saturday", timeSlots: hourlySlots(5, 10) }
  ],
  groupCapacity: 8,
  sessionDurationMinutes: 60,
  packageExpiryMonths: 2
});

let snapshot = DEFAULTS;

export function getSettings() {
  return snapshot;
}

export function setSettings(next) {
  snapshot = Object.freeze({ ...DEFAULTS, ...next });
  return snapshot;
}

export function resetSettings() {
  snapshot = DEFAULTS;
  return snapshot;
}

/** Groups `[{ day_of_week, start_time }]` rows into the shape the API returns. */
export function groupBusinessHours(rows) {
  const byDay = new Map();
  for (const row of rows) {
    const day = DAY_NAMES[row.day_of_week];
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(row.start_time);
  }
  return [...byDay.entries()]
    .map(([day, timeSlots]) => ({ day, timeSlots }))
    .sort((a, b) => DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day));
}

export function timeSlotsForDay(day) {
  return snapshot.businessHours.find((item) => item.day === day)?.timeSlots || [];
}
