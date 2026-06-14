import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createClientsRepository } from "../src/repositories/clients.repository.js";
import { createClientsService } from "../src/services/clients.service.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const service = createClientsService(createClientsRepository(testPool));

after(async () => {
  await testPool.end();
});

test("creates and reads a client through the PostgreSQL repository", async () => {
  const email = `integration-${Date.now()}@example.com`;

  try {
    const created = await service.createClient({
      name: "Integration Client",
      phone: "+27 82 999 0000",
      email,
      program: "Weight Loss",
      sessionType: "One-on-One",
      packageSize: 4,
      purchaseDate: "2026-06-14",
      paid: false
    });

    const stored = await service.getClient(created.id);
    const packageResult = await testPool.query(
      `SELECT
         sessions_total,
         paid,
         purchase_date::text AS purchase_date,
         expiry_date::text AS expiry_date
       FROM packages
       WHERE client_id = $1`,
      [created.id]
    );

    assert.equal(stored.email, email);
    assert.deepEqual(stored.preferredDays, []);
    assert.equal(stored.purchaseDate, "2026-06-14");
    assert.equal(stored.expiryDate, "2026-08-14");
    assert.equal(packageResult.rows[0].sessions_total, 4);
    assert.equal(packageResult.rows[0].paid, false);
    assert.equal(packageResult.rows[0].purchase_date, "2026-06-14");
    assert.equal(packageResult.rows[0].expiry_date, "2026-08-14");
  } finally {
    await testPool.query("DELETE FROM clients WHERE email = $1", [email]);
  }
});
