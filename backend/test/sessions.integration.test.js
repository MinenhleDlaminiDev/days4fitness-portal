import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createSessionsRepository } from "../src/repositories/sessions.repository.js";
import { createSessionsService } from "../src/services/sessions.service.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Session integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const service = createSessionsService(createSessionsRepository(testPool));
const createdClientIds = [];

async function createClientPackage(suffix, options = {}) {
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ($1, '+27 82 444 9000', $2)
     RETURNING id`,
    [
      `Phase 4 ${suffix}`,
      `phase4-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`
    ]
  );
  const clientId = clientResult.rows[0].id;
  createdClientIds.push(clientId);
  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = $1 ORDER BY id LIMIT 1",
    [options.sessionType || "one_on_one"]
  );
  const packageResult = await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       sessions_used,
       price,
       paid,
       purchase_date,
       expiry_date
     )
     VALUES ($1, $2, $3, $4, 1520, true, $5::date, $6::date)
     RETURNING id`,
    [
      clientId,
      programResult.rows[0].id,
      options.sessionsTotal || 4,
      options.sessionsUsed || 0,
      options.purchaseDate || "2026-06-01",
      options.expiryDate || "2026-08-01"
    ]
  );
  return { clientId, packageId: packageResult.rows[0].id };
}

afterEach(async () => {
  if (createdClientIds.length > 0) {
    await testPool.query("DELETE FROM clients WHERE id = ANY($1::bigint[])", [createdClientIds]);
    createdClientIds.length = 0;
  }
  await testPool.query(
    `DELETE FROM sessions session
     WHERE NOT EXISTS (
       SELECT 1 FROM session_attendance attendance WHERE attendance.session_id = session.id
     )`
  );
});

after(async () => {
  await testPool.end();
});

test("books a manual session and returns it in the requested week", async () => {
  const client = await createClientPackage("manual");

  const created = await service.createManual({
    clientId: client.clientId,
    sessionDate: "2026-07-06",
    startTime: "11:00"
  });
  const week = await service.listWeek("2026-07-06");

  assert.equal(created.attendees[0].clientId, Number(client.clientId));
  assert.equal(created.status, "scheduled");
  assert.ok(week.some((session) => session.id === created.id));
});

test("cancels without consuming a credit and books one linked replacement", async () => {
  const client = await createClientPackage("replacement");
  const original = await service.createManual({
    clientId: client.clientId,
    sessionDate: "2026-07-07",
    startTime: "12:00"
  });

  const cancelled = await service.cancel(original.id);
  const replacement = await service.createReplacement(original.id, {
    sessionDate: "2026-07-09",
    startTime: "13:00"
  });
  const packageResult = await testPool.query(
    "SELECT sessions_used FROM packages WHERE id = $1",
    [client.packageId]
  );

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.attendees[0].creditConsumed, false);
  assert.equal(replacement.rescheduledFromSessionId, original.id);
  assert.equal(packageResult.rows[0].sessions_used, 0);
  await assert.rejects(
    service.createReplacement(original.id, {
      sessionDate: "2026-07-10",
      startTime: "13:00"
    }),
    (error) => error.status === 409
  );
});

test("reschedules atomically and preserves the allocated credit", async () => {
  const client = await createClientPackage("reschedule");
  const original = await service.createManual({
    clientId: client.clientId,
    sessionDate: "2026-07-13",
    startTime: "14:00"
  });
  const replacement = await service.reschedule(original.id, {
    sessionDate: "2026-07-15",
    startTime: "15:00"
  });
  const originalRow = await service.getSession(original.id);

  assert.equal(originalRow.status, "cancelled");
  assert.equal(replacement.rescheduledFromSessionId, original.id);
  assert.equal(replacement.attendees[0].clientId, Number(client.clientId));
});

test("simultaneous completion attempts consume exactly one package credit", async () => {
  const client = await createClientPackage("concurrent-complete");
  const session = await service.createManual({
    clientId: client.clientId,
    sessionDate: "2026-07-20",
    startTime: "16:00"
  });
  await testPool.query(
    "UPDATE sessions SET session_date = CURRENT_DATE - 3 WHERE id = $1",
    [session.id]
  );

  const results = await Promise.allSettled([
    service.recordOutcome(session.id, { clientId: client.clientId }, "completed"),
    service.recordOutcome(session.id, { clientId: client.clientId }, "completed")
  ]);
  const packageResult = await testPool.query(
    "SELECT sessions_used FROM packages WHERE id = $1",
    [client.packageId]
  );

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(packageResult.rows[0].sessions_used, 1);
});

test("group replacements join an existing compatible session", async () => {
  const replacementClient = await createClientPackage("group-replacement", {
    sessionType: "group"
  });
  const existingClient = await createClientPackage("group-existing", { sessionType: "group" });
  const original = await service.createManual({
    clientId: replacementClient.clientId,
    sessionDate: "2026-07-22",
    startTime: "10:00"
  });
  await service.cancel(original.id);
  const existing = await service.createManual({
    clientId: existingClient.clientId,
    sessionDate: "2026-07-24",
    startTime: "10:00"
  });
  const replacement = await service.createReplacement(original.id, {
    sessionDate: "2026-07-24",
    startTime: "10:00"
  });

  assert.equal(replacement.id, existing.id);
  assert.equal(replacement.rescheduledFromSessionId, original.id);
  assert.deepEqual(
    replacement.attendees.map((attendee) => attendee.clientId).sort((a, b) => a - b),
    [Number(replacementClient.clientId), Number(existingClient.clientId)].sort((a, b) => a - b)
  );
});

