import { Router } from "express";
import { getConfiguration } from "../controllers/configuration.controller.js";

const router = Router();

router.get("/", getConfiguration);

export default router;
