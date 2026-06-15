import { conflictError, notFoundError } from "../errors/AppError.js";
import { requirePositiveInteger } from "../lib/validation.js";
import { bookingRequestsRepository } from "../repositories/bookingRequests.repository.js";

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toRequestDto(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    packageId: row.package_id,
    programId: row.program_id,
    program: row.program_name,
    sessionType: row.session_type === "group" ? "Group" : "One-on-One",
    day: DAY_NAMES[row.day_of_week],
    dayOfWeek: row.day_of_week,
    startTime: row.start_time.slice(0, 5),
    status: row.status,
    source: row.source,
    purchaseDate: row.purchase_date,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  };
}

function translateRepositoryError(error) {
  if (error.code === "REQUEST_ALREADY_REVIEWED") {
    throw conflictError(error.message);
  }
  if (error.code === "SLOT_CONFLICT") {
    throw conflictError(error.message);
  }
  if (error.code === "CLIENT_ARCHIVED") {
    throw conflictError(error.message);
  }
  if (error.code === "23505" || error.code === "23514") {
    throw conflictError("The requested slot cannot be approved");
  }
  throw error;
}

export function createBookingRequestsService(repository = bookingRequestsRepository) {
  return {
    async listPending() {
      return (await repository.findPending()).map(toRequestDto);
    },

    async approve(requestId) {
      const id = requirePositiveInteger(requestId, "requestId");
      try {
        const result = await repository.approve(id);
        if (!result) throw notFoundError("Booking request not found");
        return {
          request: { ...toRequestDto(result.request), status: "approved" },
          recurringBookingId: result.booking.id,
          generatedSessions: result.generatedSessions
        };
      } catch (error) {
        translateRepositoryError(error);
      }
    },

    async reject(requestId) {
      const id = requirePositiveInteger(requestId, "requestId");
      try {
        const row = await repository.reject(id);
        if (!row) throw notFoundError("Booking request not found");
        return {
          id: row.id,
          clientId: row.client_id,
          packageId: row.package_id,
          day: DAY_NAMES[row.day_of_week],
          startTime: row.start_time.slice(0, 5),
          status: row.status,
          reviewedAt: row.reviewed_at
        };
      } catch (error) {
        translateRepositoryError(error);
      }
    }
  };
}

export const bookingRequestsService = createBookingRequestsService();
