import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createSessionsRepository } from "../src/repositories/sessions.repository.js";
import { createSessionsService } from "../src/services/sessions.service.js";
import {
  addDays,
  addMonths,
  daysFromToday,
  isTrainingDay,
  upcomingMonday
} from "./helpers/dates.js";
import { businessToday, timezoneWhereLocalHourIs } from "./helpers/businessClock.js";
import {
  actorFor,
  bindSessionsActor,
  ensureTestTrainer,
  OWNER_SUBQUERY
} from "./helpers/trainer.js";

const { Pool } = pg;

// Every session fixture hangs off this Monday so the weekday of each offset is
// stable; `day(0)` is a Monday, `day(5)` a Saturday, and no offset lands on a
// Sunday, which the schema rejects.
const WEEK_ONE_MONDAY = upcomingMonday();
const day = (offset) => addDays(WEEK_ONE_MONDAY, offset);

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Session integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

// Fixtures own their clients since AUTH-03, so the suite needs a trainer
// for them to belong to. Top-level await, so it is done before any test runs.
const owner = await ensureTestTrainer(testPool);
// Every sessions service call takes the acting trainer since AUTH-04. Bound
// once here so the call sites below stay about scheduling.
const service = bindSessionsActor(
  createSessionsService(createSessionsRepository(testPool)),
  actorFor(owner)
);
const createdClientIds = [];

async function createClientPackage(suffix, options = {}) {
  const clientResult = await testPool.query(
    // options.ownerId is for the two-trainer tests; everything else belongs
    // to the suite's own trainer.
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, '+27 82 444 9000', $2, COALESCE($3::bigint, ${OWNER_SUBQUERY}))
     RETURNING id`,
    [
      `Phase 4 ${suffix}`,
      `phase4-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      options.ownerId || null
    ]
  );
  const clientId = clientResult.rows[0].id;
  createdClientIds.push(clientId);
  // Bought today, so the two-month window covers every fixture date below.
  const purchaseDate = options.purchaseDate || daysFromToday(0);
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
      purchaseDate,
      options.expiryDate || addMonths(purchaseDate, 2)
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
    sessionDate: day(0),
    startTime: "11:00"
  });
  const week = await service.listWeek(day(0));

  assert.equal(created.attendees[0].clientId, Number(client.clientId));
  assert.equal(created.status, "scheduled");
  assert.ok(week.some((session) => session.id === created.id));
});

test("cancels without consuming a credit and books one linked replacement", async () => {
  const client = await createClientPackage("replacement");
  const original = await service.createManual({
    clientId: client.clientId,
    sessionDate: day(1),
    startTime: "12:00"
  });

  const cancelled = await service.cancel(original.id);
  const replacement = await service.createReplacement(original.id, {
    sessionDate: day(3),
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
      sessionDate: day(4),
      startTime: "13:00"
    }),
    (error) => error.status === 409
  );
});

test("reschedules atomically and preserves the allocated credit", async () => {
  const client = await createClientPackage("reschedule");
  const original = await service.createManual({
    clientId: client.clientId,
    sessionDate: day(7),
    startTime: "14:00"
  });
  const replacement = await service.reschedule(original.id, {
    sessionDate: day(9),
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
    sessionDate: day(14),
    startTime: "16:00"
  });
  await testPool.query(
    `UPDATE sessions
     SET session_date = CASE
       WHEN EXTRACT(DOW FROM CURRENT_DATE) = 0 THEN CURRENT_DATE - INTERVAL '2 days'
       WHEN EXTRACT(DOW FROM CURRENT_DATE) = 1 THEN CURRENT_DATE - INTERVAL '3 days'
       ELSE CURRENT_DATE - INTERVAL '1 day'
     END
     WHERE id = $1`,
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
    sessionDate: day(16),
    startTime: "10:00"
  });
  await service.cancel(original.id);
  const existing = await service.createManual({
    clientId: existingClient.clientId,
    sessionDate: day(18),
    startTime: "10:00"
  });
  const replacement = await service.createReplacement(original.id, {
    sessionDate: day(18),
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
    sessionDate: day(15),
    startTime: "08:00"
  });
  const secondOriginal = await service.createManual({
    clientId: secondMovingClient.clientId,
    sessionDate: day(16),
    startTime: "08:00"
  });
  await service.cancel(firstOriginal.id);
  await service.cancel(secondOriginal.id);
  const existing = await service.createManual({
    clientId: existingClient.clientId,
    sessionDate: day(17),
    startTime: "08:00"
  });

  const firstReplacement = await service.createReplacement(firstOriginal.id, {
    sessionDate: day(17),
    startTime: "08:00"
  });
  const secondReplacement = await service.createReplacement(secondOriginal.id, {
    sessionDate: day(17),
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
    sessionDate: day(22),
    startTime: "09:00"
  });
  const existing = await service.createManual({
    clientId: existingClient.clientId,
    sessionDate: day(24),
    startTime: "10:00"
  });

  const replacement = await service.reschedule(original.id, {
    sessionDate: day(24),
    startTime: "10:00"
  });

  assert.equal(replacement.id, existing.id);
  assert.equal(replacement.rescheduledFromSessionId, original.id);
  assert.equal((await service.getSession(original.id)).status, "cancelled");
});

