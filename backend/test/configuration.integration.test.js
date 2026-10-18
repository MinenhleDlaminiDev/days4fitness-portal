import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { resetSettings } from "../src/config/settingsCache.js";
import { createConfigurationRepository } from "../src/repositories/configuration.repository.js";
import { createConfigurationService } from "../src/services/configuration.service.js";
import { addMonths, daysFromToday } from "./helpers/dates.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Configuration integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const repository = createConfigurationRepository(testPool);
const service = createConfigurationService(repository);

async function snapshot() {
  const [pricing, hours, settings] = await Promise.all([
    testPool.query("SELECT program_type, sessions_total, price FROM package_pricing"),
    testPool.query("SELECT day_of_week, start_time FROM business_hours"),
    testPool.query(
      `SELECT group_capacity, session_duration_minutes, package_expiry_months
       FROM scheduling_settings WHERE id = 1`
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
    await client.query("DELETE FROM business_hours");
    for (const row of saved.hours) {
      await client.query(
        "INSERT INTO business_hours (day_of_week, start_time) VALUES ($1, $2)",
        [row.day_of_week, row.start_time]
      );
    }
    await client.query(
      `UPDATE scheduling_settings
       SET group_capacity = $1, session_duration_minutes = $2, package_expiry_months = $3
       WHERE id = 1`,
      [
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
    `INSERT INTO clients (name, phone, email)
     VALUES ('Expiry Window', '+27 82 555 0199', $1)
     RETURNING id`,
    [`expiry-window-${Date.now()}@example.com`]
  );
  const clientId = clientResult.rows[0].id;
  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
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

    // A size that a package was sold at is protected by the foreign key.
    const sold = await testPool.query(
      "SELECT DISTINCT sessions_total FROM packages ORDER BY sessions_total LIMIT 1"
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
