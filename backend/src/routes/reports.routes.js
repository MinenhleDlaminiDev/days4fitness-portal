import { Router } from "express";
import { reportsController } from "../controllers/reports.controller.js";

export function createReportsRouter(controller = reportsController) {
  const router = Router();
  router.get("/", controller.get);
  return router;
}

export default createReportsRouter();
