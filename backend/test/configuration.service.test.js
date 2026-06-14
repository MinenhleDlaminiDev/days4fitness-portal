import assert from "node:assert/strict";
import test from "node:test";
import { createConfigurationService } from "../src/services/configuration.service.js";

test("returns database programs and pricing with backend business rules", async () => {
  const service = createConfigurationService({
    async listPrograms() {
      return [{ id: 1, name: "Weight Loss", type: "one_on_one" }];
    },
    async listPricing() {
      return [{ program_type: "one_on_one", sessions_total: 4, price: "1520.00" }];
    }
  });

  const configuration = await service.getConfiguration();

  assert.deepEqual(configuration.programs, [
    { id: 1, name: "Weight Loss", sessionType: "One-on-One" }
  ]);
  assert.equal(configuration.pricing[0].price, 1520);
  assert.equal(configuration.businessHours.at(-1).day, "Saturday");
  assert.equal(configuration.businessHours.at(-1).timeSlots.at(-1), "10:00");
  assert.equal(configuration.groupCapacity, 8);
  assert.equal(configuration.sessionDurationMinutes, 60);
  assert.equal(configuration.packageExpiryMonths, 2);
});
