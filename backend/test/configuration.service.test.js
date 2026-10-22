import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getSettings, resetSettings } from "../src/config/settingsCache.js";
import { createConfigurationService as createUnboundConfigurationService } from "../src/services/configuration.service.js";

// Configuration belongs to one trainer since AUTH-05, so every call names who
// is asking. These tests are about the service's own behaviour, so they all
// act as the same trainer and the actor is bound here rather than repeated at
// twenty call sites.
const ACTOR = Object.freeze({ id: 1, role: "admin" });

const ACTOR_ARITY = {
  getConfiguration: 0,
  updatePricing: 1,
  updatePrograms: 1,
  updatePackageSizes: 1,
  updateBusinessHours: 1,
  updateSchedulingSettings: 1
};

function createConfigurationService(...args) {
  const service = createUnboundConfigurationService(...args);
  const bound = { ...service };
  for (const [name, arity] of Object.entries(ACTOR_ARITY)) {
    if (typeof service[name] !== "function") continue;
    bound[name] = (...callArgs) => {
      const padded = [...callArgs];
      while (padded.length < arity) padded.push(undefined);
      return service[name](...padded, ACTOR);
    };
  }
  return bound;
}

// Reading configuration fills that trainer's cache entry, so each test has to
// clear it or it leaks into the other service suites.
afterEach(() => {
  resetSettings();
});

function createRepository(overrides = {}) {
  return {
    async listPrograms() {
      return [{ id: 1, name: "Weight Loss", type: "one_on_one" }];
    },
    async listPricing() {
      return [{ program_type: "one_on_one", sessions_total: 4, price: "1520.00" }];
    },
    async listPackageSizes() {
      return [1, 4, 8, 12, 16];
    },
    async listBusinessHours() {
      return [
        { day_of_week: 1, start_time: "05:00" },
        { day_of_week: 1, start_time: "06:00" },
        { day_of_week: 6, start_time: "05:00" },
        { day_of_week: 6, start_time: "10:00" }
      ];
    },
    async getSchedulingSettings() {
      return { group_capacity: 10, session_duration_minutes: 60, package_expiry_months: 2 };
    },
    async updatePricing() {},
    async replacePackageSizes() {},
    async replaceBusinessHours() {},
    async updateSchedulingSettings() {},
    ...overrides
  };
}

test("returns database programs, pricing, sizes and hours", async () => {
  const service = createConfigurationService(createRepository());

  const configuration = await service.getConfiguration();

  assert.deepEqual(configuration.programs, [
    { id: 1, name: "Weight Loss", sessionType: "One-on-One" }
  ]);
  assert.equal(configuration.pricing[0].price, 1520);
  assert.deepEqual(configuration.packageSizes, [1, 4, 8, 12, 16]);
  assert.equal(configuration.businessHours.at(-1).day, "Saturday");
  assert.equal(configuration.businessHours.at(-1).timeSlots.at(-1), "10:00");
  assert.equal(configuration.groupCapacity, 10);
  assert.equal(configuration.sessionDurationMinutes, 60);
  assert.equal(configuration.packageExpiryMonths, 2);
});

test("reading configuration fills that trainer's cache entry", async () => {
  const service = createConfigurationService(
    createRepository({
      async listPackageSizes() {
        return [6];
      },
      async getSchedulingSettings() {
        return { group_capacity: 12, session_duration_minutes: 45, package_expiry_months: 3 };
      }
    })
  );

  await service.getConfiguration();

  const cached = await getSettings(ACTOR.id);
  assert.deepEqual(cached.packageSizes, [6]);
  assert.equal(cached.groupCapacity, 12);
  assert.equal(cached.packageExpiryMonths, 3);
});

