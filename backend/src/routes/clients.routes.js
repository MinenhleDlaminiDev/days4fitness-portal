import { Router } from "express";
import { clientsController } from "../controllers/clients.controller.js";

const router = Router();

router.get("/", clientsController.list);
router.get("/:id", clientsController.get);
router.post("/", clientsController.create);
router.patch("/:id/preferences", clientsController.updatePreferences);

export default router;
