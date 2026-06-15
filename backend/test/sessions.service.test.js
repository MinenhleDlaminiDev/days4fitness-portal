import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors/AppError.js";
import { createSessionsService } from "../src/services/sessions.service.js";

const sessionRow = {
  id: 12,
  program_id: 3,
  program_name: "Weight Loss",
  session_type: "one_on_one",
  session_date: "2026-06-15",
  start_time: "08:00:00",
  duration_minutes: 60,
  capacity: 1,
  status: "scheduled",
  has_started: true,
  has_ended: false,
  rescheduled_from_session_id: null,
  attendees: [
    {
      attendanceId: 20,
      clientId: 4,
      clientName: "Test Client",
      packageId: 8,
      sessionsTotal: 4,
      sessionsUsed: 1,
      paid: true,
      purchaseDate: "2026-06-01",
      expiryDate: "2026-08-01",
      status: "scheduled",
      creditConsumed: false
    }
  ]
};

test("lists a Monday-based schedule week as API DTOs", async () => {
  let capturedWeek;
  const service = createSessionsService({
    async findWeek(weekStart) {
      capturedWeek = weekStart;
      return [sessionRow];
    }
  });

  const result = await service.listWeek("2026-06-15");

  assert.equal(capturedWeek, "2026-06-15");
  assert.equal(result[0].startTime, "08:00");
  assert.equal(result[0].sessionType, "One-on-One");
  assert.equal(result[0].hasStarted, true);
  assert.equal(result[0].hasEnded, false);
  assert.equal(result[0].attendees[0].sessionsUsed, 1);
});

test("rejects non-Monday week starts and invalid training slots", async () => {
  const service = createSessionsService({});

  await assert.rejects(
    service.listWeek("2026-06-16"),
    (error) => error instanceof AppError && error.status === 400
  );
  await assert.rejects(
    service.createManual({
      clientId: 1,
      sessionDate: "2026-06-21",
      startTime: "08:00"
    }),
    (error) => error instanceof AppError && error.status === 400
  );
  await assert.rejects(
    service.createManual({
      clientId: 1,
      sessionDate: "2026-06-20",
      startTime: "11:00"
    }),
    (error) => error instanceof AppError && error.status === 400
  );
});

test("passes manual booking and attendance outcome inputs to the repository", async () => {
  const calls = [];
  const service = createSessionsService({
    async createManual(...args) {
      calls.push(["create", ...args]);
      return sessionRow;
    },
    async recordOutcome(...args) {
      calls.push(["outcome", ...args]);
      return { ...sessionRow, status: "completed" };
    }
  });

  await service.createManual({
    clientId: 4,
    sessionDate: "2026-06-15",
    startTime: "08:00"
  });
  await service.recordOutcome("12", { clientId: 4 }, "completed");

  assert.deepEqual(calls, [
    ["create", 4, "2026-06-15", "08:00"],
    ["outcome", 12, 4, "completed"]
  ]);
});

test("translates duplicate credit consumption into a conflict", async () => {
  const service = createSessionsService({
    async recordOutcome() {
      const error = new Error("This attendance outcome has already been recorded");
      error.code = "CREDIT_ALREADY_CONSUMED";
      throw error;
    }
  });

  await assert.rejects(
    service.recordOutcome(12, {}, "completed"),
    (error) => error instanceof AppError && error.status === 409
  );
});
