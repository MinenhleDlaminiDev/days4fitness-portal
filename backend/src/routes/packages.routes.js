import { Router } from "express";
import { packagesController } from "../controllers/packages.controller.js";

const router = Router();

router.post("/:packageId/payments", packagesController.addPayment);
router.post("/payments/:paymentId/reverse", packagesController.reversePayment);

export default router;
