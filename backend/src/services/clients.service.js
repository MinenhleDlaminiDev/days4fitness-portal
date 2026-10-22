import {
  PROGRAM_ALIASES,
  SESSION_TYPES,
  sessionTypeFromDatabase,
  sessionTypeToDatabase
} from "../config/businessRules.js";
import { settingsCache } from "../config/settingsCache.js";
import { conflictError, notFoundError, validationError } from "../errors/AppError.js";
import { ownerId, ownerScope } from "../lib/ownership.js";
import {
  cleanString,
  optionalBoolean,
  requireFields,
  requireIsoDate,
  requireOneOf,
  requirePositiveInteger
} from "../lib/validation.js";
import { MAX_ACTIVE_GOALS, clientsRepository } from "../repositories/clients.repository.js";
import { env } from "../config/env.js";

function formatDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PAYMENT_METHODS = ["cash", "eft", "card"];

const MAX_GOAL_LENGTH = 200;

function businessToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: env.businessTimezone });
}

function requireGoalText(value) {
  const goal = cleanString(value);
  if (!goal) {
    throw validationError("A goal needs some words", { field: "goal" });
  }
  if (goal.length > MAX_GOAL_LENGTH) {
    throw validationError(`A goal must be ${MAX_GOAL_LENGTH} characters or fewer`, {
      field: "goal"
    });
  }
  return goal;
}

// A goal cannot have been achieved on a day that has not happened yet.
function requireAchievedDate(value) {
  const achievedAt = requireIsoDate(value, "achievedAt");
  if (achievedAt > businessToday()) {
    throw validationError("A goal cannot be achieved in the future", { field: "achievedAt" });
  }
  return achievedAt;
}

function toGoalDto(row) {
  return {
    id: Number(row.id),
    goal: row.goal,
    targetDate: row.target_date ?? null,
    achievedAt: row.achieved_at ?? null,
    createdAt: row.created_at
  };
}

function toClientDto(row) {
  const price = Number(row.price ?? 0);
  const paidAmount = Number(row.paid_amount ?? 0);
  const paymentStatus =
    paidAmount >= price && price > 0
      ? "paid"
      : paidAmount > 0
        ? "partially_paid"
        : "unpaid";
  return {
    id: row.id,
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    preferredDays: Array.isArray(row.preferred_days) ? row.preferred_days : [],
    preferredSchedule:
      row.preferred_schedule && typeof row.preferred_schedule === "object" ? row.preferred_schedule : {},
    sessionPreferences: (Array.isArray(row.preference_statuses) ? row.preference_statuses : []).map(
      (preference) => ({
        day: DAY_NAMES[preference.dayOfWeek],
        startTime: preference.startTime,
        status: preference.status
      })
    ),
    program: row.program_name ?? "",
    sessionType: sessionTypeFromDatabase(row.program_type) ?? "One-on-One",
    sessionsTotal: row.sessions_total ?? 0,
    sessionsUsed: row.sessions_used ?? 0,
    price,
    paid: Boolean(row.paid),
    paidAmount,
    outstandingBalance: Number(row.outstanding_balance ?? row.price ?? 0),
    paymentStatus,
    purchaseDate: formatDate(row.purchase_date),
    expiryDate: formatDate(row.expiry_date),
    createdAt: row.created_at,
    isActive: row.is_active !== false,
    archivedAt: row.archived_at
  };
}

function toPackageDto(row) {
  return {
    id: row.id,
    program: row.program_name,
    sessionType: sessionTypeFromDatabase(row.program_type),
    sessionsTotal: row.sessions_total,
    sessionsUsed: row.sessions_used,
    price: Number(row.price),
    paid: Boolean(row.paid),
    paidAmount: Number(row.paid_amount ?? (row.paid ? row.price : 0)),
    outstandingBalance: Number(
      row.outstanding_balance ?? (row.paid ? 0 : row.price)
    ),
    purchaseDate: formatDate(row.purchase_date),
    expiryDate: formatDate(row.expiry_date),
    createdAt: row.created_at
  };
}

