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

function toClientDto(row) {
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
    paid: Boolean(row.paid),
    purchaseDate: formatDate(row.purchase_date),
    expiryDate: formatDate(row.expiry_date),
    createdAt: row.created_at
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
    async listClients() {
      return (await repository.findAll()).map(toClientDto);
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
            paid: optionalBoolean(input.paid, "paid")
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
      const row = await repository.updatePreferences(id, preferredDays, preferredSchedule);
      if (!row) throw notFoundError("Client not found");
      return toClientDto(row);
    }
  };
}

export const clientsService = createClientsService();
