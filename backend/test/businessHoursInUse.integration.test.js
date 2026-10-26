// SCH-05. Removing a training hour used to be a plain delete-and-reinsert, so
// a session already booked in that hour stayed behind and vanished from the
// schedule, which draws its rows from these same business_hours rows. The hour
// is now refused while anything is booked in it, the way a sold program or
// package size is refused.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createConfigurationRepository } from "../src/repositories/configuration.repository.js";
import { createConfigurationService } from "../src/services/configuration.service.js";
import { addDays, addMonths, daysFromToday, upcomingMonday } from "./helpers/dates.js";
import { actorFor, ensureTestTrainer, programFor, withSettings } from "./helpers/trainer.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

// A Monday far enough out to miss the other suites: the sessions suite reaches
// about +31 days from its own anchor and the reports suite starts at +49.
const BOOKED_MONDAY = upcomingMonday(35);
const PAST_MONDAY = addDays(upcomingMonday(7), -28);
const BOOKED_TIME = "06:00";
const KEPT_TIME = "07:00";

const owner = await ensureTestTrainer(testPool);
// Created up front so the cleanup below can reach their sessions too.
const other = await ensureTestTrainer(testPool, {
  email: "hours-other@days4fitness.test",
  role: "trainer"
});
const service = createConfigurationService(
  createConfigurationRepository(testPool),
  withSettings(testPool)
);
const actor = actorFor(owner);

/**
 * Any session left on this suite's two dates, gone. A run that failed part way
 * through used to leave one behind, and it blocked the next test namelessly.
 */
async function purgeSuiteSessions() {
  await testPool.query(
    `DELETE FROM sessions
     WHERE session_date = ANY($1::date[]) AND trainer_user_id = ANY($2::bigint[])`,
    [
      [BOOKED_MONDAY, PAST_MONDAY],
      [owner.id, other.id]
    ]
  );
}

/** The hours this suite works with: one Monday with two slots. */
async function setHours() {
  await purgeSuiteSessions();
  await testPool.query("DELETE FROM business_hours WHERE trainer_user_id = $1", [owner.id]);
  await testPool.query(
    `INSERT INTO business_hours (trainer_user_id, day_of_week, start_time)
     VALUES ($1, 1, $2), ($1, 1, $3)`,
    [owner.id, BOOKED_TIME, KEPT_TIME]
  );
}

const removeBookedHour = () =>
  service.updateBusinessHours({ businessHours: [{ day: "Monday", timeSlots: [KEPT_TIME] }] }, actor);

async function currentHours() {
  const result = await testPool.query(
    `SELECT start_time::text AS start_time
     FROM business_hours WHERE trainer_user_id = $1 ORDER BY start_time`,
    [owner.id]
  );
  return result.rows.map((row) => row.start_time.slice(0, 5));
}

/**
 * A client with a package, for `trainerId`. The expiry window is read rather
 * than assumed, because the expiry trigger rejects anything else.
 */
