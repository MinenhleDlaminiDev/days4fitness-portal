import { Router } from "express";
import healthRoutes from "./health.routes.js";
import clientsRoutes from "./clients.routes.js";
import configurationRoutes from "./configuration.routes.js";
import bookingRequestsRoutes from "./bookingRequests.routes.js";
import sessionsRoutes from "./sessions.routes.js";
import packagesRoutes from "./packages.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/clients", clientsRoutes);
router.use("/configuration", configurationRoutes);
router.use("/booking-requests", bookingRequestsRoutes);
router.use("/sessions", sessionsRoutes);
router.use("/packages", packagesRoutes);

export default router;
