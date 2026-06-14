import { Router } from "express";
import { query } from "../db/client.js";
import { AppError } from "../errors/AppError.js";
import { sendData } from "../lib/apiResponse.js";

const router = Router();

router.get("/", (req, res) => {
  sendData(res, {
    status: "ok",
    service: "days4fitness-api",
    check: "liveness"
  });
});

router.get("/ready", async (req, res, next) => {
  try {
    await query("SELECT 1");
    sendData(res, {
      status: "ok",
      service: "days4fitness-api",
      check: "readiness",
      database: "connected"
    });
  } catch (error) {
    next(new AppError(503, "DATABASE_UNAVAILABLE", "Database readiness check failed"));
  }
});

export default router;