async function clientWithPackage(trainerId, name) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const client = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, '+27 82 555 0300', $2, $3)
     RETURNING id`,
    [name, `hours-${stamp}@example.com`, trainerId]
  );
  const window = await testPool.query(
    "SELECT package_expiry_months FROM scheduling_settings WHERE trainer_user_id = $1",
    [trainerId]
  );
  const purchaseDate = daysFromToday(0);
  const programId = await programFor(testPool, trainerId, "one_on_one");
  const pkg = await testPool.query(
    `INSERT INTO packages (
       client_id, program_id, sessions_total, price, purchase_date, expiry_date
     )
     VALUES ($1, $2, 4, 1520, $3::date, $4::date)
     RETURNING id`,
    [
      client.rows[0].id,
      programId,
      purchaseDate,
      addMonths(purchaseDate, window.rows[0].package_expiry_months)
    ]
  );
  return { clientId: client.rows[0].id, packageId: pkg.rows[0].id, programId };
}

async function sessionAt(fixture, trainerId, { date, time, status = "scheduled" }) {
  const session = await testPool.query(
    `INSERT INTO sessions (
       program_id, session_type, session_date, start_time, capacity, status, trainer_user_id
     )
     VALUES ($1, 'one_on_one', $2::date, $3::time, 1, $4, $5)
     RETURNING id`,
    [fixture.programId, date, time, status, trainerId]
  );
  await testPool.query(
    `INSERT INTO session_attendance (session_id, client_id, package_id, status)
     VALUES ($1, $2, $3, $4)`,
    [session.rows[0].id, fixture.clientId, fixture.packageId, status === "cancelled" ? "cancelled" : "scheduled"]
  );
  return session.rows[0].id;
}

/**
 * Trainer 1's real hours, back immediately.
 *
 * This has to happen at the end of every test, not in `after()`. The
 * integration suites share one process and one database, so while this file
 * holds trainer 1 on a two-slot Monday, every file whose tests run later sees
 * it: restoring only in `after()` broke the first test of four other files.
 */
async function restoreHours() {
  await purgeSuiteSessions();
  await testPool.query("DELETE FROM business_hours WHERE trainer_user_id = $1", [owner.id]);
  for (const row of savedHours) {
    await testPool.query(
      `INSERT INTO business_hours (trainer_user_id, day_of_week, start_time)
       VALUES ($1, $2, $3::time)`,
      [owner.id, row.day_of_week, row.start_time]
    );
  }
}

async function cleanUp(clientIds) {
  // Deleting a client cascades its attendance and its recurring bookings but
  // NOT the sessions row, which has had no client column since AUTH-04. Left
  // behind, it became a nameless blocker in the next test — purgeSuiteSessions
  // inside restoreHours is what clears it.
  for (const id of clientIds) {
    await testPool.query("DELETE FROM clients WHERE id = $1", [id]);
  }
  await restoreHours();
}

// Trainer 1 is shared by every integration suite, so its hours have to come
// back exactly. Snapshotted rather than regenerated: the first version of this
// rebuilt Monday to Friday from a loop, dropped Saturday, and broke seven
// tests in other files.
const savedHours = (
  await testPool.query(
    `SELECT day_of_week, start_time::text AS start_time
     FROM business_hours WHERE trainer_user_id = $1`,
    [owner.id]
  )
).rows;

after(async () => {
  // Each test already restored the hours; this is a belt-and-braces sweep in
  // case one died before its finally ran.
  await restoreHours();
  await testPool.end();
});

test("an hour with a future session in it cannot be removed", async () => {
  await setHours();
  const fixture = await clientWithPackage(owner.id, "Hours Blocker");
  await sessionAt(fixture, owner.id, { date: BOOKED_MONDAY, time: BOOKED_TIME });

  try {
    await assert.rejects(removeBookedHour(), (error) => {
      assert.equal(error.status, 409);
      // The whole point of the ticket: the trainer can act on this without
      // hunting for which booking is in the way.
      assert.match(error.message, /Monday 06:00/);
      assert.match(error.message, /Hours Blocker/);
      assert.match(error.message, new RegExp(BOOKED_MONDAY));
      return true;
    });
    // Nothing saved: the hour being removed is still there, not half-written.
    assert.deepEqual(await currentHours(), [BOOKED_TIME, KEPT_TIME]);
  } finally {
    await cleanUp([fixture.clientId]);
  }
});

test("an hour with nothing booked in it is still removable", async () => {
  await setHours();
  try {
    const updated = await removeBookedHour();
    assert.deepEqual(updated.businessHours[0].timeSlots, [KEPT_TIME]);
    assert.deepEqual(await currentHours(), [KEPT_TIME]);
  } finally {
    await restoreHours();
  }
});

test("a past session does not block the hour", async () => {
  await setHours();
  const fixture = await clientWithPackage(owner.id, "Hours Past");
  await sessionAt(fixture, owner.id, { date: PAST_MONDAY, time: BOOKED_TIME });

  try {
    // A trainer narrowing hours they used to work must not be held up by
    // bookings that have already happened.
    await removeBookedHour();
    assert.deepEqual(await currentHours(), [KEPT_TIME]);
  } finally {
    await cleanUp([fixture.clientId]);
  }
});

test("a cancelled session does not block the hour", async () => {
  await setHours();
  const fixture = await clientWithPackage(owner.id, "Hours Cancelled");
  await sessionAt(fixture, owner.id, {
    date: BOOKED_MONDAY,
    time: BOOKED_TIME,
    status: "cancelled"
  });

  try {
    await removeBookedHour();
    assert.deepEqual(await currentHours(), [KEPT_TIME]);
  } finally {
    await cleanUp([fixture.clientId]);
  }
});

test("another trainer's session does not block this trainer's hour", async () => {
  await setHours();
  const fixture = await clientWithPackage(other.id, "Someone Else's Client");
  await sessionAt(fixture, other.id, { date: BOOKED_MONDAY, time: BOOKED_TIME });

  try {
    // Two trainers can work the same hour, so theirs is none of our business.
    await removeBookedHour();
    assert.deepEqual(await currentHours(), [KEPT_TIME]);
  } finally {
    await cleanUp([fixture.clientId]);
  }
});

test("an active recurring booking blocks the hour even with no session yet", async () => {
  await setHours();
  const fixture = await clientWithPackage(owner.id, "Recurring Blocker");
  await testPool.query(
    `INSERT INTO approved_recurring_bookings (
       client_id, package_id, program_id, session_type,
       day_of_week, start_time, starts_on, ends_on, status
     )
     VALUES ($1, $2, $3, 'one_on_one', 1, $4::time, $5::date, $6::date, 'active')`,
    [
      fixture.clientId,
      fixture.packageId,
      fixture.programId,
      BOOKED_TIME,
      BOOKED_MONDAY,
      addDays(BOOKED_MONDAY, 28)
    ]
  );

  try {
    // The allocator generates sessions from these and never looks at
    // business_hours, so an hour removed now would quietly refill itself.
    await assert.rejects(removeBookedHour(), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /Monday 06:00/);
      assert.match(error.message, /Recurring Blocker/);
      return true;
    });
    assert.deepEqual(await currentHours(), [BOOKED_TIME, KEPT_TIME]);
  } finally {
    await cleanUp([fixture.clientId]);
  }
});
