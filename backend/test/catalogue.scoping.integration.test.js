// AUTH-10. Prices, programs and package sizes belong to one trainer. These are
// independent personal trainers sharing software, not staff at one company, so
// they charge differently and offer different things and none of the catalogue
// is shared.
//
// Before this, package_pricing was UNIQUE (program_type, sessions_total) and
// programs was UNIQUE (name, type): one price list and one program list for
// everybody. The two trainers below are given deliberately different numbers,
// because a test where both charge the same would pass with the scoping
// removed and prove nothing.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import pg from "pg";
import { env } from "../src/config/env.js";
import { createClientsRepository } from "../src/repositories/clients.repository.js";
import { createConfigurationRepository } from "../src/repositories/configuration.repository.js";
import { createPackagesRepository } from "../src/repositories/packages.repository.js";
import { createClientsService } from "../src/services/clients.service.js";
import { createConfigurationService } from "../src/services/configuration.service.js";
import { createPackagesService } from "../src/services/packages.service.js";
import { daysFromToday } from "./helpers/dates.js";
import {
  actorFor,
  bindActor,
  bindPackagesActor,
  ensureTestTrainer,
  programFor,
  settingsFor,
  withSettings
} from "./helpers/trainer.js";

const { Pool } = pg;

if (!env.testDatabaseUrl || !new URL(env.testDatabaseUrl).pathname.toLowerCase().includes("test")) {
  throw new Error("Catalogue scoping tests require a safe TEST_DATABASE_URL");
}

const testPool = new Pool({ connectionString: env.testDatabaseUrl });

// Alice charges R111 for four one-on-one sessions; Bob charges R999. Nothing
// about these numbers is a default, so either one appearing on the other's
// package is a leak rather than a coincidence.
const ALICE_PRICE = 111;
const BOB_PRICE = 999;

const alice = await ensureTestTrainer(testPool, {
  email: "alice-catalogue@days4fitness.test",
  role: "trainer"
});
const bob = await ensureTestTrainer(testPool, {
  email: "bob-catalogue@days4fitness.test",
  role: "trainer"
});

const ACTOR_ARITY = {
  getConfiguration: 0,
  updatePricing: 1,
  updatePrograms: 1,
  updatePackageSizes: 1
};

function configurationFor(trainer) {
  const service = createConfigurationService(
    createConfigurationRepository(testPool),
    withSettings(testPool)
  );
  const bound = { ...service };
  for (const [name, arity] of Object.entries(ACTOR_ARITY)) {
    bound[name] = (...args) => {
      const padded = [...args];
      while (padded.length < arity) padded.push(undefined);
      return service[name](...padded, actorFor(trainer));
    };
  }
  return bound;
}

function clientsFor(trainer) {
  return bindActor(
    createClientsService(createClientsRepository(testPool), withSettings(testPool)),
    actorFor(trainer)
  );
}

function packagesFor(trainer) {
  return bindPackagesActor(
    createPackagesService(createPackagesRepository(testPool), withSettings(testPool)),
    actorFor(trainer)
  );
}

const asAlice = {
  configuration: configurationFor(alice),
  clients: clientsFor(alice),
  packages: packagesFor(alice)
};
const asBob = {
  configuration: configurationFor(bob),
  clients: clientsFor(bob),
  packages: packagesFor(bob)
};

const createdClientIds = [];

async function clearClients() {
  if (createdClientIds.length > 0) {
    await testPool.query("DELETE FROM clients WHERE id = ANY($1::bigint[])", [createdClientIds]);
    createdClientIds.length = 0;
  }
  for (const trainer of [alice, bob]) {
    await testPool.query("DELETE FROM clients WHERE trainer_user_id = $1", [trainer.id]);
    await testPool.query("DELETE FROM sessions WHERE trainer_user_id = $1", [trainer.id]);
  }
}

after(async () => {
  await clearClients();
  await testPool.end();
});

/** Both trainers back to the seeded catalogue, so tests do not depend on order. */
async function resetCatalogues() {
  await clearClients();
  for (const trainer of [alice, bob]) {
    await testPool.query("DELETE FROM package_pricing WHERE trainer_user_id = $1", [trainer.id]);
    await testPool.query("DELETE FROM package_sizes WHERE trainer_user_id = $1", [trainer.id]);
    await testPool.query("DELETE FROM programs WHERE trainer_user_id = $1", [trainer.id]);
    await testPool.query("SELECT seed_trainer_catalogue($1)", [trainer.id]);
    settingsFor(testPool).invalidateSettings(trainer.id);
  }
}

async function setPrice(services, price, sessionsTotal = 4) {
  await services.configuration.updatePricing({
    pricing: [{ sessionType: "One-on-One", sessionsTotal, price }]
  });
}

