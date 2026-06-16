import {
  PACKAGE_SIZES,
  PACKAGE_EXPIRY_MONTHS,
  PROGRAM_ALIASES,
  SESSION_TYPES,
  sessionTypeFromDatabase,
  sessionTypeToDatabase,
  timeSlotsForDay
} from "../config/businessRules.js";
import { conflictError, notFoundError, validationError } from "../errors/AppError.js";
import {
  cleanString,
  optionalBoolean,
  requireFields,
  requireIsoDate,
  requireOneOf,
  requirePositiveInteger
} from "../lib/validation.js";
import { clientsRepository } from "../repositories/clients.repository.js";

function formatDate(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PAYMENT_METHODS = ["cash", "eft", "card"];

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
    const allowedSlots = timeSlotsForDay(day);
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

export function createClientsService(repository = clientsRepository) {
  return {
    async listClients(query = {}) {
      const page = Math.max(1, Number(query.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 10));
      const status = ["active", "archived", "all"].includes(query.status)
        ? query.status
        : "active";
      const packageStatus = ["active", "expired", "all"].includes(query.packageStatus)
        ? query.packageStatus
        : "all";
      const result = await repository.findAll({
        search: cleanString(query.search),
        status,
        packageStatus,
        page,
        pageSize
      });
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

    async getClient(clientId) {
      const id = requirePositiveInteger(clientId, "clientId");
      const row = await repository.findById(id);
      if (!row) throw notFoundError("Client not found");
      return toClientDto(row);
    },

    async createClient(input = {}) {
      requireFields(input, ["name", "phone", "program", "sessionType"]);

      const sessionType = cleanString(input.sessionType);
      requireOneOf(
        sessionType,
        SESSION_TYPES.map((item) => item.value),
        "sessionType"
      );

      const packageSize = Number(input.packageSize);
      if (!PACKAGE_SIZES.includes(packageSize)) {
        throw validationError(`packageSize must be one of: ${PACKAGE_SIZES.join(", ")}`, {
          field: "packageSize",
          allowedValues: PACKAGE_SIZES
        });
      }

      const purchaseDate = requireIsoDate(input.purchaseDate, "purchaseDate");
      const { preferredDays, preferredSchedule } = normalizePreferredSchedule(
        input.preferredDays,
        input.preferredSchedule,
        { allowEmpty: true }
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
            preferredDays,
            preferredSchedule
          },
          {
            programName: PROGRAM_ALIASES[programInput] ?? programInput,
            programType: sessionTypeToDatabase(sessionType),
            packageSize,
            purchaseDate,
            expiryMonths: PACKAGE_EXPIRY_MONTHS,
            paid,
            paymentMethod
          }
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

    async updatePreferences(clientId, input = {}) {
      const id = requirePositiveInteger(clientId, "clientId");
      const { preferredDays, preferredSchedule } = normalizePreferredSchedule(
        input.preferredDays,
        input.preferredSchedule,
        { allowEmpty: true }
      );
      try {
        const row = await repository.updatePreferences(id, preferredDays, preferredSchedule);
        if (!row) throw notFoundError("Client not found");
        return toClientDto(row);
      } catch (error) {
        if (error.code === "CLIENT_ARCHIVED") {
          throw conflictError("Restore this client before updating session preferences");
        }
        throw error;
      }
    },

    async updateClient(clientId, input = {}) {
      const id = requirePositiveInteger(clientId, "clientId");
      requireFields(input, ["name", "phone"]);
      const hasPreferences =
        input.preferredDays !== undefined || input.preferredSchedule !== undefined;
      const preferences = hasPreferences
        ? normalizePreferredSchedule(input.preferredDays, input.preferredSchedule, {
            allowEmpty: true
          })
        : null;
      try {
        const row = await repository.update(
          id,
          {
            name: cleanString(input.name),
            phone: cleanString(input.phone),
            email: cleanString(input.email) || null
          },
          preferences
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

    async setClientActive(clientId, isActive) {
      const id = requirePositiveInteger(clientId, "clientId");
      const row = await repository.setActive(id, isActive);
      if (!row) throw notFoundError("Client not found");
      return toClientDto(row);
    },

    async getPackageHistory(clientId) {
      const id = requirePositiveInteger(clientId, "clientId");
      const client = await repository.findById(id);
      if (!client) throw notFoundError("Client not found");
      return (await repository.findPackageHistory(id)).map(toPackageDto);
    },

    async getSessionHistory(clientId) {
      const id = requirePositiveInteger(clientId, "clientId");
      const client = await repository.findById(id);
      if (!client) throw notFoundError("Client not found");
      return (await repository.findSessionHistory(id)).map(toSessionHistoryDto);
    }
  };
}

export const clientsService = createClientsService();
