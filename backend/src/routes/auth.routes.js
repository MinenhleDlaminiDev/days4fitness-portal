import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";

export function createAuthRouter(controller = authController) {
  const router = Router();
  router.post("/login", controller.login);
  router.post("/google", controller.google);
  router.post("/google/signup", controller.googleSignup);
  router.get("/me", requireAuth, controller.me);
  router.post("/logout", requireAuth, controller.logout);
  return router;
}

export default createAuthRouter();
