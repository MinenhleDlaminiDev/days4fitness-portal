// Integration fixtures must not hardcode calendar dates. The booking rules
// reject anything in the past, so a fixed date is a time bomb: the test passes
// until the wall clock moves past it, then fails forever. Everything here is
// derived from today instead, so the suite keeps passing as time goes on.

import { env } from "../../src/config/env.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Today on the business clock, as a UTC-midnight Date so the arithmetic below
 * stays zone-free.
 *
 * SCH-04: this used to read the machine's local calendar components. The
 * queries read the day from the business timezone, so between midnight and
 * 02:00 SAST a fixture built here and the query it was written for could
 * disagree about what day it was -- which is how that defect surfaced as a
 * test failure rather than a support ticket. Both sides now read one clock.
 */
function todayInBusinessZone() {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.businessTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** An ISO date `offset` days from today. Negative values are in the past. */
export function daysFromToday(offset) {
  return iso(new Date(todayInBusinessZone().getTime() + offset * DAY_MS));
}

/**
 * The first Monday at least `minDaysAhead` days from today. Use it to anchor a
 * block of fixtures so their weekdays stay fixed: sessions are only allowed
 * Monday to Saturday, so an anchor that drifts across weekdays breaks them.
 */
export function upcomingMonday(minDaysAhead = 7) {
  const date = new Date(todayInBusinessZone().getTime() + minDaysAhead * DAY_MS);
  while (date.getUTCDay() !== 1) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return iso(date);
}

/** Sessions are allowed Monday to Saturday only (sessions_training_day_check). */
export function isTrainingDay(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() !== 0;
}

/** An ISO date `offset` days from `isoDate`. */
export function addDays(isoDate, offset) {
  return iso(new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + offset * DAY_MS));
}

/**
 * An ISO date `months` months from `isoDate`, clamped to the end of the target
 * month the way Postgres does. Packages are constrained to an exact two-month
 * expiry (packages_exact_two_month_expiry_check), so an expiry date has to be
 * computed this way rather than as a number of days.
 */
export function addMonths(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDayOfMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDayOfMonth));
  return iso(target);
}
