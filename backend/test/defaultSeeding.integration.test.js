// SET-08. The seeders used to insert anything missing, so a default a trainer
// had deliberately removed came back. They are once-per-trainer now, guarded by
// trainer_users.defaults_seeded_at (migration 026).
//
// This suite never touches the shared trainer 1: it makes its own trainers and
// removes them again. Trainer 1's configuration is relied on by several other
// files, and borrowing it is how an earlier suite broke seven of their tests.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

/** A trainer created fresh, so the seeding trigger actually fires for them. */
async function newTrainer(label) {
  const result = await testPool.query(
    `INSERT INTO trainer_users (email, name, role, password_hash)
     VALUES ($1, $2, 'trainer', 'not-a-real-hash')
     RETURNING id`,
    [`seed-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@days4fitness.test`, label]
  );
  return result.rows[0];
}

/**
 * The marker, read with its own SELECT.
 *
 * Not from the INSERT's RETURNING: the trigger sets it in an AFTER INSERT, and
 * RETURNING gives the row as the statement wrote it, before that runs. It comes
 * back null there even though the column is set.
 */
async function seededAt(trainerId) {
  const result = await testPool.query(
    "SELECT defaults_seeded_at FROM trainer_users WHERE id = $1",
    [trainerId]
  );
  return result.rows[0].defaults_seeded_at;
}

/** Nothing cascades from trainer_users, so their rows go first. */
async function removeTrainer(trainerId) {
  for (const table of [
    "package_pricing",
    "package_sizes",
    "programs",
    "business_hours",
    "scheduling_settings"
  ]) {
    await testPool.query(`DELETE FROM ${table} WHERE trainer_user_id = $1`, [trainerId]);
  }
  await testPool.query("DELETE FROM trainer_users WHERE id = $1", [trainerId]);
}

async function counts(trainerId) {
  const result = await testPool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM business_hours WHERE trainer_user_id = $1) AS hours,
       (SELECT COUNT(*)::int FROM programs WHERE trainer_user_id = $1) AS programs,
       (SELECT COUNT(*)::int FROM package_sizes WHERE trainer_user_id = $1) AS sizes,
       (SELECT COUNT(*)::int FROM package_pricing WHERE trainer_user_id = $1) AS prices,
       (SELECT COUNT(*)::int FROM scheduling_settings WHERE trainer_user_id = $1) AS settings`,
    [trainerId]
  );
  return result.rows[0];
}

const reseed = (trainerId) =>
  testPool.query("SELECT seed_trainer_scheduling($1), seed_trainer_catalogue($1)", [trainerId]);

after(async () => {
  await testPool.end();
});

test("a brand-new trainer still starts with the full set, and is marked seeded", async () => {
  const trainer = await newTrainer("fresh");
  try {
    assert.deepEqual(await counts(trainer.id), {
      hours: 81,
      programs: 5,
      sizes: 5,
      prices: 10,
      settings: 1
    });
    // The trigger sets the marker after both seeders, not inside either one:
    // whichever ran first would otherwise make the second skip its own work.
    assert.ok(await seededAt(trainer.id), "the trigger should have marked them seeded");
  } finally {
    await removeTrainer(trainer.id);
  }
});

test("seeding again leaves a trainer's own removals alone", async () => {
  const trainer = await newTrainer("removals");
  try {
    // What a trainer narrowing their hours and trimming their catalogue in
    // /settings actually does.
    await testPool.query(
      "DELETE FROM business_hours WHERE trainer_user_id = $1 AND day_of_week = 6",
      [trainer.id]
    );
    await testPool.query(
      "DELETE FROM business_hours WHERE trainer_user_id = $1 AND start_time >= '17:00'",
      [trainer.id]
    );
    await testPool.query(
      "DELETE FROM programs WHERE trainer_user_id = $1 AND name = 'Toning & Shaping'",
      [trainer.id]
    );
    await testPool.query(
      "DELETE FROM package_pricing WHERE trainer_user_id = $1 AND sessions_total = 16",
      [trainer.id]
    );
    await testPool.query(
      "DELETE FROM package_sizes WHERE trainer_user_id = $1 AND sessions_total = 16",
      [trainer.id]
    );
    const narrowed = await counts(trainer.id);

    await reseed(trainer.id);

    // Before SET-08 every one of these came back.
    assert.deepEqual(await counts(trainer.id), narrowed);
    const saturday = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM business_hours WHERE trainer_user_id = $1 AND day_of_week = 6",
      [trainer.id]
    );
    assert.equal(saturday.rows[0].c, 0, "Saturday was removed on purpose");
    const toning = await testPool.query(
      "SELECT COUNT(*)::int AS c FROM programs WHERE trainer_user_id = $1 AND name = 'Toning & Shaping'",
      [trainer.id]
    );
    assert.equal(toning.rows[0].c, 0, "that program was removed on purpose");
  } finally {
    await removeTrainer(trainer.id);
  }
});

test("a trainer with nothing seeded yet is filled, exactly once", async () => {
  const trainer = await newTrainer("unmarked");
  try {
    // Stripped back to how a pre-026 trainer could look: no configuration and
    // no marker. The guard reads the marker, not the rows, so this is the one
    // case where the seeders are still meant to do their work.
    for (const table of [
      "package_pricing",
      "package_sizes",
      "programs",
      "business_hours",
      "scheduling_settings"
    ]) {
      await testPool.query(`DELETE FROM ${table} WHERE trainer_user_id = $1`, [trainer.id]);
    }
    await testPool.query("UPDATE trainer_users SET defaults_seeded_at = NULL WHERE id = $1", [
      trainer.id
    ]);

    await reseed(trainer.id);
    assert.deepEqual(await counts(trainer.id), {
      hours: 81,
      programs: 5,
      sizes: 5,
      prices: 10,
      settings: 1
    });

    // Still unmarked, because only the trigger marks them. A second call does
    // the same work rather than erroring, which is the pre-026 behaviour and
    // is harmless on a trainer who has not customised anything.
    await reseed(trainer.id);
    assert.deepEqual((await counts(trainer.id)).hours, 81);
  } finally {
    await removeTrainer(trainer.id);
  }
});

test("every trainer already in the database is marked seeded", async () => {
  // Migration 026 backfilled them. An unmarked one would be re-seedable, which
  // is the whole thing this ticket closes.
  const unmarked = await testPool.query(
    "SELECT COUNT(*)::int AS c FROM trainer_users WHERE defaults_seeded_at IS NULL"
  );
  assert.equal(unmarked.rows[0].c, 0);
});