function toSessionHistoryDto(row) {
  return {
    id: row.id,
    sessionDate: row.session_date,
    startTime: row.start_time.slice(0, 5),
    durationMinutes: row.duration_minutes,
    sessionStatus: row.session_status,
    attendanceStatus: row.attendance_status,
    creditConsumed: row.credit_consumed,
    hasStarted: row.has_started,
    hasEnded: row.has_ended,
    packageId: row.package_id,
    program: row.program_name,
    sessionType: sessionTypeFromDatabase(row.program_type)
  };
}

export function normalizePreferredSchedule(inputDays, inputSchedule, options = {}) {
  if (inputDays !== undefined && !Array.isArray(inputDays)) {
    throw validationError("preferredDays must be an array", {
      field: "preferredDays"
    });
  }
  if (
    inputSchedule !== undefined &&
    (!inputSchedule || typeof inputSchedule !== "object" || Array.isArray(inputSchedule))
  ) {
    throw validationError("preferredSchedule must be an object", {
      field: "preferredSchedule"
    });
  }

  const preferredDays = [
    ...new Set((Array.isArray(inputDays) ? inputDays : []).map(cleanString).filter(Boolean))
  ];
  const rawSchedule =
    inputSchedule && typeof inputSchedule === "object" && !Array.isArray(inputSchedule)
      ? inputSchedule
      : {};

  if (preferredDays.length === 0) {
    if (options.allowEmpty) {
      if (Object.keys(rawSchedule).length > 0) {
        throw validationError("preferredSchedule requires at least one preferred day", {
          field: "preferredSchedule"
        });
      }
      return { preferredDays: [], preferredSchedule: {} };
    }
    throw validationError("Select at least one preferred training day", {
      field: "preferredDays"
    });
  }

  const unexpectedDays = Object.keys(rawSchedule).filter((day) => !preferredDays.includes(day));
  if (unexpectedDays.length > 0) {
    throw validationError("preferredSchedule contains days that are not selected", {
      field: "preferredSchedule",
      days: unexpectedDays
    });
  }

  const preferredSchedule = {};

  for (const day of preferredDays) {
    if (!options.businessHours) {
      throw new Error(
        "normalizePreferredSchedule needs the owning trainer's businessHours: the " +
          "available slots are theirs, not the business's."
      );
    }
    const allowedSlots =
      options.businessHours.find((item) => item.day === day)?.timeSlots || [];
    if (allowedSlots.length === 0) {
      throw validationError(`${day} is not an available training day`, {
        field: "preferredDays",
        day
      });
    }

    const values = Array.isArray(rawSchedule[day]) ? rawSchedule[day] : [];
    const normalized = [...new Set(values.map(cleanString).filter(Boolean))];
    if (normalized.length === 0) {
      throw validationError(`Select at least one preferred time for ${day}`, {
        field: "preferredSchedule",
        day
      });
    }
    if (!normalized.every((slot) => allowedSlots.includes(slot))) {
      throw validationError(`preferredSchedule contains an invalid time slot for ${day}`, {
        field: "preferredSchedule",
        day,
        allowedSlots
      });
    }
    preferredSchedule[day] = normalized;
  }

  return { preferredDays, preferredSchedule };
}