async function newClient(services, name, { sessionsTotal = 4, program = "Weight Loss" } = {}) {
  const created = await services.clients.createClient({
    name,
    phone: "+27 82 555 0700",
    email: `auth10-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    program,
    sessionType: "One-on-One",
    packageSize: sessionsTotal,
    purchaseDate: daysFromToday(0),
    paid: false
  });
  createdClientIds.push(created.id);
  return created;
}

test("a price change touches only that trainer's list", async () => {
  await resetCatalogues();

  await setPrice(asAlice, ALICE_PRICE);
  await setPrice(asBob, BOB_PRICE);

  const priceOf = (configuration) =>
    configuration.pricing.find(
      (row) => row.sessionType === "One-on-One" && row.sessionsTotal === 4
    ).price;

  assert.equal(priceOf(await asAlice.configuration.getConfiguration()), ALICE_PRICE);
  assert.equal(priceOf(await asBob.configuration.getConfiguration()), BOB_PRICE);

  // Alice changing hers again leaves Bob's where he set it.
  await setPrice(asAlice, 222);
  assert.equal(priceOf(await asAlice.configuration.getConfiguration()), 222);
  assert.equal(
    priceOf(await asBob.configuration.getConfiguration()),
    BOB_PRICE,
    "Bob's price did not move when Alice saved hers"
  );
});

test("a package is sold at the owning trainer's price, not the caller's", async () => {
  await resetCatalogues();
  await setPrice(asAlice, ALICE_PRICE);
  await setPrice(asBob, BOB_PRICE);

  const hers = await newClient(asAlice, "Alice Catalogue Client");
  const his = await newClient(asBob, "Bob Catalogue Client");

  assert.equal(hers.price, ALICE_PRICE, "Alice's client is charged Alice's price");
  assert.equal(his.price, BOB_PRICE, "Bob's client is charged Bob's price");

  // And on renewal, which reads the price through the client it has locked.
  await testPool.query(
    `UPDATE packages SET sessions_used = sessions_total
     WHERE client_id = $1`,
    [hers.id]
  );
  await setPrice(asAlice, 333);
  const renewed = await asAlice.packages.createClientPackage(hers.id, {
    program: "Weight Loss",
    sessionType: "One-on-One",
    sessionsTotal: 4,
    purchaseDate: daysFromToday(0)
  });
  assert.equal(renewed.price, 333, "a renewal takes the owner's current price");
});

test("programs are each trainer's own vocabulary", async () => {
  await resetCatalogues();

  const before = await asAlice.configuration.getConfiguration();
  const added = await asAlice.configuration.updatePrograms({
    programs: [
      ...before.programs.map((program) => ({
        id: program.id,
        name: program.name,
        sessionType: program.sessionType
      })),
      { name: "Alice Only Boxing", sessionType: "Group" }
    ]
  });
  assert.ok(added.programs.some((program) => program.name === "Alice Only Boxing"));

  const bobSees = await asBob.configuration.getConfiguration();
  assert.equal(
    bobSees.programs.some((program) => program.name === "Alice Only Boxing"),
    false,
    "Alice's new program is not in Bob's catalogue"
  );

  // Both start with a program of the same name. Renaming one leaves the other.
  const bobWeightLoss = bobSees.programs.find((program) => program.name === "Weight Loss");
  const aliceWeightLoss = added.programs.find((program) => program.name === "Weight Loss");
  assert.notEqual(
    Number(aliceWeightLoss.id),
    Number(bobWeightLoss.id),
    "the same name is two separate rows"
  );

  await asAlice.configuration.updatePrograms({
    programs: added.programs
      .filter((program) => program.name !== "Weight Loss")
      .map((program) => ({ id: program.id, name: program.name, sessionType: program.sessionType }))
      .concat([
        {
          id: aliceWeightLoss.id,
          name: "Alice Fat Loss",
          sessionType: aliceWeightLoss.sessionType
        }
      ])
  });

  const bobAfter = await asBob.configuration.getConfiguration();
  assert.ok(
    bobAfter.programs.some((program) => program.name === "Weight Loss"),
    "Bob still has his own Weight Loss"
  );
  assert.equal(
    bobAfter.programs.some((program) => program.name === "Alice Fat Loss"),
    false
  );
});

test("one trainer cannot rename or remove another trainer's program", async () => {
  await resetCatalogues();
  const bobSees = await asBob.configuration.getConfiguration();
  const bobProgram = bobSees.programs[0];

  // Bob's id is not in Alice's catalogue, so the service refuses before any
  // write: not found rather than a silent rename of somebody else's row.
  await assert.rejects(
    asAlice.configuration.updatePrograms({
      programs: [{ id: bobProgram.id, name: "Hijacked", sessionType: bobProgram.sessionType }]
    }),
    (error) => error.status === 404
  );

  const bobAfter = await asBob.configuration.getConfiguration();
  assert.equal(
    bobAfter.programs.find((program) => Number(program.id) === Number(bobProgram.id)).name,
    bobProgram.name,
    "Bob's program kept its name"
  );
  assert.equal(bobAfter.programs.length, bobSees.programs.length);
});

test("package sizes are each trainer's own, and a sold one is protected", async () => {
  await resetCatalogues();

  const aliceSizes = (await asAlice.configuration.getConfiguration()).packageSizes;
  await asAlice.configuration.updatePackageSizes({ packageSizes: [...aliceSizes, 6] });

  assert.deepEqual(
    (await asBob.configuration.getConfiguration()).packageSizes,
    aliceSizes,
    "Alice adding a size did not add it to Bob's list"
  );

  // Alice drops 16; Bob keeps his.
  await asAlice.configuration.updatePackageSizes({
    packageSizes: [...aliceSizes, 6].filter((size) => size !== 16)
  });
  const afterDrop = await asAlice.configuration.getConfiguration();
  assert.equal(afterDrop.packageSizes.includes(16), false);
  assert.ok((await asBob.configuration.getConfiguration()).packageSizes.includes(16));

  // A size Alice's own client bought cannot be removed: the delete guard that
  // replaced packages_sessions_total_fkey, raising 23503 like the key did.
  await setPrice(asAlice, ALICE_PRICE);
  await newClient(asAlice, "Alice Sold Size");
  await assert.rejects(
    asAlice.configuration.updatePackageSizes({
      packageSizes: afterDrop.packageSizes.filter((size) => size !== 4)
    }),
    (error) => error.status === 409
  );
  assert.ok((await asAlice.configuration.getConfiguration()).packageSizes.includes(4));

  // Bob has sold nothing, so the same number comes off his list freely. The
  // protection follows the trainer, not the number.
  const bobSizes = (await asBob.configuration.getConfiguration()).packageSizes;
  await asBob.configuration.updatePackageSizes({
    packageSizes: bobSizes.filter((size) => size !== 4)
  });
  assert.equal(
    (await asBob.configuration.getConfiguration()).packageSizes.includes(4),
    false
  );
});

test("a trainer with no price for a size cannot silently sell it at zero", async () => {
  await resetCatalogues();

  // The size is still offered, but its price row is gone.
  await testPool.query(
    "DELETE FROM package_pricing WHERE trainer_user_id = $1 AND sessions_total = 4",
    [alice.id]
  );

  await assert.rejects(
    newClient(asAlice, "Alice No Price"),
    (error) => error.status === 400,
    "an explicit failure, not a package priced at 0"
  );

  const sold = await testPool.query(
    `SELECT COUNT(*)::int AS count
     FROM packages package
     JOIN clients client ON client.id = package.client_id
     WHERE client.trainer_user_id = $1`,
    [alice.id]
  );
  assert.equal(sold.rows[0].count, 0, "nothing was written");

  // Bob still has his price, so the same sale works for him.
  await setPrice(asBob, BOB_PRICE);
  const his = await newClient(asBob, "Bob Has A Price");
  assert.equal(his.price, BOB_PRICE);
});

test("the database refuses a package built from another trainer's catalogue", async () => {
  await resetCatalogues();

  const clientResult = await testPool.query(
    `INSERT INTO clients (name, phone, email, trainer_user_id)
     VALUES ('Alice Trigger', '+27 82 555 0711', $1, $2)
     RETURNING id`,
    [`auth10-trigger-${Date.now()}@example.com`, alice.id]
  );
  createdClientIds.push(clientResult.rows[0].id);
  const bobProgram = await programFor(testPool, bob.id);

  // Alice's client, Bob's program: packages_owner_catalogue raises 23503, the
  // same class the dropped foreign key raised.
  await assert.rejects(
    testPool.query(
      `INSERT INTO packages (
         client_id, program_id, sessions_total, price, purchase_date, expiry_date
       )
       VALUES ($1, $2, 4, 100, CURRENT_DATE, (CURRENT_DATE + INTERVAL '2 months')::date)`,
      [clientResult.rows[0].id, bobProgram]
    ),
    (error) => error.code === "23503"
  );

  // And a size Alice does not offer, with her own program.
  const aliceProgram = await programFor(testPool, alice.id);
  // The price row references the size, so it goes first.
  await testPool.query(
    "DELETE FROM package_pricing WHERE trainer_user_id = $1 AND sessions_total = 8",
    [alice.id]
  );
  await testPool.query(
    "DELETE FROM package_sizes WHERE trainer_user_id = $1 AND sessions_total = 8",
    [alice.id]
  );
  await assert.rejects(
    testPool.query(
      `INSERT INTO packages (
         client_id, program_id, sessions_total, price, purchase_date, expiry_date
       )
       VALUES ($1, $2, 8, 100, CURRENT_DATE, (CURRENT_DATE + INTERVAL '2 months')::date)`,
      [clientResult.rows[0].id, aliceProgram]
    ),
    (error) => error.code === "23503"
  );
});
