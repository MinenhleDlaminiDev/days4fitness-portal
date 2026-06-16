import { sendData } from "../lib/apiResponse.js";
import { dashboardService } from "../services/dashboard.service.js";

export function createDashboardController(service = dashboardService) {
  return {
    async overview(req, res, next) {
      try {
        sendData(res, await service.getOverview());
      } catch (error) {
        next(error);
      }
    },

    async todaySessions(req, res, next) {
      try {
        sendData(res, await service.getTodaySessions());
      } catch (error) {
        next(error);
      }
    }
  };
}

export const dashboardController = createDashboardController();
