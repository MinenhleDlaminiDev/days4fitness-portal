import { sessionTypeFromDatabase, sessionTypeToDatabase } from "../config/businessRules.js";
import {
  DAY_NAMES,
  getSettings,
  groupBusinessHours,
  setSettings
} from "../config/settingsCache.js";
import { validationError } from "../errors/AppError.js";
import { configurationRepository } from "../repositories/configuration.repository.js";

// The sessions table still constrains when a session may start, so a slot
// outside this window could be configured but never booked. Reject it here
// with an explanation rather than letting it fail at booking time.
const EARLIEST_SLOT = "05:00";
const LATEST_SLOT = "19:00";
const LATEST_SATURDAY_SLOT = "10:00";
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw validationError(`${field} must be an array`, { field });
  }
  return value;
}

function requirePrice(value, field) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw validationError(`${field} must be a number of 0 or more`, { field });
  }
  return Math.round(price * 100) / 100;
}

function requirePositiveInt(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw validationError(`${field} must be a whole number of 1 or more`, { field });
  }
  return parsed;
}

function requireSlotTime(value, day) {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throw validationError(`${day} times must use HH:MM format`, {
      field: "businessHours",
      day,
      value
    });
  }
  const latest = day === "Saturday" ? LATEST_SATURDAY_SLOT : LATEST_SLOT;
  if (value < EARLIEST_SLOT || value > latest) {
    throw validationError(`${day} times must fall between ${EARLIEST_SLOT} and ${latest}`, {
      field: "businessHours",
      day,
      value
    });
  }
  return value;
}

export function createConfigurationService(repository = configurationRepository) {
  async function loadConfiguration() {
    const [programRows, pricingRows, packageSizes, businessHourRows, schedulingSettings] =
      await Promise.all([
        repository.listPrograms(),
        repository.listPricing(),
        repository.listPackageSizes(),
        repository.listBusinessHours(),
        repository.getSchedulingSettings()
      ]);

    const configuration = {
      programs: programRows.map((row) => ({
        id: row.id,
        name: row.name,
        sessionType: sessionTypeFromDatabase(row.type)
      })),
      packageSizes,
      pricing: pricingRows.map((row) => ({
        sessionType: sessionTypeFromDatabase(row.program_type),
        sessionsTotal: row.sessions_total,
        price: Number(row.price)
      })),
      businessHours: groupBusinessHours(businessHourRows),
      sessionDurationMinutes: schedulingSettings.session_duration_minutes,
      groupCapacity: schedulingSettings.group_capacity,
      packageExpiryMonths: schedulingSettings.package_expiry_months
    };

    // Keep the synchronous snapshot the booking validations read in step.
    setSettings({
      packageSizes: configuration.packageSizes,
      businessHours: configuration.businessHours,
      groupCapacity: configuration.groupCapacity,
      sessionDurationMinutes: configuration.sessionDurationMinutes,
      packageExpiryMonths: configuration.packageExpiryMonths
    });

    return configuration;
  }

  return {
    getConfiguration: loadConfiguration,

    /** Called once at boot so the cache is warm before the first request. */
    async primeCache() {
      await loadConfiguration();
      return getSettings();
    },

    async updatePricing(payload = {}) {
      const rows = requireArray(payload.pricing, "pricing");
      if (rows.length === 0) {
        throw validationError("pricing must contain at least one entry", { field: "pricing" });
      }

      const allowedSizes = new Set(await repository.listPackageSizes());
      const seen = new Set();
      const entries = rows.map((row) => {
        const programType = sessionTypeToDatabase(row.sessionType);
        if (!programType) {
          throw validationError("sessionType must be One-on-One or Group", {
            field: "sessionType",
            value: row.sessionType
          });
        }
        const sessionsTotal = requirePositiveInt(row.sessionsTotal, "sessionsTotal");
        if (!allowedSizes.has(sessionsTotal)) {
          throw validationError(`sessionsTotal must be one of: ${[...allowedSizes].join(", ")}`, {
            field: "sessionsTotal",
            allowedValues: [...allowedSizes]
          });
        }
        const key = `${programType}:${sessionsTotal}`;
        if (seen.has(key)) {
          throw validationError(`Duplicate price for ${row.sessionType} ${sessionsTotal}`, {
            field: "pricing"
          });
        }
        seen.add(key);
        return { programType, sessionsTotal, price: requirePrice(row.price, "price") };
      });

      await repository.updatePricing(entries);
      return loadConfiguration();
    },

    async updateBusinessHours(payload = {}) {
      const days = requireArray(payload.businessHours, "businessHours");
      const slots = [];
      const seenDays = new Set();

      for (const entry of days) {
        const dayOfWeek = DAY_NAMES.indexOf(entry?.day);
        if (dayOfWeek < 1 || dayOfWeek > 6) {
          throw validationError("day must be Monday through Saturday", {
            field: "businessHours",
            value: entry?.day
          });
        }
        if (seenDays.has(dayOfWeek)) {
          throw validationError(`${entry.day} appears more than once`, { field: "businessHours" });
        }
        seenDays.add(dayOfWeek);

        const times = requireArray(entry.timeSlots, "timeSlots");
        const unique = new Set();
        for (const time of times) {
          const slot = requireSlotTime(time, entry.day);
          if (unique.has(slot)) {
            throw validationError(`${entry.day} lists ${slot} more than once`, {
              field: "businessHours",
              day: entry.day
            });
          }
          unique.add(slot);
          slots.push({ dayOfWeek, startTime: slot });
        }
      }

      if (slots.length === 0) {
        throw validationError("At least one training slot must remain", {
          field: "businessHours"
        });
      }

      await repository.replaceBusinessHours(slots);
      return loadConfiguration();
    },

    async updateSchedulingSettings(payload = {}) {
      const updates = {};
      if (payload.groupCapacity !== undefined) {
        updates.groupCapacity = requirePositiveInt(payload.groupCapacity, "groupCapacity");
      }
      if (payload.sessionDurationMinutes !== undefined) {
        updates.sessionDurationMinutes = requirePositiveInt(
          payload.sessionDurationMinutes,
          "sessionDurationMinutes"
        );
      }
      if (payload.packageExpiryMonths !== undefined) {
        updates.packageExpiryMonths = requirePositiveInt(
          payload.packageExpiryMonths,
          "packageExpiryMonths"
        );
      }
      if (Object.keys(updates).length === 0) {
        throw validationError(
          "Provide groupCapacity, sessionDurationMinutes or packageExpiryMonths"
        );
      }

      await repository.updateSchedulingSettings(updates);
      return loadConfiguration();
    }
  };
}

export const configurationService = createConfigurationService();
