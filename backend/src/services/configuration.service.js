import { sessionTypeFromDatabase, sessionTypeToDatabase } from "../config/businessRules.js";
import { DAY_NAMES, DEFAULTS, groupBusinessHours, settingsCache } from "../config/settingsCache.js";
import { conflictError, notFoundError, validationError } from "../errors/AppError.js";
import { ownerId } from "../lib/ownership.js";
import { configurationRepository } from "../repositories/configuration.repository.js";

// The sessions table still constrains when a session may start, so a slot
// outside this window could be configured but never booked. Reject it here
// with an explanation rather than letting it fail at booking time.
const EARLIEST_SLOT = "05:00";
const LATEST_SLOT = "19:00";
const LATEST_SATURDAY_SLOT = "10:00";
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Long enough for the names the studio actually uses and short enough that a
// program picker does not wrap to three lines.
const MAX_PROGRAM_NAME = 60;

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

// SCH-05. The point of the message is that the trainer can act on it without
// hunting, so it names the hour, a client and a date. Capped at two hours and
// three names so a trainer clearing a whole morning gets a sentence, not an
// essay.
function describeOneSlot({ dayOfWeek, startTime, names, firstDate, total }) {
  const when = `${DAY_NAMES[dayOfWeek]} ${startTime}`;
  if (names.length === 0) {
    // No attendance row yet, which a freshly allocated session can look like.
    return `${when} (${total === 1 ? "a session" : `${total} sessions`} from ${firstDate})`;
  }
  const listed =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const more = total > names.length ? `, and ${total - names.length} more` : "";
  return `${when} (${listed}${more}, from ${firstDate})`;
}

