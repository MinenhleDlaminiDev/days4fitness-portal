import { Router } from "express";
import { clientsController } from "../controllers/clients.controller.js";
import { packagesController } from "../controllers/packages.controller.js";

const router = Router();

router.get("/", clientsController.list);
// Must stay ahead of "/:id" so the literal path is not read as a client id.
router.get("/options", clientsController.options);
router.get("/:clientId/packages", packagesController.listForClient);
router.post("/:clientId/packages", packagesController.createForClient);
router.get("/:id/sessions", clientsController.sessions);
router.get("/:id", clientsController.get);
router.post("/", clientsController.create);
router.patch("/:id", clientsController.update);
router.post("/:id/goals", clientsController.addGoal);
router.patch("/:id/goals/:goalId", clientsController.updateGoal);
router.delete("/:id/goals/:goalId", clientsController.removeGoal);
router.post("/:id/archive", clientsController.archive);
router.post("/:id/restore", clientsController.restore);
router.post("/:id/preferences", clientsController.updatePreferences);
router.patch("/:id/preferences", clientsController.updatePreferences);

export default router;