test("multiple group replacements can join the same existing session independently", async () => {
  const firstMovingClient = await createClientPackage("group-replacement-first", {
    sessionType: "group"
  });
  const secondMovingClient = await createClientPackage("group-replacement-second", {
    sessionType: "group"
  });
  const existingClient = await createClientPackage("group-replacement-host", {
    sessionType: "group"
  });
  const firstOriginal = await service.createManual({
    clientId: firstMovingClient.clientId,
    sessionDate: "2026-07-21",
    startTime: "08:00"
  });
  const secondOriginal = await service.createManual({
    clientId: secondMovingClient.clientId,
    sessionDate: "2026-07-22",
    startTime: "08:00"
  });
  await service.cancel(firstOriginal.id);
  await service.cancel(secondOriginal.id);
  const existing = await service.createManual({
    clientId: existingClient.clientId,
    sessionDate: "2026-07-23",
    startTime: "08:00"
  });

  const firstReplacement = await service.createReplacement(firstOriginal.id, {
    sessionDate: "2026-07-23",
    startTime: "08:00"
  });
  const secondReplacement = await service.createReplacement(secondOriginal.id, {
    sessionDate: "2026-07-23",
    startTime: "08:00"
  });
  const firstOriginalAfter = await service.getSession(firstOriginal.id);
  const secondOriginalAfter = await service.getSession(secondOriginal.id);

  assert.equal(firstReplacement.id, existing.id);
  assert.equal(secondReplacement.id, existing.id);
  assert.equal(firstOriginalAfter.replacementSessionId, existing.id);
  assert.equal(secondOriginalAfter.replacementSessionId, existing.id);
  assert.equal(secondReplacement.rescheduledFromSessionId, null);
  assert.equal(secondReplacement.attendees.length, 3);
});

test("group reschedules join an existing compatible session", async () => {
  const movingClient = await createClientPackage("group-reschedule", {
    sessionType: "group"
  });
  const existingClient = await createClientPackage("group-reschedule-existing", {
    sessionType: "group"
  });
  const original = await service.createManual({
    clientId: movingClient.clientId,
    sessionDate: "2026-07-28",
    startTime: "09:00"
  });
  const existing = await service.createManual({
    clientId: existingClient.clientId,
    sessionDate: "2026-07-30",
    startTime: "10:00"
  });

  const replacement = await service.reschedule(original.id, {
    sessionDate: "2026-07-30",
    startTime: "10:00"
  });

  assert.equal(replacement.id, existing.id);
  assert.equal(replacement.rescheduledFromSessionId, original.id);
  assert.equal((await service.getSession(original.id)).status, "cancelled");
});

test("prevents bookings against expired and fully allocated packages", async () => {
  const expired = await createClientPackage("expired", {
    purchaseDate: "2026-01-01",
    expiryDate: "2026-03-01"
  });
  const exhausted = await createClientPackage("exhausted", { sessionsTotal: 1 });
  await service.createManual({
    clientId: exhausted.clientId,
    sessionDate: "2026-07-21",
    startTime: "17:00"
  });

  await assert.rejects(
    service.createManual({
      clientId: expired.clientId,
      sessionDate: "2026-07-21",
      startTime: "18:00"
    }),
    (error) => error.status === 409
  );
  await assert.rejects(
    service.createManual({
      clientId: exhausted.clientId,
      sessionDate: "2026-07-23",
      startTime: "17:00"
    }),
    (error) => error.status === 409
  );
});

test("prevents manual bookings in the past", async () => {
  const client = await createClientPackage("past-session");

  await assert.rejects(
    service.createManual({
      clientId: client.clientId,
      sessionDate: "2026-06-08",
      startTime: "08:00"
    }),
    (error) => error.status === 409
  );
});

test("enforces session timing for cancellation, rescheduling, and outcomes", async () => {
  const client = await createClientPackage("operation-timing");
  const futureSession = await service.createManual({
    clientId: client.clientId,
    sessionDate: "2026-07-27",
    startTime: "08:00"
  });

  await assert.rejects(
    service.recordOutcome(futureSession.id, { clientId: client.clientId }, "completed"),
    (error) => error.status === 409
  );

  const startedSession = await service.createManual({
    clientId: client.clientId,
    sessionDate: "2026-07-28",
    startTime: "09:00"
  });
  await testPool.query(
    `UPDATE sessions
     SET
       session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Johannesburg')::date,
       start_time = (
         CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '30 minutes'
       )::time(0)
     WHERE id = $1`,
    [startedSession.id]
  );
  await assert.rejects(
    service.recordOutcome(startedSession.id, { clientId: client.clientId }, "completed"),
    (error) => error.status === 409
  );
  const noShow = await service.recordOutcome(
    startedSession.id,
    { clientId: client.clientId },
    "no_show"
  );
  assert.equal(noShow.status, "no_show");

  await testPool.query(
    "UPDATE sessions SET session_date = CURRENT_DATE - 3 WHERE id = $1",
    [futureSession.id]
  );
  await assert.rejects(
    service.cancel(futureSession.id),
    (error) => error.status === 409
  );
  await assert.rejects(
    service.reschedule(futureSession.id, {
      sessionDate: "2026-07-29",
      startTime: "08:00"
    }),
    (error) => error.status === 409
  );

  const completed = await service.recordOutcome(
    futureSession.id,
    { clientId: client.clientId },
    "completed"
  );
  assert.equal(completed.status, "completed");
});
