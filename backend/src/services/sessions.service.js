import { BUSINESS_HOURS } from "../config/businessRules.js";
import { conflictError, notFoundError, validationError } from "../errors/AppError.js";
import { requireIsoDate, requirePositiveInteger } from "../lib/validation.js";
import { sessionsRepository } from "../repositories/sessions.repository.js";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function requireTime(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw validationError("startTime must use HH:MM format", { field: "startTime" });
  }
  return value;
}

function validateBookableSlot(sessionDate, startTime) {
  const day = DAY_NAMES[new Date(`${sessionDate}T00:00:00Z`).getUTCDay()];
  const hours = BUSINESS_HOURS.find((item) => item.day === day);
  if (!hours) throw validationError("Sessions cannot be booked on Sunday");
  if (!hours.timeSlots.includes(startTime)) {
    throw validationError(`${startTime} is outside ${day} training hours`, {
      field: "startTime",
      allowedValues: hours.timeSlots
    });
  }
}

function toSessionDto(row) {
  return {
    id: row.id,
    programId: row.program_id,
    program: row.program_name,
    sessionType: row.session_type === "group" ? "Group" : "One-on-One",
    sessionDate: row.session_date,
    startTime: row.start_time.slice(0, 5),
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    status: row.status,
    hasStarted: row.has_started,
    hasEnded: row.has_ended,
    rescheduledFromSessionId: row.rescheduled_from_session_id,
    replacementSessionId: row.replacement_session_id,
    attendees: (row.attendees || []).map((attendee) => ({
      ...attendee,
      sessionsTotal: Number(attendee.sessionsTotal),
      sessionsUsed: Number(attendee.sessionsUsed)
    }))
  };
}

function translateRepositoryError(error) {
  const conflictCodes = new Set([
    "SLOT_CONFLICT",
    "PACKAGE_INACTIVE",
    "PACKAGE_EXPIRED",
    "PACKAGE_EXHAUSTED",
    "PAST_SESSION",
    "SESSION_FINALIZED",
    "SESSION_ALREADY_STARTED",
    "SESSION_NOT_STARTED",
    "SESSION_NOT_ENDED",
    "SESSION_NOT_CANCELLED",
    "REPLACEMENT_EXISTS",
    "ATTENDEE_NOT_FOUND",
    "CLIENT_REQUIRED",
    "CREDIT_ALREADY_CONSUMED",
    "23505",
    "23514"
  ]);
  if (conflictCodes.has(error.code)) throw conflictError(error.message);
  throw error;
}

function parseBookingInput(input = {}) {
  const sessionDate = requireIsoDate(input.sessionDate, "sessionDate");
  const startTime = requireTime(input.startTime);
  validateBookableSlot(sessionDate, startTime);
  return { sessionDate, startTime };
}

export function createSessionsService(repository = sessionsRepository) {
  return {
    async listWeek(weekStartValue) {
      const weekStart = requireIsoDate(weekStartValue, "weekStart");
      const day = new Date(`${weekStart}T00:00:00Z`).getUTCDay();
      if (day !== 1) throw validationError("weekStart must be a Monday");
      return (await repository.findWeek(weekStart)).map(toSessionDto);
    },

    async getSession(sessionId) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      const row = await repository.findById(id);
      if (!row) throw notFoundError("Session not found");
      return toSessionDto(row);
    },

    async createManual(input) {
      const clientId = requirePositiveInteger(input?.clientId, "clientId");
      const { sessionDate, startTime } = parseBookingInput(input);
      try {
        const row = await repository.createManual(clientId, sessionDate, startTime);
        if (!row) throw notFoundError("Client package not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async cancel(sessionId) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      try {
        const row = await repository.cancel(id);
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async createReplacement(sessionId, input) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      const { sessionDate, startTime } = parseBookingInput(input);
      try {
        const row = await repository.createReplacement(id, sessionDate, startTime);
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async reschedule(sessionId, input) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      const { sessionDate, startTime } = parseBookingInput(input);
      try {
        const row = await repository.reschedule(id, sessionDate, startTime);
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async recordOutcome(sessionId, input, outcome) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      const clientId =
        input?.clientId === undefined || input?.clientId === null
          ? null
          : requirePositiveInteger(input.clientId, "clientId");
      try {
        const row = await repository.recordOutcome(id, clientId, outcome);
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    }
  };
}

export const sessionsService = createSessionsService();
