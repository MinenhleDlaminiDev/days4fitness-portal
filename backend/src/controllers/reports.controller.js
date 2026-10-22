import { sendData } from "../lib/apiResponse.js";
import { reportsService } from "../services/reports.service.js";

export function createReportsController(service = reportsService) {
  return {
    async get(req, res, next) {
      try {
        sendData(res, await service.getReport(req.query, req.auth.user));
      } catch (error) {
        next(error);
      }
    }
  };
}

export const reportsController = createReportsController();
