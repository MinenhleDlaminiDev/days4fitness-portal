import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createPackagesRepository } from "../src/repositories/packages.repository.js";
import { createPackagesService } from "../src/services/packages.service.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });
const service = createPackagesService(createPackagesRepository(testPool));

after(async () => {
  await testPool.end();
});

async function createClientAndPackage({ sessionsUsed = 0 } = {}) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`Package Client ${stamp}`, "+27 82 555 0101", `package-${stamp}@example.com`]
  );
  const programResult = await testPool.query(
    `SELECT id
     FROM programs
     WHERE name = 'Weight Loss' AND type = 'one_on_one'
     LIMIT 1`
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
     VALUES ($1, $2, 8, $3, 1600, false, '2026-06-15', '2026-08-15')
     RETURNING id`,
    [clientResult.rows[0].id, programResult.rows[0].id, sessionsUsed]
  );
  return {
    clientId: clientResult.rows[0].id,
    packageId: packageResult.rows[0].id
  };
}

test("records partial and full payments, then reverses without mutating history", async () => {
  const fixture = await createClientAndPackage();

  try {
    const first = await service.addPayment(fixture.packageId, {
      amount: 600,
      paymentDate: "2026-06-15",
      method: "eft",
      reference: "EFT-100"
    });
    let packages = await service.listClientPackages(fixture.clientId);
    assert.equal(packages[0].paymentStatus, "partially_paid");
    assert.equal(packages[0].paidAmount, 600);
    assert.equal(packages[0].outstandingBalance, 1000);

    await service.addPayment(fixture.packageId, {
      amount: 1000,
      paymentDate: "2026-06-16",
      method: "card"
    });
    packages = await service.listClientPackages(fixture.clientId);
    assert.equal(packages[0].paymentStatus, "paid");
    assert.equal(packages[0].outstandingBalance, 0);

    await service.reversePayment(first.id, {
      paymentDate: "2026-06-17",
      reference: "Correction"
    });
    packages = await service.listClientPackages(fixture.clientId);
    assert.equal(packages[0].paymentStatus, "partially_paid");
    assert.equal(packages[0].paidAmount, 1000);
    assert.equal(packages[0].payments.length, 3);

    await assert.rejects(
      service.reversePayment(first.id, {
        paymentDate: "2026-06-18"
      }),
      (error) => error.status === 409
    );
    await assert.rejects(
      testPool.query("UPDATE package_payments SET notes = 'changed' WHERE id = $1", [first.id]),
      /immutable/
    );
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [fixture.clientId]);
  }
});

test("prevents overpayment and active-package renewal", async () => {
  const fixture = await createClientAndPackage();

  try {
    await assert.rejects(
      service.addPayment(fixture.packageId, {
        amount: 1600.01,
        paymentDate: "2026-06-15",
        method: "cash"
      }),
      (error) => error.status === 409
    );
    await assert.rejects(
      service.createClientPackage(fixture.clientId, {
        program: "Weight Loss",
        sessionType: "One-on-One",
        sessionsTotal: 8,
        purchaseDate: "2026-06-15"
      }),
      (error) => error.status === 409
    );
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [fixture.clientId]);
  }
});

test("accepts an exact final payment after a decimal partial payment", async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ($1, '+27 82 555 0103', $2)
     RETURNING id`,
    [`Decimal Client ${stamp}`, `decimal-${stamp}@example.com`]
  );
  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = 'group' ORDER BY id LIMIT 1"
  );
  const packageResult = await testPool.query(
    `INSERT INTO packages (
       client_id,
       program_id,
       sessions_total,
       price,
       purchase_date,
       expiry_date
     )
     VALUES ($1, $2, 1, 250, '2026-06-15', '2026-08-15')
     RETURNING id`,
    [clientResult.rows[0].id, programResult.rows[0].id]
  );

  try {
    await service.addPayment(packageResult.rows[0].id, {
      amount: 16.17,
      paymentDate: "2026-06-15",
      method: "cash"
    });
    await service.addPayment(packageResult.rows[0].id, {
      amount: 233.83,
      paymentDate: "2026-06-16",
      method: "cash"
    });

    const packages = await service.listClientPackages(clientResult.rows[0].id);
    assert.equal(packages[0].paymentStatus, "paid");
    assert.equal(packages[0].paidAmount, 250);
    assert.equal(packages[0].outstandingBalance, 0);
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [clientResult.rows[0].id]);
  }
});

test("renews an exhausted package with an exact two-month expiry", async () => {
  const fixture = await createClientAndPackage({ sessionsUsed: 8 });

  try {
    const created = await service.createClientPackage(fixture.clientId, {
      program: "Weight Loss",
      sessionType: "One-on-One",
      sessionsTotal: 4,
      purchaseDate: "2026-06-30"
    });

    assert.equal(created.purchaseDate, "2026-06-30");
    assert.equal(created.expiryDate, "2026-08-30");
    assert.equal(created.paymentStatus, "unpaid");
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [fixture.clientId]);
  }
});

test("rejects packages that do not expire exactly two months after purchase", async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email)
     VALUES ($1, '+27 82 555 0102', $2)
     RETURNING id`,
    [`Expiry Client ${stamp}`, `expiry-${stamp}@example.com`]
  );
  const programResult = await testPool.query(
    "SELECT id FROM programs WHERE type = 'one_on_one' ORDER BY id LIMIT 1"
  );

  try {
    await assert.rejects(
      testPool.query(
        `INSERT INTO packages (
           client_id,
           program_id,
           sessions_total,
           price,
           purchase_date,
           expiry_date
         )
         VALUES ($1, $2, 4, 1200, '2026-06-15', '2026-08-16')`,
        [clientResult.rows[0].id, programResult.rows[0].id]
      ),
      /packages_exact_two_month_expiry_check/
    );
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [clientResult.rows[0].id]);
  }
});
