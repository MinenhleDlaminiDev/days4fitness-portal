import { Router } from "express";
import { configurationController } from "../controllers/configuration.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export function createConfigurationRouter(controller = configurationController) {
  const router = Router();

  // The read used to be public, for a login page and booking forms that
  // needed prices and hours before anyone had a token. AUTH-05 ended that:
  // training hours and session length belong to one trainer, so there is no
  // configuration to serve without knowing who is asking. Nothing
  // unauthenticated reads it -- the login and sign-up pages use the auth
  // context, not the configuration one.
  //
  // This router is mounted ahead of the global guard in routes/index.js, so
  // the guard is applied per route here.
  const guard = [requireAuth, requireRole("trainer", "admin")];
  router.get("/", guard, controller.get);
  router.put("/programs", guard, controller.updatePrograms);
  router.put("/pricing", guard, controller.updatePricing);
  router.put("/package-sizes", guard, controller.updatePackageSizes);
  router.put("/business-hours", guard, controller.updateBusinessHours);
  router.put("/scheduling", guard, controller.updateScheduling);

  return router;
}

export default createConfigurationRouter();
