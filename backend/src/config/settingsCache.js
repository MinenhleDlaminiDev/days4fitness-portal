// The business rules a trainer owns live in the database, and since AUTH-05
// they belong to one trainer rather than to the business. That ended the one
// frozen snapshot this module used to hold: there is no longer "the"
// configuration to cache.
//
// What replaced it: one entry per trainer, filled on first read and dropped
// when that trainer saves. Reads are async now. The old snapshot existed only
// to keep booking validation synchronous, and that turned out to buy nothing —
// every caller was already inside an async request handler.
//
// A cache is built on a repository, the same way the services are, so a test
// can point one at its own database. The default instance below reads through
// the shared pool and is what the services use in production.
//
// The defaults are the values that were hardcoded in businessRules.js.
// Migration 023 seeds them for every trainer, including new ones, so a read
// normally finds rows; they are kept as the shape of a snapshot and for unit
// tests that run with no database at all.

import { configurationRepository } from "../repositories/configuration.repository.js";

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

export const DEFAULTS = Object.freeze({
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

function requireTrainerId(trainerId) {
  if (trainerId === undefined || trainerId === null) {
    throw new Error(
      "Settings are per trainer. Pass the id of the trainer whose settings these are, " +
        "which is the owner of the record being worked on, not the caller's ownership scope."
    );
  }
  return Number(trainerId);
}

export function createSettingsCache(repository = configurationRepository) {
  const entries = new Map();

  async function loadFromDatabase(trainerId) {
    const [packageSizes, businessHourRows, schedulingSettings] = await Promise.all([
      repository.listPackageSizes(trainerId),
      repository.listBusinessHours(trainerId),
      repository.getSchedulingSettings(trainerId)
    ]);
    const businessHours = groupBusinessHours(businessHourRows);
    return {
      // Per trainer since AUTH-10, like everything else here. Nothing in this
      // snapshot is shared between trainers.
      packageSizes: packageSizes.length > 0 ? packageSizes : DEFAULTS.packageSizes,
      businessHours: businessHours.length > 0 ? businessHours : DEFAULTS.businessHours,
      groupCapacity: schedulingSettings?.group_capacity ?? DEFAULTS.groupCapacity,
      sessionDurationMinutes:
        schedulingSettings?.session_duration_minutes ?? DEFAULTS.sessionDurationMinutes,
      packageExpiryMonths:
        schedulingSettings?.package_expiry_months ?? DEFAULTS.packageExpiryMonths
    };
  }

  let loader = loadFromDatabase;

  return {
    /** Replaces the database read. For unit tests that have no database. */
    configureLoader(next) {
      loader = next || loadFromDatabase;
      entries.clear();
    },

    /**
     * One trainer's settings. Reads the database on a cold entry.
     *
     * The in-flight promise is cached so concurrent bookings share one read,
     * and **is removed if it rejects**: a stored rejection would turn one
     * failed read into a permanently broken trainer until the process
     * restarted, which is what AUTH-01 had to fix in the trainer bootstrap.
     */
    async getSettings(trainerId) {
      const id = requireTrainerId(trainerId);
      const cached = entries.get(id);
      if (cached) return cached;

      const pending = loader(id).then((settings) => {
        const frozen = Object.freeze({ ...DEFAULTS, ...settings });
        entries.set(id, Promise.resolve(frozen));
        return frozen;
      });
      entries.set(id, pending);
      pending.catch(() => {
        if (entries.get(id) === pending) entries.delete(id);
      });
      return pending;
    },

    /** Puts one trainer's settings in the cache without a read. */
    setSettings(trainerId, next) {
      const id = requireTrainerId(trainerId);
      const frozen = Object.freeze({ ...DEFAULTS, ...next });
      entries.set(id, Promise.resolve(frozen));
      return frozen;
    },

    /** Drops one trainer's entry, or every entry when called with no id. */
    invalidateSettings(trainerId) {
      if (trainerId === undefined || trainerId === null) {
        entries.clear();
        return;
      }
      entries.delete(Number(trainerId));
    },

    /** Empties the cache. Tests share one process, so they need this. */
    resetSettings() {
      entries.clear();
      return DEFAULTS;
    },

    /** The slots one trainer can be booked in on a given day. */
    async timeSlotsForDay(trainerId, day) {
      const settings = await this.getSettings(trainerId);
      return settings.businessHours.find((item) => item.day === day)?.timeSlots || [];
    }
  };
}

/** What the services use unless a test hands them another. */
export const settingsCache = createSettingsCache();

export const getSettings = (trainerId) => settingsCache.getSettings(trainerId);
export const setSettings = (trainerId, next) => settingsCache.setSettings(trainerId, next);
export const invalidateSettings = (trainerId) => settingsCache.invalidateSettings(trainerId);
export const resetSettings = () => settingsCache.resetSettings();
export const configureSettingsLoader = (next) => settingsCache.configureLoader(next);