export function createClientsService(
  repository = clientsRepository,
  { settings = settingsCache } = {}
) {
  // Every goal operation needs the client to exist first, and a missing one
  // must read as a 404 rather than an empty list. A shared helper beats
  // `this` here, because a controller may hand a method around on its own.
  // Doubles as the ownership check. findById is scoped, so another trainer's
  // client reads as missing rather than forbidden -- an id that is not yours
  // should not be confirmed to exist.
  async function requireClient(clientId, actor) {
    const id = requirePositiveInteger(clientId, "clientId");
    if (!(await repository.findById(id, ownerScope(actor)))) {
      throw notFoundError("Client not found");
    }
    return id;
  }

  return {
    async listClients(query = {}, actor) {
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 10));
      const status = ["active", "archived", "all"].includes(query.status)
        ? query.status
        : "active";
      const packageStatus = ["active", "expired", "all"].includes(query.packageStatus)
        ? query.packageStatus
        : "all";
      const result = await repository.findAll(
        {
          search: cleanString(query.search),
          status,
          packageStatus,
          page,
          pageSize
        },
        ownerScope(actor)
      );
      return {
        items: result.rows.map(toClientDto),
        summary: {
          unpaid: result.unpaidTotal
        },
        pagination: {
          page,
          pageSize,
          total: result.total,
          totalPages: Math.max(1, Math.ceil(result.total / pageSize))
        }
      };
    },

    async listClientOptions(actor) {
      const rows = await repository.findActiveOptions(ownerScope(actor));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        sessionsTotal: row.sessions_total ?? 0,
        sessionsUsed: row.sessions_used ?? 0
      }));
    },

    async getClient(clientId, actor) {
      const id = requirePositiveInteger(clientId, "clientId");
      const [row, goals] = await Promise.all([
        repository.findById(id, ownerScope(actor)),
        repository.listGoals(id)
      ]);
      if (!row) throw notFoundError("Client not found");
      return { ...toClientDto(row), goals: goals.map(toGoalDto) };
    },

    async createClient(input = {}, actor) {
      requireFields(input, ["name", "phone", "program", "sessionType"]);

      const sessionType = cleanString(input.sessionType);
      requireOneOf(
        sessionType,
        SESSION_TYPES.map((item) => item.value),
        "sessionType"
      );

      // The creating trainer owns the client, so the sizes, expiry window and
      // training hours that apply are theirs.
      const owned = await settings.getSettings(ownerId(actor));
      const { packageSizes, packageExpiryMonths } = owned;
      const packageSize = Number(input.packageSize);
      if (!packageSizes.includes(packageSize)) {
        throw validationError(`packageSize must be one of: ${packageSizes.join(", ")}`, {
          field: "packageSize",
          allowedValues: packageSizes
        });
      }

      const purchaseDate = requireIsoDate(input.purchaseDate, "purchaseDate");
      const { preferredDays, preferredSchedule } = normalizePreferredSchedule(
        input.preferredDays,
        input.preferredSchedule,
        { allowEmpty: true, businessHours: owned.businessHours }
      );
      const programInput = cleanString(input.program);
      const paid = optionalBoolean(input.paid, "paid");
      const paymentMethod = paid
        ? requireOneOf(input.paymentMethod, PAYMENT_METHODS, "paymentMethod")
        : null;

      try {
        const row = await repository.createWithPackage(
          {
            name: cleanString(input.name),
            phone: cleanString(input.phone),
            email: cleanString(input.email) || null,
            // Optional at signup; validated the same way as one added later.
            goal: cleanString(input.goal) ? requireGoalText(input.goal) : null,
            preferredDays,
            preferredSchedule
          },
          {
            programName: PROGRAM_ALIASES[programInput] ?? programInput,
            programType: sessionTypeToDatabase(sessionType),
            packageSize,
            purchaseDate,
            expiryMonths: packageExpiryMonths,
            paid,
            paymentMethod
          },
          ownerId(actor)
        );
        return toClientDto(row);
      } catch (error) {
        if (error.code === "23505") {
          throw conflictError("A client with that email already exists");
        }
        if (error.code === "PACKAGE_CONFIGURATION_MISSING") {
          throw validationError("Selected package configuration is not available");
        }
        throw error;
      }
    },

    async updatePreferences(clientId, input = {}, actor) {
      const id = requirePositiveInteger(clientId, "clientId");
      const scope = ownerScope(actor);
      const owner = await repository.clientOwner(id, scope);
      if (!owner) throw notFoundError("Client not found");
      const { businessHours } = await settings.getSettings(owner);
      const { preferredDays, preferredSchedule } = normalizePreferredSchedule(
        input.preferredDays,
        input.preferredSchedule,
        { allowEmpty: true, businessHours }
      );
      try {
        const row = await repository.updatePreferences(id, preferredDays, preferredSchedule, scope);
        if (!row) throw notFoundError("Client not found");
        return toClientDto(row);
      } catch (error) {
        if (error.code === "CLIENT_ARCHIVED") {
          throw conflictError("Restore this client before updating session preferences");
        }
        throw error;
      }
    },

    async updateClient(clientId, input = {}, actor) {
      const id = requirePositiveInteger(clientId, "clientId");
      requireFields(input, ["name", "phone"]);
      const hasPreferences =
        input.preferredDays !== undefined || input.preferredSchedule !== undefined;
      let preferences = null;
      if (hasPreferences) {
        const owner = await repository.clientOwner(id, ownerScope(actor));
        if (!owner) throw notFoundError("Client not found");
        const { businessHours } = await settings.getSettings(owner);
        preferences = normalizePreferredSchedule(input.preferredDays, input.preferredSchedule, {
          allowEmpty: true,
          businessHours
        });
      }
      try {
        const row = await repository.update(
          id,
          {
            name: cleanString(input.name),
            phone: cleanString(input.phone),
            email: cleanString(input.email) || null
          },
          preferences,
          ownerScope(actor)
        );
        if (!row) throw notFoundError("Client not found");
        return toClientDto(row);
      } catch (error) {
        if (error.code === "23505") throw conflictError("A client with that email already exists");
        if (error.code === "CLIENT_ARCHIVED") {
          throw conflictError("Restore this client before updating session preferences");
        }
        if (error.code === "PACKAGE_CONFIGURATION_MISSING") {
          throw validationError("Client package is not available");
        }
        throw error;
      }
    },

    async setClientActive(clientId, isActive, actor) {
      const id = requirePositiveInteger(clientId, "clientId");
      const row = await repository.setActive(id, isActive, ownerScope(actor));
      if (!row) throw notFoundError("Client not found");
      return toClientDto(row);
    },

    async addClientGoal(clientId, input = {}, actor) {
      const ownerId = await requireClient(clientId, actor);
      const created = await repository.createGoal(ownerId, {
        goal: requireGoalText(input.goal),
        targetDate: input.targetDate ? requireIsoDate(input.targetDate, "targetDate") : null
      });
      if (!created) {
        throw conflictError(
          `A client can work on ${MAX_ACTIVE_GOALS} goals at a time. ` +
            "Mark one achieved or remove it first."
        );
      }
      return (await repository.listGoals(ownerId)).map(toGoalDto);
    },

    /**
     * Only the fields present are touched, so marking a goal achieved does not
     * require sending its text back.
     */
    async updateClientGoal(clientId, goalId, input = {}, actor) {
      const ownerId = await requireClient(clientId, actor);
      const id = requirePositiveInteger(goalId, "goalId");
      const existing = (await repository.listGoals(ownerId)).find(
        (row) => Number(row.id) === id
      );
      if (!existing) {
        throw notFoundError("Goal not found");
      }

      const changes = {};
      if (input.goal !== undefined) {
        changes.goal = requireGoalText(input.goal);
      }
      if (input.targetDate !== undefined) {
        changes.targetDate = input.targetDate
          ? requireIsoDate(input.targetDate, "targetDate")
          : null;
      }
      if (input.achievedAt !== undefined) {
        changes.achievedAt = input.achievedAt
          ? requireAchievedDate(input.achievedAt)
          : null;
      } else if (input.achieved !== undefined) {
        changes.achievedAt = optionalBoolean(input.achieved, "achieved") ? businessToday() : null;
      }
      if (Object.keys(changes).length === 0) {
        throw validationError("Provide goal, targetDate, achieved or achievedAt");
      }

      const updated = await repository.updateGoal(ownerId, id, changes);
      if (!updated) {
        // The goal exists, so the only thing the update could not do is reopen
        // it past the cap.
        throw conflictError(
          `A client can work on ${MAX_ACTIVE_GOALS} goals at a time. ` +
            "Mark one achieved or remove it first."
        );
      }
      return (await repository.listGoals(ownerId)).map(toGoalDto);
    },

    async removeClientGoal(clientId, goalId, actor) {
      const ownerId = await requireClient(clientId, actor);
      const removed = await repository.deleteGoal(
        ownerId,
        requirePositiveInteger(goalId, "goalId")
      );
      if (!removed) {
        throw notFoundError("Goal not found");
      }
      return (await repository.listGoals(ownerId)).map(toGoalDto);
    },

    async getPackageHistory(clientId, actor) {
      const id = requirePositiveInteger(clientId, "clientId");
      const client = await repository.findById(id, ownerScope(actor));
      if (!client) throw notFoundError("Client not found");
      return (await repository.findPackageHistory(id)).map(toPackageDto);
    },

    async getSessionHistory(clientId, actor) {
      const id = requirePositiveInteger(clientId, "clientId");
      const client = await repository.findById(id, ownerScope(actor));
      if (!client) throw notFoundError("Client not found");
      return (await repository.findSessionHistory(id)).map(toSessionHistoryDto);
    }
  };
}

export const clientsService = createClientsService();
