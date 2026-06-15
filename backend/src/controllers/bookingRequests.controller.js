import { sendData } from "../lib/apiResponse.js";
import { bookingRequestsService } from "../services/bookingRequests.service.js";

export function createBookingRequestsController(service = bookingRequestsService) {
  return {
    async listPending(req, res, next) {
      try {
        sendData(res, await service.listPending());
      } catch (error) {
        next(error);
      }
    },

    async approve(req, res, next) {
      try {
        sendData(res, await service.approve(req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async reject(req, res, next) {
      try {
        sendData(res, await service.reject(req.params.id));
      } catch (error) {
        next(error);
      }
    }
  };
}

export const bookingRequestsController = createBookingRequestsController();
