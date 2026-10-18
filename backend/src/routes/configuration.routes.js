import { Router } from "express";
import { configurationController } from "../controllers/configuration.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export function createConfigurationRouter(controller = configurationController) {
  const router = Router();

  // The read stays public: the login page and the booking forms need prices
  // and training hours before anyone has a token.
  router.get("/", controller.get);

  // Writes are the trainer's alone. This router is mounted ahead of the global
  // guard in routes/index.js, so the guard is applied per route here.
  const guard = [requireAuth, requireRole("trainer", "admin")];
  router.put("/pricing", guard, controller.updatePricing);
  router.put("/business-hours", guard, controller.updateBusinessHours);
  router.put("/scheduling", guard, controller.updateScheduling);

  return router;
}

export default createConfigurationRouter();
