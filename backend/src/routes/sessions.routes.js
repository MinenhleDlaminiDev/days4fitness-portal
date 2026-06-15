import { Router } from "express";
import { sessionsController } from "../controllers/sessions.controller.js";

export function createSessionsRouter(controller = sessionsController) {
  const router = Router();
  router.get("/", controller.listWeek);
  router.post("/", controller.create);
  router.get("/:id", controller.get);
  router.post("/:id/reschedule", controller.reschedule);
  router.post("/:id/cancel", controller.cancel);
  router.post("/:id/replacement", controller.replacement);
  router.post("/:id/complete", controller.complete);
  router.post("/:id/no-show", controller.noShow);
  return router;
}

export default createSessionsRouter();
