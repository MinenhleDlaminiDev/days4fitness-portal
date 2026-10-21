import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createPackagesRepository } from "../src/repositories/packages.repository.js";
import { createPackagesService } from "../src/services/packages.service.js";
import { addDays, addMonths, daysFromToday } from "./helpers/dates.js";
import {
  actorFor,
  bindPackagesActor,
  ensureTestTrainer,
  OWNER_SUBQUERY
} from "./helpers/trainer.js";

const { Pool } = pg;

// Bought a week ago so every payment date below is in the past, while the
// two-month expiry still lands in the future. The expiry must be computed
// with addMonths because the packages_configured_expiry trigger is exact.
const PURCHASE_DATE = daysFromToday(-7);
const EXPIRY_DATE = addMonths(PURCHASE_DATE, 2);
const RENEWAL_PURCHASE_DATE = daysFromToday(-1);
const RENEWAL_EXPIRY_DATE = addMonths(RENEWAL_PURCHASE_DATE, 2);
const payday = (offset) => addDays(PURCHASE_DATE, offset);

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Integration tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

// Fixtures own their clients since AUTH-03, so the suite needs a trainer
// for them to belong to. Top-level await, so it is done before any test runs.
await ensureTestTrainer(testPool);
const service = bindPackagesActor(
  createPackagesService(createPackagesRepository(testPool)),
  actorFor(await ensureTestTrainer(testPool))
);

after(async () => {
  await testPool.end();
});

async function createClientAndPackage({ sessionsUsed = 0 } = {}) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, $2, $3, ${OWNER_SUBQUERY})
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
     VALUES ($1, $2, 8, $3, 1600, false, $4::date, $5::date)
     RETURNING id`,
    [
      clientResult.rows[0].id,
      programResult.rows[0].id,
      sessionsUsed,
      PURCHASE_DATE,
      EXPIRY_DATE
    ]
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
      paymentDate: payday(0),
      method: "eft",
      reference: "EFT-100"
    });
    let packages = await service.listClientPackages(fixture.clientId);
    assert.equal(packages[0].paymentStatus, "partially_paid");
    assert.equal(packages[0].paidAmount, 600);
    assert.equal(packages[0].outstandingBalance, 1000);

    await service.addPayment(fixture.packageId, {
      amount: 1000,
      paymentDate: payday(1),
      method: "card"
    });
    packages = await service.listClientPackages(fixture.clientId);
    assert.equal(packages[0].paymentStatus, "paid");
    assert.equal(packages[0].outstandingBalance, 0);

    await service.reversePayment(first.id, {
      paymentDate: payday(2),
      reference: "Correction"
    });
    packages = await service.listClientPackages(fixture.clientId);
    assert.equal(packages[0].paymentStatus, "partially_paid");
    assert.equal(packages[0].paidAmount, 1000);
    assert.equal(packages[0].payments.length, 3);

    await assert.rejects(
      service.reversePayment(first.id, {
        paymentDate: payday(3)
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
        paymentDate: payday(0),
        method: "cash"
      }),
      (error) => error.status === 409
    );
    await assert.rejects(
      service.createClientPackage(fixture.clientId, {
        program: "Weight Loss",
        sessionType: "One-on-One",
        sessionsTotal: 8,
        purchaseDate: PURCHASE_DATE
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
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, '+27 82 555 0103', $2, ${OWNER_SUBQUERY})
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
     VALUES ($1, $2, 1, 250, $3::date, $4::date)
     RETURNING id`,
    [clientResult.rows[0].id, programResult.rows[0].id, PURCHASE_DATE, EXPIRY_DATE]
  );

  try {
    await service.addPayment(packageResult.rows[0].id, {
      amount: 16.17,
      paymentDate: payday(0),
      method: "cash"
    });
    await service.addPayment(packageResult.rows[0].id, {
      amount: 233.83,
      paymentDate: payday(1),
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
      purchaseDate: RENEWAL_PURCHASE_DATE
    });

    assert.equal(created.purchaseDate, RENEWAL_PURCHASE_DATE);
    assert.equal(created.expiryDate, RENEWAL_EXPIRY_DATE);
    assert.equal(created.paymentStatus, "unpaid");
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [fixture.clientId]);
  }
});

test("rejects packages that do not expire exactly two months after purchase", async () => {
  const stamp = `${Date.now()}-${Math.random()}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ($1, '+27 82 555 0102', $2, ${OWNER_SUBQUERY})
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
         VALUES ($1, $2, 4, 1200, $3::date, $4::date)`,
        // One day past the exact two-month expiry: the constraint under test.
        [
          clientResult.rows[0].id,
          programResult.rows[0].id,
          PURCHASE_DATE,
          addDays(EXPIRY_DATE, 1)
        ]
      ),
      /packages_configured_expiry_check/
    );
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [clientResult.rows[0].id]);
  }
});

test("packages and payments follow the client's owner", async () => {
  // Both plain trainers: an admin sees everything, which would hide the bug.
  const alice = actorFor(
    await ensureTestTrainer(testPool, { email: "pkg-alice@days4fitness.test", role: "trainer" })
  );
  const bob = actorFor(
    await ensureTestTrainer(testPool, { email: "pkg-bob@days4fitness.test", role: "trainer" })
  );
  const raw = createPackagesService(createPackagesRepository(testPool));
  const today = daysFromToday(0);

  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ('Alice Package Client', '+27 82 910 0001', $1, $2)
     RETURNING id`,
    [`pkg-isolation-${stamp}@example.com`, alice.id]
  );
  const clientId = clientResult.rows[0].id;

  try {
    const created = await raw.createClientPackage(
      clientId,
      {
        program: "Weight Loss",
        sessionType: "One-on-One",
        sessionsTotal: 4,
        purchaseDate: today
      },
      alice
    );
    assert.ok(created.id, "Alice should be able to create a package for her own client");

    // Bob owns no part of this and must be refused everywhere, as a 404 rather
    // than a 403 so that no id is confirmed to exist.
    await assert.rejects(() => raw.listClientPackages(clientId, bob), { status: 404 });
    await assert.rejects(
      () =>
        raw.createClientPackage(
          clientId,
          {
            program: "Weight Loss",
            sessionType: "One-on-One",
            sessionsTotal: 4,
            purchaseDate: today
          },
          bob
        ),
      { status: 404 }
    );
    await assert.rejects(
      () => raw.addPayment(created.id, { amount: 100, paymentDate: today, method: "cash" }, bob),
      { status: 404 }
    );

    // Alice is unaffected by any of that, and the package is untouched.
    const hers = await raw.listClientPackages(clientId, alice);
    assert.equal(hers.length, 1);
    assert.equal(hers[0].paidAmount, 0, "Bob's payment attempt must not have landed");

    const payment = await raw.addPayment(
      created.id,
      { amount: 100, paymentDate: today, method: "cash" },
      alice
    );
    assert.ok(payment.id);
    await assert.rejects(() => raw.reversePayment(payment.id, { paymentDate: today }, bob), {
      status: 404
    });
  } finally {
    await testPool.query("DELETE FROM clients WHERE id = $1", [clientId]);
  }
});
