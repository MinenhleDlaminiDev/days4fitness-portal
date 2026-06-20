import { Router } from "express";
import healthRoutes from "./health.routes.js";
import clientsRoutes from "./clients.routes.js";
import configurationRoutes from "./configuration.routes.js";
import bookingRequestsRoutes from "./bookingRequests.routes.js";
import sessionsRoutes from "./sessions.routes.js";
import packagesRoutes from "./packages.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import authRoutes from "./auth.routes.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/configuration", configurationRoutes);
router.use("/auth", authRoutes);

router.use(requireAuth, requireRole("trainer", "admin"));
router.use("/clients", clientsRoutes);
router.use("/booking-requests", bookingRequestsRoutes);
router.use("/sessions", sessionsRoutes);
router.use("/packages", packagesRoutes);
router.use("/dashboard", dashboardRoutes);

export default router;
