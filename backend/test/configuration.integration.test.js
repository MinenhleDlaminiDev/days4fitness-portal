import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createConfigurationRepository } from "../src/repositories/configuration.repository.js";
import { createConfigurationService as createUnboundConfigurationService } from "../src/services/configuration.service.js";
import { addMonths, daysFromToday, upcomingMonday } from "./helpers/dates.js";
import {
  actorFor,
  ensureTestTrainer,
  OWNER_SUBQUERY,
  settingsFor,
  withSettings
} from "./helpers/trainer.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Configuration integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

// Fixtures own their clients since AUTH-03, so the suite needs a trainer
// for them to belong to. Top-level await, so it is done before any test runs.
const owner = await ensureTestTrainer(testPool);
const repository = createConfigurationRepository(testPool);
const settings = settingsFor(testPool);
const resetSettings = () => settings.resetSettings();

// Configuration belongs to one trainer since AUTH-05, so every call names who
// is asking. This suite acts as the trainer its fixtures belong to.
const ACTOR_ARITY = {
  getConfiguration: 0,
  updatePricing: 1,
  updatePrograms: 1,
  updatePackageSizes: 1,
  updateBusinessHours: 1,
  updateSchedulingSettings: 1
};

function bindConfigurationActor(unbound, actor) {
  const bound = { ...unbound };
  for (const [name, arity] of Object.entries(ACTOR_ARITY)) {
    bound[name] = (...args) => {
      const padded = [...args];
      while (padded.length < arity) padded.push(undefined);
      return unbound[name](...padded, actor);
    };
  }
  return bound;
}

const unboundService = createUnboundConfigurationService(repository, withSettings(testPool));
const service = bindConfigurationActor(unboundService, actorFor(owner));

async function snapshot() {
  const [pricing, hours, settings] = await Promise.all([
    testPool.query("SELECT program_type, sessions_total, price FROM package_pricing"),
    testPool.query("SELECT day_of_week, start_time FROM business_hours WHERE trainer_user_id = $1", [
      owner.id
    ]),
    testPool.query(
      `SELECT group_capacity, session_duration_minutes, package_expiry_months
       FROM scheduling_settings WHERE trainer_user_id = $1`,
      [owner.id]
    )
  ]);
  return { pricing: pricing.rows, hours: hours.rows, settings: settings.rows[0] };
}

