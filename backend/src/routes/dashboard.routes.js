import { Router } from "express";
import { dashboardController } from "../controllers/dashboard.controller.js";

export function createDashboardRouter(controller = dashboardController) {
  const router = Router();
  router.get("/", controller.overview);
  router.get("/today-sessions", controller.todaySessions);
  return router;
}

export default createDashboardRouter();
