import assert from "node:assert/strict";
import test from "node:test";
import { createBookingRequestsService } from "../src/services/bookingRequests.service.js";

function requestRow(overrides = {}) {
  return {
    id: 1,
    client_id: 2,
    client_name: "Test Client",
    package_id: 3,
    program_id: 4,
    program_name: "Weight Loss",
    session_type: "one_on_one",
    day_of_week: 1,
    start_time: "08:00:00",
    status: "pending",
    source: "client_preference",
    purchase_date: "2026-06-01",
    expiry_date: "2026-08-01",
    created_at: "2026-06-01T08:00:00.000Z",
    reviewed_at: null,
    ...overrides
  };
}

test("lists pending requests as API-friendly weekly slots", async () => {
  const service = createBookingRequestsService({
    async findPending() {
      return [requestRow()];
    }
  });

  const result = await service.listPending();

  assert.deepEqual(result[0], {
    id: 1,
    clientId: 2,
    clientName: "Test Client",
    packageId: 3,
    programId: 4,
    program: "Weight Loss",
    sessionType: "One-on-One",
    day: "Monday",
    dayOfWeek: 1,
    startTime: "08:00",
    status: "pending",
    source: "client_preference",
    purchaseDate: "2026-06-01",
    expiryDate: "2026-08-01",
    createdAt: "2026-06-01T08:00:00.000Z",
    reviewedAt: null
  });
});

test("returns approval allocation details", async () => {
  const service = createBookingRequestsService({
    async approve() {
      return {
        request: requestRow(),
        booking: { id: 9 },
        generatedSessions: 4
      };
    }
  });

  const result = await service.approve(1);

  assert.equal(result.request.status, "approved");
  assert.equal(result.recurringBookingId, 9);
  assert.equal(result.generatedSessions, 4);
});

test("returns reviewed approval metadata", async () => {
  const reviewedAt = "2026-06-14T12:00:00.000Z";
  const service = createBookingRequestsService({
    async approve() {
      return {
        request: requestRow({ status: "approved", reviewed_at: reviewedAt }),
        booking: { id: 9 },
        generatedSessions: 4
      };
    }
  });

  const result = await service.approve(1);

  assert.equal(result.request.status, "approved");
  assert.equal(result.request.reviewedAt, reviewedAt);
});

test("translates unavailable slots to a conflict", async () => {
  const service = createBookingRequestsService({
    async approve() {
      const error = new Error("The requested weekly slot is already occupied");
      error.code = "SLOT_CONFLICT";
      throw error;
    }
  });

  await assert.rejects(
    service.approve(1),
    (error) => error.status === 409 && error.code === "CONFLICT"
  );
});