function describeHoursInUse(slots = []) {
  const shown = slots.slice(0, 2).map(describeOneSlot);
  const rest = slots.length - shown.length;
  const list = rest > 0 ? `${shown.join("; ")}; and ${rest} more` : shown.join("; ");
  const [subject, pronoun] =
    slots.length === 1 ? ["This hour is", "it"] : ["These hours are", "they"];
  return `${subject} still booked, so ${pronoun} cannot be removed: ${list}. Cancel or move those sessions first.`;
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

export function createConfigurationService(
  repository = configurationRepository,
  { settings = settingsCache } = {}
) {
  async function loadConfiguration(trainerId) {
    const [programRows, pricingRows, packageSizes, businessHourRows, schedulingSettings] =
      await Promise.all([
        repository.listPrograms(trainerId),
        repository.listPricing(trainerId),
        repository.listPackageSizes(trainerId),
        repository.listBusinessHours(trainerId),
        repository.getSchedulingSettings(trainerId)
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
      // Migration 023 seeds a row for every trainer and a trigger keeps doing
      // it, so a missing one should not happen. Falling back beats a crash
      // reading a property of undefined if it ever does.
      sessionDurationMinutes:
        schedulingSettings?.session_duration_minutes ?? DEFAULTS.sessionDurationMinutes,
      groupCapacity: schedulingSettings?.group_capacity ?? DEFAULTS.groupCapacity,
      packageExpiryMonths:
        schedulingSettings?.package_expiry_months ?? DEFAULTS.packageExpiryMonths
    };

    // This trainer's cache entry now matches what was just read, so a booking
    // straight after a save does not go back to the database.
    settings.setSettings(trainerId, {
      packageSizes: configuration.packageSizes,
      businessHours: configuration.businessHours,
      groupCapacity: configuration.groupCapacity,
      sessionDurationMinutes: configuration.sessionDurationMinutes,
      packageExpiryMonths: configuration.packageExpiryMonths
    });

    return configuration;
  }

  return {
    async getConfiguration(actor) {
      return loadConfiguration(ownerId(actor));
    },

    // Prices, programs and package sizes belong to the acting trainer since
    // AUTH-10. Nothing here is shared between trainers, so the trainer is both
    // whose catalogue is written and whose configuration comes back.
    async updatePricing(payload = {}, actor) {
      const trainerId = ownerId(actor);
      const rows = requireArray(payload.pricing, "pricing");
      if (rows.length === 0) {
        throw validationError("pricing must contain at least one entry", { field: "pricing" });
      }

      const allowedSizes = new Set(await repository.listPackageSizes(trainerId));
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

      await repository.updatePricing(trainerId, entries);
      return loadConfiguration(trainerId);
    },

    /**
     * Replaces the program catalogue. An entry keeps its id to be renamed,
     * arrives without one to be created, and is left out to be removed.
     * Session type is fixed after creation because sessions and approved
     * recurring bookings hold composite keys to (program id, type) — changing
     * it would strand a program's own history.
     */
    async updatePrograms(payload = {}, actor) {
      const trainerId = ownerId(actor);
      const rows = requireArray(payload.programs, "programs");
      if (rows.length === 0) {
        throw validationError("At least one program must remain", { field: "programs" });
      }

      const existing = await repository.listPrograms(trainerId);
      const existingById = new Map(existing.map((row) => [Number(row.id), row]));
      const seen = new Set();
      const programs = rows.map((row) => {
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        if (!name) {
          throw validationError("Every program needs a name", { field: "programs" });
        }
        if (name.length > MAX_PROGRAM_NAME) {
          throw validationError(`Program names must be ${MAX_PROGRAM_NAME} characters or fewer`, {
            field: "programs",
            value: name
          });
        }

        const type = sessionTypeToDatabase(row.sessionType);
        if (!type) {
          throw validationError("sessionType must be One-on-One or Group", {
            field: "sessionType",
            value: row.sessionType
          });
        }

        let id;
        if (row.id !== undefined && row.id !== null) {
          id = Number(row.id);
          const current = existingById.get(id);
          if (!current) {
            throw notFoundError("That program no longer exists. Refresh and try again.");
          }
          if (current.type !== type) {
            throw validationError(
              `${current.name} cannot change session type, because its sessions are recorded ` +
                "against it. Add a new program instead.",
              { field: "sessionType", value: row.sessionType }
            );
          }
        }

        const key = `${type}:${name.toLowerCase()}`;
        if (seen.has(key)) {
          throw validationError(`${name} is listed twice for ${row.sessionType}`, {
            field: "programs"
          });
        }
        seen.add(key);

        return id === undefined ? { name, type } : { id, name, type };
      });

      try {
        await repository.replacePrograms(trainerId, programs);
      } catch (error) {
        // packages_program_id_fkey: the program has already been sold.
        if (error?.code === "23503") {
          throw conflictError(
            `${error.programName ?? "That program"} cannot be removed because clients have ` +
              "packages on it."
          );
        }
        // programs_name_type_key: the pair is already taken.
        if (error?.code === "23505") {
          throw conflictError("Two programs of the same session type cannot share a name.");
        }
        if (error?.code === "PROGRAM_NOT_FOUND") {
          throw notFoundError("That program no longer exists. Refresh and try again.");
        }
        throw error;
      }
      return loadConfiguration(trainerId);
    },

    async updatePackageSizes(payload = {}, actor) {
      const trainerId = ownerId(actor);
      const sizes = requireArray(payload.packageSizes, "packageSizes");
      if (sizes.length === 0) {
        throw validationError("At least one package size must remain", {
          field: "packageSizes"
        });
      }

      const parsed = [];
      for (const size of sizes) {
        const value = requirePositiveInt(size, "packageSizes");
        if (parsed.includes(value)) {
          throw validationError(`${value} is listed more than once`, {
            field: "packageSizes"
          });
        }
        parsed.push(value);
      }
      parsed.sort((a, b) => a - b);

      try {
        await repository.replacePackageSizes(trainerId, parsed);
      } catch (error) {
        // package_sizes_protect_sold (migration 024) raises 23503 just as the
        // foreign key it replaced did: the size has already been sold.
        if (error?.code === "23503") {
          throw conflictError(
            "That package size cannot be removed because clients have already bought it."
          );
        }
        throw error;
      }
      return loadConfiguration(trainerId);
    },

    async updateBusinessHours(payload = {}, actor) {
      const trainerId = ownerId(actor);
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

      try {
        await repository.replaceBusinessHours(trainerId, slots);
      } catch (error) {
        // SCH-05: the hour still has a session or a recurring booking in it.
        // Named, because "that hour is in use" leaves the trainer hunting.
        if (error?.code === "BUSINESS_HOURS_IN_USE") {
          throw conflictError(describeHoursInUse(error.slots));
        }
        throw error;
      }
      return loadConfiguration(trainerId);
    },

    async updateSchedulingSettings(payload = {}, actor) {
      const trainerId = ownerId(actor);
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

      await repository.updateSchedulingSettings(trainerId, updates);
      return loadConfiguration(trainerId);
    }
  };
}

export const configurationService = createConfigurationService();
