import { Router } from "express";
import healthRoutes from "./health.routes.js";
import clientsRoutes from "./clients.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/clients", clientsRoutes);

export default router;

