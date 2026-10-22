import assert from "node:assert/strict";
import test from "node:test";
import { createBookingRequestsService } from "../src/services/bookingRequests.service.js";

// AUTH-09 gave every method the acting trainer as its last argument, because a
// request belongs to whoever owns its client.
const TRAINER = { id: 9, role: "trainer" };
const ADMIN = { id: 1, role: "admin" };

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

  const result = await service.listPending(TRAINER);

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

  const result = await service.approve(1, TRAINER);

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

  const result = await service.approve(1, TRAINER);

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
    service.approve(1, TRAINER),
    (error) => error.status === 409 && error.code === "CONFLICT"
  );
});

test("passes the trainer own id to every query, and null for an admin", async () => {
  const scopes = [];
  const service = createBookingRequestsService({
    async findPending(scope) {
      scopes.push(["list", scope]);
      return [];
    },
    async approve(id, scope) {
      scopes.push(["approve", scope]);
      return { request: requestRow(), booking: { id: 9 }, generatedSessions: 0 };
    },
    async reject(id, scope) {
      scopes.push(["reject", scope]);
      return { id: 1, client_id: 2, package_id: 3, day_of_week: 1, start_time: "08:00:00", status: "rejected", reviewed_at: null };
    }
  });

  await service.listPending(TRAINER);
  await service.approve(1, TRAINER);
  await service.reject(1, TRAINER);
  await service.listPending(ADMIN);
  await service.approve(1, ADMIN);
  await service.reject(1, ADMIN);

  assert.deepEqual(scopes, [
    ["list", 9],
    ["approve", 9],
    ["reject", 9],
    ["list", null],
    ["approve", null],
    ["reject", null]
  ]);
});

test("a missing actor is a 401, never read as unrestricted", async () => {
  const service = createBookingRequestsService({
    async findPending() {
      throw new Error("the repository must not be reached");
    },
    async approve() {
      throw new Error("the repository must not be reached");
    },
    async reject() {
      throw new Error("the repository must not be reached");
    }
  });

  await assert.rejects(service.listPending(), (error) => error.status === 401);
  await assert.rejects(service.approve(1), (error) => error.status === 401);
  await assert.rejects(service.reject(1), (error) => error.status === 401);
});
