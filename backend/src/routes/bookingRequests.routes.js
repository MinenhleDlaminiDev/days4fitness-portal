import { Router } from "express";
import { bookingRequestsController } from "../controllers/bookingRequests.controller.js";

export function createBookingRequestsRouter(controller = bookingRequestsController) {
  const router = Router();

  router.get("/pending", controller.listPending);
  router.post("/:id/approve", controller.approve);
  router.post("/:id/reject", controller.reject);

  return router;
}

export default createBookingRequestsRouter();
