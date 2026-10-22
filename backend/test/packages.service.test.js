import assert from "node:assert/strict";
import test from "node:test";
import { configureSettingsLoader, DEFAULTS } from "../src/config/settingsCache.js";
import { createPackagesService as createUnboundPackagesService } from "../src/services/packages.service.js";
import { bindPackagesActor } from "./helpers/trainer.js";

// Package sizes come from the owning trainer's settings since AUTH-05, read
// from the database. There is none here, so every trainer gets the defaults.
configureSettingsLoader(async () => DEFAULTS);

// AUTH-03 gave every packages service method the acting trainer as its last
// argument. These tests are about package behaviour, not authorisation, so
// they all act as one trainer; isolation is covered by the integration tests.
const ACTOR = Object.freeze({ id: 1, role: "trainer" });
const createPackagesService = (...args) =>
  bindPackagesActor(createUnboundPackagesService(...args), ACTOR);

function packageRow(overrides = {}) {
  return {
    id: 10,
    client_id: 20,
    program_id: 30,
    program_name: "Weight Loss",
    program_type: "one_on_one",
    sessions_total: 8,
    sessions_used: 2,
    price: "1600.00",
    paid_amount: "600.00",
    outstanding_balance: "1000.00",
    payment_status: "partially_paid",
    package_status: "active",
    purchase_date: "2026-06-15",
    expiry_date: "2026-08-15",
    created_at: "2026-06-15T08:00:00.000Z",
    payments: [],
    ...overrides
  };
}

test("returns package balances and statuses as API-friendly values", async () => {
  const service = createPackagesService({
    async clientExists() {
      return true;
    },
    async findForClient() {
      return [packageRow()];
    }
  });

  const result = await service.listClientPackages(20);

  assert.equal(result[0].paidAmount, 600);
  assert.equal(result[0].outstandingBalance, 1000);
  assert.equal(result[0].paymentStatus, "partially_paid");
  assert.equal(result[0].sessionsRemaining, 6);
});

test("creates a configured replacement package", async () => {
  const repository = {
    // AUTH-03: the service checks the client is this trainer's before it
    // writes. This test is not about ownership, so the client is always theirs.
    async clientExists() {
      return true;
    },
    // AUTH-05: and it asks who owns them, because the sizes on offer are the
    // owner's rather than the caller's.
    async clientOwner() {
      return ACTOR.id;
    },
    async createForClient(clientId, input) {
      assert.equal(clientId, 20);
      assert.deepEqual(input, {
        programName: "Weight Loss",
        programType: "one_on_one",
        sessionsTotal: 8,
        purchaseDate: "2026-06-15"
      });
      return 10;
    },
    async findForClient() {
      return [packageRow()];
    }
  };
  const service = createPackagesService(repository);

  const result = await service.createClientPackage(20, {
    program: "Weight Loss",
    sessionType: "One-on-One",
    sessionsTotal: 8,
    purchaseDate: "2026-06-15"
  });

  assert.equal(result.id, 10);
});

test("validates payment amount, date, and method", async () => {
  const service = createPackagesService({
    async addPayment() {
      throw new Error("Repository should not be called");
    }
  });

  await assert.rejects(
    service.addPayment(10, {
      amount: 100.001,
      paymentDate: "2026-06-15",
      method: "eft"
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.addPayment(10, {
      amount: 100,
      paymentDate: "15-06-2026",
      method: "eft"
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.addPayment(10, {
      amount: 100,
      paymentDate: "2026-06-15",
      method: "cheque"
    }),
    (error) => error.status === 400
  );
});

test("accepts valid decimal amounts affected by floating-point representation", async () => {
  let capturedAmount;
  const service = createPackagesService({
    async addPayment(packageId, payment) {
      capturedAmount = payment.amount;
      return {
        id: 40,
        package_id: packageId,
        amount: payment.amount,
        payment_date: payment.paymentDate,
        method: payment.method,
        entry_type: "payment"
      };
    }
  });

  await service.addPayment(10, {
    amount: "600.30",
    paymentDate: "2026-06-15",
    method: "eft"
  });

  assert.equal(capturedAmount, 600.3);
});

test("returns not found when package history client does not exist", async () => {
  const service = createPackagesService({
    async clientExists() {
      return false;
    }
  });

  await assert.rejects(
    service.listClientPackages(999),
    (error) => error.status === 404 && error.code === "NOT_FOUND"
  );
});

test("translates overpayments and duplicate reversals to conflicts", async () => {
  const overpaymentService = createPackagesService({
    async addPayment() {
      const error = new Error("Payment amount cannot exceed the outstanding balance");
      error.code = "PAYMENT_EXCEEDS_BALANCE";
      throw error;
    }
  });
  const reversalService = createPackagesService({
    async reversePayment() {
      const error = new Error("This payment has already been reversed");
      error.code = "PAYMENT_ALREADY_REVERSED";
      throw error;
    }
  });

  await assert.rejects(
    overpaymentService.addPayment(10, {
      amount: 1700,
      paymentDate: "2026-06-15",
      method: "cash"
    }),
    (error) => error.status === 409
  );
  await assert.rejects(
    reversalService.reversePayment(40, {
      paymentDate: "2026-06-15"
    }),
    (error) => error.status === 409
  );
});
