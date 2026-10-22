import { DAY_NAMES, settingsCache } from "../config/settingsCache.js";
import { conflictError, notFoundError, validationError } from "../errors/AppError.js";
import { ownerScope } from "../lib/ownership.js";
import { requireIsoDate, requirePositiveInteger } from "../lib/validation.js";
import { sessionsRepository } from "../repositories/sessions.repository.js";

function requireTime(value) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw validationError("startTime must use HH:MM format", { field: "startTime" });
  }
  return value;
}

/**
 * The hours belong to the trainer whose client this is, not to the person
 * asking: an admin booking for a trainer gets that trainer's week.
 */
async function assertBookableSlot(settings, sessionDate, startTime, trainerId) {
  const { businessHours } = await settings.getSettings(trainerId);
  const day = DAY_NAMES[new Date(`${sessionDate}T00:00:00Z`).getUTCDay()];
  const hours = businessHours.find((item) => item.day === day);
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
    // A number, not the string pg hands back for a bigint, so callers can
    // compare it without remembering which it is.
    trainerId: row.trainer_user_id == null ? null : Number(row.trainer_user_id),
    trainerName: row.trainer_name,
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
    "CLIENT_ARCHIVED",
    "23505",
    "23514",
    // 23P01: sessions_no_overlap, the database backstop for a clashing slot.
    "23P01"
  ]);
  if (conflictCodes.has(error.code)) throw conflictError(error.message);
  throw error;
}

// Shape first, hours second. A malformed date is still a 400 before anything
// is looked up; only the training-hours check has to wait until the owner is
// known.
function parseBookingInput(input = {}) {
  const sessionDate = requireIsoDate(input.sessionDate, "sessionDate");
  const startTime = requireTime(input.startTime);
  return { sessionDate, startTime };
}

export function createSessionsService(
  repository = sessionsRepository,
  { settings = settingsCache } = {}
) {
  return {
    async listWeek(weekStartValue, actor) {
      const weekStart = requireIsoDate(weekStartValue, "weekStart");
      const day = new Date(`${weekStart}T00:00:00Z`).getUTCDay();
      if (day !== 1) throw validationError("weekStart must be a Monday");
      return (await repository.findWeek(weekStart, ownerScope(actor))).map(toSessionDto);
    },

    async getSession(sessionId, actor) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      const row = await repository.findById(id, ownerScope(actor));
      if (!row) throw notFoundError("Session not found");
      return toSessionDto(row);
    },

    async createManual(input, actor) {
      const clientId = requirePositiveInteger(input?.clientId, "clientId");
      const { sessionDate, startTime } = parseBookingInput(input);
      const scope = ownerScope(actor);
      const owner = await repository.clientOwner(clientId, scope);
      if (!owner) throw notFoundError("Client not found");
      await assertBookableSlot(settings, sessionDate, startTime, owner);
      try {
        const row = await repository.createManual(clientId, sessionDate, startTime, scope);
        if (!row) throw notFoundError("Client package not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async cancel(sessionId, actor) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      try {
        const row = await repository.cancel(id, ownerScope(actor));
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async createReplacement(sessionId, input, actor) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      const { sessionDate, startTime } = parseBookingInput(input);
      const scope = ownerScope(actor);
      const owner = await repository.sessionOwner(id, scope);
      if (!owner) throw notFoundError("Session not found");
      await assertBookableSlot(settings, sessionDate, startTime, owner);
      try {
        const row = await repository.createReplacement(id, sessionDate, startTime, scope);
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async reschedule(sessionId, input, actor) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      const { sessionDate, startTime } = parseBookingInput(input);
      const scope = ownerScope(actor);
      const owner = await repository.sessionOwner(id, scope);
      if (!owner) throw notFoundError("Session not found");
      await assertBookableSlot(settings, sessionDate, startTime, owner);
      try {
        const row = await repository.reschedule(id, sessionDate, startTime, scope);
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async cancelDay(input = {}, actor) {
      const sessionDate = requireIsoDate(input.sessionDate, "sessionDate");
      try {
        const cancelledIds = await repository.cancelDay(sessionDate, ownerScope(actor));
        return { sessionDate, cancelled: cancelledIds.length, sessionIds: cancelledIds };
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async recordOutcome(sessionId, input, outcome, actor) {
      const id = requirePositiveInteger(sessionId, "sessionId");
      // applyToAll is the explicit opt-in for marking a whole group at once.
      const applyToAll = input?.applyToAll === true;
      const clientId =
        applyToAll || input?.clientId === undefined || input?.clientId === null
          ? null
          : requirePositiveInteger(input.clientId, "clientId");
      try {
        const row = await repository.recordOutcome(
          id,
          clientId,
          outcome,
          { applyToAll },
          ownerScope(actor)
        );
        if (!row) throw notFoundError("Session not found");
        return toSessionDto(row);
      } catch (error) {
        translateRepositoryError(error);
      }
    }
  };
}

export const sessionsService = createSessionsService();