test("prevents bookings against expired and fully allocated packages", async () => {
  const expired = await createClientPackage("expired", {
    purchaseDate: daysFromToday(-180)
  });
  const exhausted = await createClientPackage("exhausted", { sessionsTotal: 1 });
  await service.createManual({
    clientId: exhausted.clientId,
    sessionDate: day(15),
    startTime: "17:00"
  });

  await assert.rejects(
    service.createManual({
      clientId: expired.clientId,
      sessionDate: day(15),
      startTime: "18:00"
    }),
    (error) => error.status === 409
  );
  await assert.rejects(
    service.createManual({
      clientId: exhausted.clientId,
      sessionDate: day(17),
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
      // Deliberately in the past, and still a Monday so the only rule it can
      // trip is the past-booking guard under test.
      sessionDate: day(-28),
      startTime: "08:00"
    }),
    (error) => error.status === 409
  );
});

test("enforces session timing for cancellation, rescheduling, and outcomes", async () => {
  const client = await createClientPackage("operation-timing");
  const futureSession = await service.createManual({
    clientId: client.clientId,
    sessionDate: day(21),
    startTime: "08:00"
  });

  await assert.rejects(
    service.recordOutcome(futureSession.id, { clientId: client.clientId }, "completed"),
    (error) => error.status === 409
  );

  // A session that has started but not ended can only exist today, and the
  // schema allows sessions Monday to Saturday only, so this branch is not
  // reachable on a Sunday — when the business is closed anyway.
  // The clock matters as well as the weekday: "half an hour ago" falls below
  // the 05:00 floor if the suite runs before 05:30, so the business timezone is
  // chosen rather than inherited. See helpers/businessClock.js.
  const businessTimezone = timezoneWhereLocalHourIs();
  const timedService = bindSessionsActor(
    createSessionsService(createSessionsRepository(testPool, { businessTimezone })),
    actorFor(owner)
  );

  if (isTrainingDay(await businessToday(testPool, businessTimezone))) {
    const startedSession = await service.createManual({
      clientId: client.clientId,
      sessionDate: day(22),
      startTime: "09:00"
    });
    await testPool.query(
      `UPDATE sessions
       SET
         session_date = (CURRENT_TIMESTAMP AT TIME ZONE $2)::date,
         start_time = (
           (CURRENT_TIMESTAMP AT TIME ZONE $2) - INTERVAL '30 minutes'
         )::time(0)
       WHERE id = $1`,
      [startedSession.id, businessTimezone]
    );
    await assert.rejects(
      timedService.recordOutcome(startedSession.id, { clientId: client.clientId }, "completed"),
      (error) => error.status === 409
    );
    const noShow = await timedService.recordOutcome(
      startedSession.id,
      { clientId: client.clientId },
      "no_show"
    );
    assert.equal(noShow.status, "no_show");
  }

  // A past Monday, so moving the session back never lands it on a Sunday the
  // way CURRENT_DATE - 3 would when the suite runs on a Wednesday.
  await testPool.query("UPDATE sessions SET session_date = $2 WHERE id = $1", [
    futureSession.id,
    day(-28)
  ]);
  await assert.rejects(
    service.cancel(futureSession.id),
    (error) => error.status === 409
  );
  await assert.rejects(
    service.reschedule(futureSession.id, {
      sessionDate: day(23),
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

test("books at the configured session length and blocks the slot it now covers", async () => {
  const client = await createClientPackage("configured-duration");
  const original = (
    await testPool.query(
      "SELECT session_duration_minutes FROM scheduling_settings WHERE id = 1"
    )
  ).rows[0].session_duration_minutes;

  try {
    await testPool.query(
      "UPDATE scheduling_settings SET session_duration_minutes = 90 WHERE id = 1"
    );

    const session = await service.createManual({
      clientId: client.clientId,
      sessionDate: day(28),
      startTime: "09:00"
    });

    const stored = await testPool.query(
      "SELECT duration_minutes FROM sessions WHERE id = $1",
      [session.id]
    );
    assert.equal(
      stored.rows[0].duration_minutes,
      90,
      "the configured length is persisted, not the column default"
    );

    // 09:00-10:30 now covers the 10:00 slot, which a 60-minute booking left free.
    const other = await createClientPackage("configured-duration-clash");
    await assert.rejects(
      service.createManual({
        clientId: other.clientId,
        sessionDate: day(28),
        startTime: "10:00"
      }),
      (error) => error.status === 409
    );

    // Training hours are whole hours, so with a 90-minute length the next
    // bookable start after 09:00 is 11:00, not 10:30.
    const after = await service.createManual({
      clientId: other.clientId,
      sessionDate: day(28),
      startTime: "11:00"
    });
    assert.equal(after.status, "scheduled");
  } finally {
    await testPool.query(
      "UPDATE scheduling_settings SET session_duration_minutes = $1 WHERE id = 1",
      [original]
    );
  }
});

test("marks a whole group in one request and leaves one credit used each", async () => {
  const first = await createClientPackage("bulk-group-first", { sessionType: "group" });
  const second = await createClientPackage("bulk-group-second", { sessionType: "group" });

  const session = await service.createManual({
    clientId: first.clientId,
    sessionDate: day(30),
    startTime: "07:00"
  });
  await service.createManual({
    clientId: second.clientId,
    sessionDate: day(30),
    startTime: "07:00"
  });

  // Without applyToAll a group still needs a clientId; that guard stands.
  await assert.rejects(
    service.recordOutcome(session.id, {}, "completed"),
    (error) => error.status === 409
  );

  await testPool.query(
    "UPDATE sessions SET session_date = $2 WHERE id = $1",
    [session.id, day(-28)]
  );

  const finished = await service.recordOutcome(session.id, { applyToAll: true }, "completed");

  assert.equal(finished.status, "completed");
  assert.equal(finished.attendees.length, 2);
  assert.ok(finished.attendees.every((attendee) => attendee.status === "completed"));

  for (const client of [first, second]) {
    const used = await testPool.query("SELECT sessions_used FROM packages WHERE id = $1", [
      client.packageId
    ]);
    assert.equal(used.rows[0].sessions_used, 1, "exactly one credit each");
  }
});

test("cancels a whole day at once and skips sessions already finished", async () => {
  const client = await createClientPackage("bulk-cancel");
  const target = day(31);

  const morning = await service.createManual({
    clientId: client.clientId,
    sessionDate: target,
    startTime: "06:00"
  });
  const midday = await service.createManual({
    clientId: client.clientId,
    sessionDate: target,
    startTime: "12:00"
  });
  const alreadyCancelled = await service.createManual({
    clientId: client.clientId,
    sessionDate: target,
    startTime: "15:00"
  });
  await service.cancel(alreadyCancelled.id);

  const result = await service.cancelDay({ sessionDate: target });

  assert.equal(result.cancelled, 2, "only the two still-scheduled sessions");
  assert.deepEqual(
    [...result.sessionIds].sort((a, b) => a - b),
    [morning.id, midday.id].sort((a, b) => a - b)
  );
  assert.equal((await service.getSession(morning.id)).status, "cancelled");
  assert.equal((await service.getSession(midday.id)).status, "cancelled");

  // Cancelling consumes no credits.
  const used = await testPool.query("SELECT sessions_used FROM packages WHERE id = $1", [
    client.packageId
  ]);
  assert.equal(used.rows[0].sessions_used, 0);

  // Running it again is a no-op rather than an error.
  assert.equal((await service.cancelDay({ sessionDate: target })).cancelled, 0);
});

test("a day cancel rolls back entirely when one session has already started", async () => {
  // A session can only have started if it is today, so this case only exists
  // on a training day. It also only exists mid-trading-day: "three hours from
  // now" breaches the 20:00 ceiling after 17:00 and "half an hour ago" breaches
  // the 05:00 floor before 05:30, which used to make this test fail every
  // evening. The business timezone is chosen so both land inside the window
  // whatever time the suite runs. See helpers/businessClock.js.
  const businessTimezone = timezoneWhereLocalHourIs();
  const timedService = bindSessionsActor(
    createSessionsService(createSessionsRepository(testPool, { businessTimezone })),
    actorFor(owner)
  );
  const today = await businessToday(testPool, businessTimezone);
  if (!isTrainingDay(today)) return;

  const client = await createClientPackage("bulk-cancel-rollback");

  const started = await service.createManual({
    clientId: client.clientId,
    sessionDate: day(35), // a Monday: day(33) is a Saturday, which closes at 10:00
    startTime: "06:00"
  });
  const later = await service.createManual({
    clientId: client.clientId,
    sessionDate: day(35), // a Monday: day(33) is a Saturday, which closes at 10:00
    startTime: "19:00"
  });

  // Move both onto today, one of them half an hour ago.
  await testPool.query(
    `UPDATE sessions
     SET session_date = $2::date,
         start_time = ((CURRENT_TIMESTAMP AT TIME ZONE $3) - INTERVAL '30 minutes')::time(0)
     WHERE id = $1`,
    [started.id, today, businessTimezone]
  );
  await testPool.query(
    `UPDATE sessions
     SET session_date = $2::date,
         start_time = ((CURRENT_TIMESTAMP AT TIME ZONE $3) + INTERVAL '3 hours')::time(0)
     WHERE id = $1`,
    [later.id, today, businessTimezone]
  );

  await assert.rejects(
    timedService.cancelDay({ sessionDate: today }),
    (error) => error.status === 409
  );

  // Neither was cancelled: the whole day rolled back.
  assert.equal((await service.getSession(started.id)).status, "scheduled");
  assert.equal((await service.getSession(later.id)).status, "scheduled");
});

test("an attendee carries the newest goal they have not achieved yet", async () => {
  const client = await createClientPackage("goal");

  // Oldest first, so the newest active one is unambiguous. The achieved goal
  // is created last on purpose: recency must not beat being unfinished.
  await testPool.query(
    `INSERT INTO client_goals (client_id, goal, achieved_at, created_at)
     VALUES
       ($1, 'Lose 8kg', NULL, NOW() - INTERVAL '3 days'),
       ($1, 'Run a 10k', NULL, NOW() - INTERVAL '1 day'),
       ($1, 'Train three times a week', CURRENT_DATE, NOW())`,
    [client.clientId]
  );

  const created = await service.createManual({
    clientId: client.clientId,
    sessionDate: day(1),
    startTime: "12:00"
  });
  assert.equal(created.attendees[0].goal, "Run a 10k");

  // The week listing carries it too, because the schedule reads that.
  const week = await service.listWeek(day(0));
  const listed = week.find((session) => session.id === created.id);
  assert.equal(listed.attendees[0].goal, "Run a 10k");

  // Achieving the last active goal leaves the attendee with none.
  await testPool.query("UPDATE client_goals SET achieved_at = CURRENT_DATE WHERE client_id = $1", [
    client.clientId
  ]);
  const afterAchieving = await service.listWeek(day(0));
  const refreshed = afterAchieving.find((session) => session.id === created.id);
  assert.equal(refreshed.attendees[0].goal, null);
});

// AUTH-04. Both plain trainers on purpose: an admin sees everything, so using
// one here would make these pass for the wrong reason. The week is anchored
// past day(28), the furthest any other test in this file reaches.
async function twoTrainers() {
  const alice = actorFor(
    await ensureTestTrainer(testPool, {
      email: "alice-sessions@days4fitness.test",
      role: "trainer"
    })
  );
  const bob = actorFor(
    await ensureTestTrainer(testPool, {
      email: "bob-sessions@days4fitness.test",
      role: "trainer"
    })
  );
  // Unbound, so every call has to name who is asking.
  const raw = createSessionsService(createSessionsRepository(testPool));
  return { alice, bob, raw };
}

test("two trainers can work the same hour but cannot touch each other's sessions", async () => {
  const { alice, bob, raw } = await twoTrainers();
  const hers = await createClientPackage("alice-slot", { ownerId: alice.id });
  const his = await createClientPackage("bob-slot", { ownerId: bob.id });
  const herOther = await createClientPackage("alice-double", { ownerId: alice.id });
  const slot = { sessionDate: day(35), startTime: "09:00" };

  // The whole point of the ticket: 09:00 for both of them is a normal day.
  const herSession = await raw.createManual({ clientId: hers.clientId, ...slot }, alice);
  const hisSession = await raw.createManual({ clientId: his.clientId, ...slot }, bob);
  assert.notEqual(herSession.id, hisSession.id);
  assert.equal(herSession.trainerId, Number(alice.id));
  assert.equal(hisSession.trainerId, Number(bob.id));

  // One trainer twice in the same hour is still a clash.
  await assert.rejects(
    () => raw.createManual({ clientId: herOther.clientId, ...slot }, alice),
    (error) => error.status === 409
  );

  // The schedule shows each of them only their own.
  const herWeek = await raw.listWeek(day(35), alice);
  assert.ok(herWeek.some((session) => session.id === herSession.id));
  assert.ok(
    !herWeek.some((session) => session.id === hisSession.id),
    "Alice must not see Bob's session in her week"
  );

  // Every id-addressed way in has to refuse, and as missing rather than
  // forbidden: a 403 would confirm the session exists.
  await assert.rejects(() => raw.getSession(hisSession.id, alice), { status: 404 });
  await assert.rejects(() => raw.cancel(hisSession.id, alice), { status: 404 });
  await assert.rejects(
    () => raw.reschedule(hisSession.id, { sessionDate: day(36), startTime: "09:00" }, alice),
    { status: 404 }
  );
  await assert.rejects(
    () =>
      raw.createReplacement(
        hisSession.id,
        { sessionDate: day(36), startTime: "09:00" },
        alice
      ),
    { status: 404 }
  );
  await assert.rejects(() => raw.recordOutcome(hisSession.id, {}, "completed", alice), {
    status: 404
  });
  // Booking for somebody else's client reads as a missing client.
  await assert.rejects(
    () =>
      raw.createManual(
        { clientId: his.clientId, sessionDate: day(36), startTime: "10:00" },
        alice
      ),
    { status: 404 }
  );

  // None of that changed anything.
  const stillHis = await raw.getSession(hisSession.id, bob);
  assert.equal(stillHis.status, "scheduled");
  assert.equal(stillHis.startTime, "09:00");
  assert.equal(stillHis.attendees.length, 1);
});

test("a trainer clearing their own day leaves the other trainer's day alone", async () => {
  const { alice, bob, raw } = await twoTrainers();
  const hers = await createClientPackage("alice-day", { ownerId: alice.id });
  const his = await createClientPackage("bob-day", { ownerId: bob.id });
  const slot = { sessionDate: day(37), startTime: "11:00" };

  const herSession = await raw.createManual({ clientId: hers.clientId, ...slot }, alice);
  const hisSession = await raw.createManual({ clientId: his.clientId, ...slot }, bob);

  const cleared = await raw.cancelDay({ sessionDate: day(37) }, alice);

  assert.deepEqual(cleared.sessionIds, [herSession.id]);
  assert.equal(cleared.cancelled, 1);
  assert.equal((await raw.getSession(herSession.id, alice)).status, "cancelled");
  assert.equal((await raw.getSession(hisSession.id, bob)).status, "scheduled");
});

test("a session cannot hold a client who belongs to another trainer", async () => {
  // The database backstop. The service checks ownership before every write,
  // but the session's trainer is derived from its people, so the two must not
  // be able to drift apart whatever reaches the table.
  const { alice, bob, raw } = await twoTrainers();
  const hers = await createClientPackage("alice-trigger", { ownerId: alice.id });
  const his = await createClientPackage("bob-trigger", { ownerId: bob.id });
  const herSession = await raw.createManual(
    { clientId: hers.clientId, sessionDate: day(37), startTime: "14:00" },
    alice
  );

  await assert.rejects(
    testPool.query(
      `INSERT INTO session_attendance (session_id, client_id, package_id)
       VALUES ($1, $2, $3)`,
      [herSession.id, his.clientId, his.packageId]
    ),
    (error) => error.code === "23514"
  );
});
