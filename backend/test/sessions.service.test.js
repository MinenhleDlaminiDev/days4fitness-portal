import assert from "node:assert/strict";
import test from "node:test";
import { configureSettingsLoader, DEFAULTS } from "../src/config/settingsCache.js";
import { AppError } from "../src/errors/AppError.js";
import { createSessionsService } from "../src/services/sessions.service.js";

// Training hours belong to the owning trainer and are read from the database
// since AUTH-05. There is none here, so every trainer keeps the default week.
configureSettingsLoader(async () => DEFAULTS);

// The service asks who owns the client or session before it checks the slot
// against their hours. Ownership itself is covered by the integration tests.
const OWNS_EVERYTHING = {
  async clientOwner() {
    return TRAINER.id;
  },
  async sessionOwner() {
    return TRAINER.id;
  }
};

// Every sessions service call takes the acting trainer since AUTH-04, and
// refuses to run without one.
const TRAINER = { id: 7, role: "trainer" };
const ADMIN = { id: 1, role: "admin" };

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
  trainer_user_id: 7,
  trainer_name: "Thandi",
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
  let capturedScope;
  const service = createSessionsService({
    async findWeek(weekStart, scope) {
      capturedWeek = weekStart;
      capturedScope = scope;
      return [sessionRow];
    }
  });

  const result = await service.listWeek("2026-06-15", TRAINER);

  assert.equal(capturedWeek, "2026-06-15");
  assert.equal(capturedScope, 7);
  assert.equal(result[0].trainerName, "Thandi");
  assert.equal(result[0].startTime, "08:00");
  assert.equal(result[0].sessionType, "One-on-One");
  assert.equal(result[0].hasStarted, true);
  assert.equal(result[0].hasEnded, false);
  assert.equal(result[0].attendees[0].sessionsUsed, 1);
});

test("rejects non-Monday week starts and invalid training slots", async () => {
  const service = createSessionsService({ ...OWNS_EVERYTHING });

  await assert.rejects(
    service.listWeek("2026-06-16", TRAINER),
    (error) => error instanceof AppError && error.status === 400
  );
  await assert.rejects(
    service.createManual(
      {
        clientId: 1,
        sessionDate: "2026-06-21",
        startTime: "08:00"
      },
      TRAINER
    ),
    (error) => error instanceof AppError && error.status === 400
  );
  await assert.rejects(
    service.createManual(
      {
        clientId: 1,
        sessionDate: "2026-06-20",
        startTime: "11:00"
      },
      TRAINER
    ),
    (error) => error instanceof AppError && error.status === 400
  );
});

test("passes manual booking and attendance outcome inputs to the repository", async () => {
  const calls = [];
  const service = createSessionsService({
    ...OWNS_EVERYTHING,
    async createManual(...args) {
      calls.push(["create", ...args]);
      return sessionRow;
    },
    async recordOutcome(...args) {
      calls.push(["outcome", ...args]);
      return { ...sessionRow, status: "completed" };
    }
  });

  await service.createManual(
    {
      clientId: 4,
      sessionDate: "2026-06-15",
      startTime: "08:00"
    },
    TRAINER
  );
  await service.recordOutcome("12", { clientId: 4 }, "completed", TRAINER);

  // The trainer's own id is the scope; an admin's is null, meaning no limit.
  assert.deepEqual(calls, [
    ["create", 4, "2026-06-15", "08:00", 7],
    ["outcome", 12, 4, "completed", { applyToAll: false }, 7]
  ]);
});

test("applyToAll drops the clientId so every attendee is marked at once", async () => {
  const calls = [];
  const service = createSessionsService({
    async recordOutcome(...args) {
      calls.push(args);
      return { ...sessionRow, status: "no_show" };
    }
  });

  await service.recordOutcome("12", { applyToAll: true }, "no_show", TRAINER);
  // A clientId sent alongside applyToAll is ignored rather than narrowing it.
  await service.recordOutcome("12", { applyToAll: true, clientId: 4 }, "no_show", ADMIN);

  assert.deepEqual(calls, [
    [12, null, "no_show", { applyToAll: true }, 7],
    [12, null, "no_show", { applyToAll: true }, null]
  ]);
});

test("cancelDay validates the date and reports how many were cancelled", async () => {
  const service = createSessionsService({
    async cancelDay(sessionDate) {
      return sessionDate === "2026-06-15" ? [11, 12, 13] : [];
    }
  });

  assert.deepEqual(await service.cancelDay({ sessionDate: "2026-06-15" }, TRAINER), {
    sessionDate: "2026-06-15",
    cancelled: 3,
    sessionIds: [11, 12, 13]
  });

  for (const input of [{}, { sessionDate: "15-06-2026" }, { sessionDate: "2026-06-31" }]) {
    await assert.rejects(service.cancelDay(input, TRAINER), (error) => error.status === 400);
  }
});

test("refuses to run any session call without an acting trainer", async () => {
  // Reading an absent scope as "no restriction" would hand one trainer the
  // whole business, so it has to fail loudly instead.
  const service = createSessionsService({
    async findWeek() {
      throw new Error("the repository must never be reached");
    },
    async cancelDay() {
      throw new Error("the repository must never be reached");
    }
  });

  for (const call of [
    () => service.listWeek("2026-06-15"),
    () => service.getSession(12),
    () => service.cancelDay({ sessionDate: "2026-06-15" }),
    () => service.cancel(12),
    () => service.recordOutcome(12, {}, "completed")
  ]) {
    await assert.rejects(call, (error) => error.status === 401);
  }
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
    service.recordOutcome(12, {}, "completed", TRAINER),
    (error) => error instanceof AppError && error.status === 409
  );
});