test("saves pricing and rejects bad prices, types, sizes and duplicates", async () => {
  const saved = [];
  const service = createConfigurationService(
    createRepository({
      async updatePricing(trainerId, entries) {
        assert.equal(trainerId, ACTOR.id, "prices are saved against the acting trainer");
        saved.push(...entries);
      }
    })
  );

  await service.updatePricing({
    pricing: [{ sessionType: "One-on-One", sessionsTotal: 4, price: "1600.456" }]
  });
  assert.deepEqual(saved, [{ programType: "one_on_one", sessionsTotal: 4, price: 1600.46 }]);

  await assert.rejects(
    service.updatePricing({ pricing: [] }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({ pricing: [{ sessionType: "Solo", sessionsTotal: 4, price: 1 }] }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({
      pricing: [{ sessionType: "Group", sessionsTotal: 7, price: 1 }]
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({
      pricing: [{ sessionType: "Group", sessionsTotal: 4, price: -1 }]
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    service.updatePricing({
      pricing: [
        { sessionType: "Group", sessionsTotal: 4, price: 1 },
        { sessionType: "Group", sessionsTotal: 4, price: 2 }
      ]
    }),
    (error) => error.status === 400
  );
});

test("saves business hours and rejects Sunday, bad times and out-of-range slots", async () => {
  let saved = null;
  // The hours are written against the acting trainer, not a global week.
  let savedFor = null;
  const service = createConfigurationService(
    createRepository({
      async replaceBusinessHours(trainerId, slots) {
        savedFor = trainerId;
        saved = slots;
      }
    })
  );

  await service.updateBusinessHours({
    businessHours: [{ day: "Monday", timeSlots: ["06:00", "07:00"] }]
  });
  assert.equal(savedFor, ACTOR.id);
  assert.deepEqual(saved, [
    { dayOfWeek: 1, startTime: "06:00" },
    { dayOfWeek: 1, startTime: "07:00" }
  ]);

  const rejected = [
    { businessHours: [{ day: "Sunday", timeSlots: ["06:00"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["6am"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["04:00"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["20:00"] }] },
    { businessHours: [{ day: "Saturday", timeSlots: ["11:00"] }] },
    { businessHours: [{ day: "Monday", timeSlots: ["06:00", "06:00"] }] },
    {
      businessHours: [
        { day: "Monday", timeSlots: ["06:00"] },
        { day: "Monday", timeSlots: ["07:00"] }
      ]
    },
    { businessHours: [] },
    { businessHours: "every day" }
  ];
  for (const payload of rejected) {
    await assert.rejects(
      service.updateBusinessHours(payload),
      (error) => error.status === 400,
      `expected ${JSON.stringify(payload)} to be rejected`
    );
  }
});

test("saves scheduling settings and rejects non-positive or absent values", async () => {
  let saved = null;
  let savedFor = null;
  const service = createConfigurationService(
    createRepository({
      async updateSchedulingSettings(trainerId, updates) {
        savedFor = trainerId;
        saved = updates;
      }
    })
  );

  await service.updateSchedulingSettings({ groupCapacity: 12 });
  assert.equal(savedFor, ACTOR.id);
  assert.deepEqual(saved, { groupCapacity: 12 });

  await service.updateSchedulingSettings({ sessionDurationMinutes: 45, packageExpiryMonths: 3 });
  assert.deepEqual(saved, { sessionDurationMinutes: 45, packageExpiryMonths: 3 });

  for (const payload of [
    {},
    { groupCapacity: 0 },
    { groupCapacity: 2.5 },
    { sessionDurationMinutes: -60 },
    { packageExpiryMonths: "two" }
  ]) {
    await assert.rejects(
      service.updateSchedulingSettings(payload),
      (error) => error.status === 400,
      `expected ${JSON.stringify(payload)} to be rejected`
    );
  }
});

test("saves package sizes and rejects empties, duplicates and non-positive values", async () => {
  let saved = null;
  const service = createConfigurationService(
    createRepository({
      async replacePackageSizes(trainerId, sizes) {
        assert.equal(trainerId, ACTOR.id, "sizes are saved against the acting trainer");
        saved = sizes;
      }
    })
  );

  await service.updatePackageSizes({ packageSizes: [10, 2, 6] });
  assert.deepEqual(saved, [2, 6, 10], "sizes are stored in ascending order");

  for (const payload of [
    { packageSizes: [] },
    { packageSizes: [4, 4] },
    { packageSizes: [0] },
    { packageSizes: [-3] },
    { packageSizes: [2.5] },
    { packageSizes: "four" }
  ]) {
    await assert.rejects(
      service.updatePackageSizes(payload),
      (error) => error.status === 400,
      `expected ${JSON.stringify(payload)} to be rejected`
    );
  }
});

test("a size clients already bought cannot be removed", async () => {
  const service = createConfigurationService(
    createRepository({
      async replacePackageSizes() {
        const error = new Error("update or delete violates foreign key constraint");
        error.code = "23503";
        throw error;
      }
    })
  );

  await assert.rejects(
    service.updatePackageSizes({ packageSizes: [4] }),
    (error) => error.status === 409 && /already bought/.test(error.message)
  );
});

function programRepository(overrides = {}) {
  return createRepository({
    async listPrograms() {
      return [
        { id: 1, name: "Weight Loss", type: "one_on_one" },
        { id: 2, name: "Small Groups", type: "group" }
      ];
    },
    async replacePrograms() {},
    ...overrides
  });
}

test("saves the program catalogue as renames, additions and removals", async () => {
  let received = null;
  const service = createConfigurationService(
    programRepository({
      async replacePrograms(trainerId, programs) {
        assert.equal(trainerId, ACTOR.id, "programs are saved against the acting trainer");
        received = programs;
      }
    })
  );

  await service.updatePrograms({
    programs: [
      { id: 1, name: "  Fat Loss  ", sessionType: "One-on-One" },
      { name: "Boxing", sessionType: "Group" }
    ]
  });

  // Weight Loss renamed, Boxing created, Small Groups left out so it is removed.
  assert.deepEqual(received, [
    { id: 1, name: "Fat Loss", type: "one_on_one" },
    { name: "Boxing", type: "group" }
  ]);
});

test("rejects empty, overlong, duplicate and unknown programs", async () => {
  const service = createConfigurationService(programRepository());

  for (const payload of [
    { programs: [] },
    { programs: "Weight Loss" },
    { programs: [{ name: "   ", sessionType: "Group" }] },
    { programs: [{ name: "x".repeat(61), sessionType: "Group" }] },
    { programs: [{ name: "Boxing", sessionType: "Bootcamp" }] },
    {
      programs: [
        { name: "Boxing", sessionType: "Group" },
        { name: "boxing", sessionType: "Group" }
      ]
    }
  ]) {
    await assert.rejects(
      service.updatePrograms(payload),
      (error) => error.status === 400,
      `expected ${JSON.stringify(payload)} to be rejected`
    );
  }

  // The same name under a different session type is a different program.
  await service.updatePrograms({
    programs: [
      { name: "Boxing", sessionType: "Group" },
      { name: "Boxing", sessionType: "One-on-One" }
    ]
  });
});

test("a program cannot change session type once it exists", async () => {
  const service = createConfigurationService(programRepository());

  await assert.rejects(
    service.updatePrograms({ programs: [{ id: 1, name: "Weight Loss", sessionType: "Group" }] }),
    (error) => error.status === 400 && /session type/.test(error.message)
  );
});

test("an unknown program id is reported rather than silently created", async () => {
  const service = createConfigurationService(programRepository());

  await assert.rejects(
    service.updatePrograms({ programs: [{ id: 99, name: "Ghost", sessionType: "Group" }] }),
    (error) => error.status === 404
  );
});

test("a program clients have packages on cannot be removed", async () => {
  const service = createConfigurationService(
    programRepository({
      async replacePrograms() {
        const error = new Error("update or delete violates foreign key constraint");
        error.code = "23503";
        error.programName = "Small Groups";
        throw error;
      }
    })
  );

  await assert.rejects(
    service.updatePrograms({ programs: [{ id: 1, name: "Weight Loss", sessionType: "One-on-One" }] }),
    (error) => error.status === 409 && /Small Groups/.test(error.message)
  );
});