async function restore(saved) {
  const client = await testPool.connect();
  try {
    await client.query("BEGIN");
    for (const row of saved.pricing) {
      await client.query(
        `UPDATE package_pricing SET price = $3
         WHERE program_type = $1 AND sessions_total = $2`,
        [row.program_type, row.sessions_total, row.price]
      );
    }
    await client.query("DELETE FROM business_hours WHERE trainer_user_id = $1", [owner.id]);
    for (const row of saved.hours) {
      await client.query(
        "INSERT INTO business_hours (trainer_user_id, day_of_week, start_time) VALUES ($1, $2, $3)",
        [owner.id, row.day_of_week, row.start_time]
      );
    }
    await client.query(
      `UPDATE scheduling_settings
       SET group_capacity = $2, session_duration_minutes = $3, package_expiry_months = $4
       WHERE trainer_user_id = $1`,
      [
        owner.id,
        saved.settings.group_capacity,
        saved.settings.session_duration_minutes,
        saved.settings.package_expiry_months
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  resetSettings();
}

after(async () => {
  await testPool.end();
});

test("seeds the configuration tables with the values that were hardcoded", async () => {
  const configuration = await service.getConfiguration();
  try {
    assert.deepEqual(configuration.packageSizes, [1, 4, 8, 12, 16]);
    assert.deepEqual(
      configuration.businessHours.map((entry) => entry.day),
      ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    );
    const monday = configuration.businessHours[0];
    assert.equal(monday.timeSlots.length, 15);
    assert.equal(monday.timeSlots[0], "05:00");
    assert.equal(monday.timeSlots.at(-1), "19:00");
    const saturday = configuration.businessHours.at(-1);
    assert.deepEqual(saturday.timeSlots, ["05:00", "06:00", "07:00", "08:00", "09:00", "10:00"]);
    assert.equal(configuration.packageExpiryMonths, 2);
  } finally {
    resetSettings();
  }
});

test("round-trips a price change", async () => {
  const saved = await snapshot();
  try {
    const updated = await service.updatePricing({
      pricing: [{ sessionType: "One-on-One", sessionsTotal: 4, price: 1999.5 }]
    });
    const entry = updated.pricing.find(
      (row) => row.sessionType === "One-on-One" && row.sessionsTotal === 4
    );
    assert.equal(entry.price, 1999.5);
  } finally {
    await restore(saved);
  }
});

test("replaces the whole week of business hours atomically", async () => {
  const saved = await snapshot();
  try {
    const updated = await service.updateBusinessHours({
      businessHours: [
        { day: "Monday", timeSlots: ["06:00", "18:00"] },
        { day: "Saturday", timeSlots: ["08:00"] }
      ]
    });
    assert.deepEqual(
      updated.businessHours.map((entry) => entry.day),
      ["Monday", "Saturday"]
    );
    assert.deepEqual(updated.businessHours[0].timeSlots, ["06:00", "18:00"]);

    // A rejected payload must leave the previous week untouched.
    await assert.rejects(
      service.updateBusinessHours({
        businessHours: [{ day: "Monday", timeSlots: ["07:00", "25:00"] }]
      }),
      (error) => error.status === 400
    );
    const after = await service.getConfiguration();
    assert.deepEqual(after.businessHours[0].timeSlots, ["06:00", "18:00"]);
  } finally {
    await restore(saved);
  }
});

test("the package expiry trigger follows the configured window", async () => {
  const saved = await snapshot();
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ('Expiry Window', '+27 82 555 0199', $1, ${OWNER_SUBQUERY})
     RETURNING id`,
    [`expiry-window-${Date.now()}@example.com`]
  );
  const clientId = clientResult.rows[0].id;
  const programResult = await testPool.query(
    `SELECT id FROM programs
     WHERE type = 'one_on_one' AND trainer_user_id = (SELECT id FROM trainer_users ORDER BY id LIMIT 1)
     ORDER BY id LIMIT 1`
  );
  const purchaseDate = daysFromToday(0);

  try {
    await service.updateSchedulingSettings({ packageExpiryMonths: 3 });

    // Two months is now the wrong answer...
    await assert.rejects(
      testPool.query(
        `INSERT INTO packages (client_id, program_id, sessions_total, price, purchase_date, expiry_date)
         VALUES ($1, $2, 4, 1200, $3::date, $4::date)`,
        [clientId, programResult.rows[0].id, purchaseDate, addMonths(purchaseDate, 2)]
      ),
      /packages_configured_expiry_check/
    );

    // ...and three months is accepted.
    await testPool.query(
      `INSERT INTO packages (client_id, program_id, sessions_total, price, purchase_date, expiry_date)
       VALUES ($1, $2, 4, 1200, $3::date, $4::date)`,
      [clientId, programResult.rows[0].id, purchaseDate, addMonths(purchaseDate, 3)]
    );
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [clientId]);
    await restore(saved);
  }
});

test("adds a package size, prices it at zero, and protects sold sizes", async () => {
  const saved = await snapshot();
  const originalSizes = saved.pricing
    .map((row) => row.sessions_total)
    .filter((size, index, all) => all.indexOf(size) === index)
    .sort((a, b) => a - b);

  try {
    const updated = await service.updatePackageSizes({
      packageSizes: [...originalSizes, 6]
    });
    assert.ok(updated.packageSizes.includes(6), "the new size is offered");
    const seeded = updated.pricing.filter((row) => row.sessionsTotal === 6);
    assert.equal(seeded.length, 2, "both session types get a price row");
    assert.deepEqual(
      seeded.map((row) => row.price),
      [0, 0]
    );

    // Removing an unsold size is allowed and clears its prices with it.
    const removed = await service.updatePackageSizes({ packageSizes: originalSizes });
    assert.equal(removed.packageSizes.includes(6), false);
    assert.equal(removed.pricing.some((row) => row.sessionsTotal === 6), false);

    // A size this trainer's own clients bought is protected by the
    // package_sizes_protect_sold trigger. Another trainer selling that size is
    // deliberately no obstacle, which is why this asks about their clients.
    const sold = await testPool.query(
      `SELECT DISTINCT package.sessions_total
       FROM packages package
       JOIN clients client ON client.id = package.client_id
       WHERE client.trainer_user_id = $1
       ORDER BY package.sessions_total
       LIMIT 1`,
      [owner.id]
    );
    if (sold.rows.length > 0) {
      const soldSize = sold.rows[0].sessions_total;
      await assert.rejects(
        service.updatePackageSizes({
          packageSizes: originalSizes.filter((size) => size !== soldSize)
        }),
        (error) => error.status === 409
      );
      // The failed removal left the catalogue untouched.
      const after = await service.getConfiguration();
      assert.ok(after.packageSizes.includes(soldSize));
    }
  } finally {
    // Put the catalogue back first: restore() rewrites prices for sizes that
    // must already exist.
    await service.updatePackageSizes({ packageSizes: originalSizes });
    await restore(saved);
  }
});

test("adds, renames and removes programs while protecting ones in use", async () => {
  const before = await service.getConfiguration();
  const keep = before.programs.map((program) => ({
    id: program.id,
    name: program.name,
    sessionType: program.sessionType
  }));

  try {
    const added = await service.updatePrograms({
      programs: [...keep, { name: "Integration Boxing", sessionType: "Group" }]
    });
    const created = added.programs.find((program) => program.name === "Integration Boxing");
    assert.ok(created, "the new program is offered");
    assert.equal(created.sessionType, "Group");

    // A rename keeps the same row, so anything pointing at it follows along.
    const renamed = await service.updatePrograms({
      programs: [...keep, { id: created.id, name: "Integration Kickboxing", sessionType: "Group" }]
    });
    const afterRename = renamed.programs.find((program) => program.id === created.id);
    assert.equal(afterRename.name, "Integration Kickboxing");
    assert.equal(
      renamed.programs.some((program) => program.name === "Integration Boxing"),
      false
    );

    // Leaving an unused program out of the list removes it.
    const removed = await service.updatePrograms({ programs: keep });
    assert.equal(
      removed.programs.some((program) => program.id === created.id),
      false
    );

    // A program with this trainer's packages on it is held down by
    // packages_program_id_fkey. Programs belong to one trainer since AUTH-10,
    // so this has to be one of theirs to be in `keep` at all.
    const sold = await testPool.query(
      `SELECT DISTINCT package.program_id
       FROM packages package
       JOIN clients client ON client.id = package.client_id
       WHERE client.trainer_user_id = $1
       ORDER BY package.program_id
       LIMIT 1`,
      [owner.id]
    );
    if (sold.rows.length > 0) {
      const soldId = Number(sold.rows[0].program_id);
      const soldProgram = keep.find((program) => Number(program.id) === soldId);
      await assert.rejects(
        service.updatePrograms({
          programs: keep.filter((program) => Number(program.id) !== soldId)
        }),
        (error) => error.status === 409 && error.message.includes(soldProgram.name)
      );
      // The refused removal left the catalogue exactly as it was.
      const after = await service.getConfiguration();
      assert.ok(after.programs.some((program) => Number(program.id) === soldId));
    }
  } finally {
    await service.updatePrograms({ programs: keep });
    resetSettings();
  }
});

test("two trainers keep their own hours, length and expiry window", async () => {
  // AUTH-05. Both plain trainers: this is about settings being separate, not
  // about what an admin may see.
  const alice = await ensureTestTrainer(testPool, {
    email: "alice-config@days4fitness.test",
    role: "trainer"
  });
  const bob = await ensureTestTrainer(testPool, {
    email: "bob-config@days4fitness.test",
    role: "trainer"
  });
  const hers = bindConfigurationActor(unboundService, actorFor(alice));
  const his = bindConfigurationActor(unboundService, actorFor(bob));

  // Migration 023 seeds every trainer with the same starting week, so they
  // begin identical and only diverge because one of them saves.
  const before = await his.getConfiguration();
  assert.equal(before.businessHours[0].timeSlots[0], "05:00");
  assert.equal(before.sessionDurationMinutes, 60);

  await hers.updateBusinessHours({
    businessHours: [{ day: "Monday", timeSlots: ["06:00", "07:00"] }]
  });
  await hers.updateSchedulingSettings({ sessionDurationMinutes: 45, packageExpiryMonths: 6 });

  const herConfiguration = await hers.getConfiguration();
  assert.deepEqual(
    herConfiguration.businessHours.map((entry) => entry.day),
    ["Monday"]
  );
  assert.deepEqual(herConfiguration.businessHours[0].timeSlots, ["06:00", "07:00"]);
  assert.equal(herConfiguration.sessionDurationMinutes, 45);
  assert.equal(herConfiguration.packageExpiryMonths, 6);

  // His week is exactly as it was. A shared table with a forgotten predicate
  // would have cleared it.
  const hisConfiguration = await his.getConfiguration();
  assert.deepEqual(hisConfiguration.businessHours, before.businessHours);
  assert.equal(hisConfiguration.sessionDurationMinutes, 60);
  assert.equal(hisConfiguration.packageExpiryMonths, before.packageExpiryMonths);

  // And what the booking rules read matches, for each of them, with no
  // further database read needed: saving refreshed only her entry.
  const herSettings = await settings.getSettings(alice.id);
  const hisSettings = await settings.getSettings(bob.id);
  assert.equal(herSettings.sessionDurationMinutes, 45);
  assert.equal(hisSettings.sessionDurationMinutes, 60);
  assert.deepEqual(herSettings.businessHours[0].timeSlots, ["06:00", "07:00"]);
  assert.equal(hisSettings.businessHours[0].timeSlots[0], "05:00");
});

test("a new trainer starts with a working week rather than an empty one", async () => {
  // Criterion 2: an empty settings screen is not just blank, it makes booking
  // impossible, so the trigger on trainer_users seeds every new account.
  const fresh = await ensureTestTrainer(testPool, {
    email: `fresh-${Date.now()}@days4fitness.test`,
    role: "trainer"
  });
  const theirs = bindConfigurationActor(unboundService, actorFor(fresh));

  const configuration = await theirs.getConfiguration();

  assert.deepEqual(
    configuration.businessHours.map((entry) => entry.day),
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  );
  assert.equal(configuration.businessHours[0].timeSlots.length, 15);
  assert.deepEqual(configuration.businessHours.at(-1).timeSlots, [
    "05:00",
    "06:00",
    "07:00",
    "08:00",
    "09:00",
    "10:00"
  ]);
  assert.equal(configuration.sessionDurationMinutes, 60);
  assert.equal(configuration.groupCapacity, 8);
  assert.equal(configuration.packageExpiryMonths, 2);

  // The rows are really there, not defaults standing in for missing ones.
  const rows = await testPool.query(
    "SELECT COUNT(*)::int AS slots FROM business_hours WHERE trainer_user_id = $1",
    [fresh.id]
  );
  assert.equal(rows.rows[0].slots, 81);
});

// UX-03. The refusal used to blame packages whatever was holding the program
// down, so a program with a recorded session sent the trainer looking for a
// package that did not exist.
//
// Only two of the five foreign keys are reachable on their own. A standing
// booking cannot be the sole cause: approved_recurring_bookings carries
// FOREIGN KEY (package_id, client_id, program_id) REFERENCES packages, so a
// booking on a program always comes with a package on that same program, and
// the packages key answers first.
test("a program that cannot be removed says what is actually holding it", async () => {
  const before = await service.getConfiguration();
  const keep = before.programs.map((program) => ({
    id: program.id,
    name: program.name,
    sessionType: program.sessionType
  }));
  const added = await service.updatePrograms({
    programs: [...keep, { name: "Integration Reasons", sessionType: "Group" }]
  });
  const target = added.programs.find((program) => program.name === "Integration Reasons");
  const removeTarget = () => service.updatePrograms({ programs: keep });

  // Far enough out to miss the other suites, which reach about +77 days.
  const sessionDate = upcomingMonday(91);
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let clientId = null;

  try {
    // A session recorded against it, with no package anywhere near it.
    const session = await testPool.query(
      `INSERT INTO sessions (
         program_id, session_type, session_date, start_time, capacity, status, trainer_user_id
       )
       VALUES ($1, 'group', $2::date, '13:00', 8, 'scheduled', $3)
       RETURNING id`,
      [target.id, sessionDate, owner.id]
    );
    await assert.rejects(removeTarget(), (error) => {
      assert.equal(error.status, 409);
      assert.match(error.message, /Integration Reasons/);
      assert.match(error.message, /sessions have been recorded against it/);
      return true;
    });
    await testPool.query("DELETE FROM sessions WHERE id = $1", [session.rows[0].id]);

    // A package on it, which is the one case the old sentence got right.
    const client = await testPool.query(
      `INSERT INTO clients (name, phone, email, trainer_user_id)
       VALUES ('Reason Client', '+27 82 555 0400', $1, $2)
       RETURNING id`,
      [`reason-${stamp}@example.com`, owner.id]
    );
    clientId = client.rows[0].id;
    const purchaseDate = daysFromToday(0);
    const window = await testPool.query(
      "SELECT package_expiry_months AS m FROM scheduling_settings WHERE trainer_user_id = $1",
      [owner.id]
    );
    await testPool.query(
      `INSERT INTO packages (
         client_id, program_id, sessions_total, price, purchase_date, expiry_date
       )
       VALUES ($1, $2, 4, 1000, $3::date, $4::date)`,
      [clientId, target.id, purchaseDate, addMonths(purchaseDate, window.rows[0].m)]
    );
    await assert.rejects(removeTarget(), (error) => {
      assert.match(error.message, /clients have packages on it/);
      return true;
    });
  } finally {
    if (clientId) await testPool.query("DELETE FROM clients WHERE id = $1", [clientId]);
    await testPool.query("DELETE FROM sessions WHERE session_date = $1::date AND trainer_user_id = $2", [
      sessionDate,
      owner.id
    ]);
    await service.updatePrograms({ programs: keep });
    resetSettings();
  }
});
