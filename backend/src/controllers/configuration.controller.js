import { sendData } from "../lib/apiResponse.js";
import { configurationService } from "../services/configuration.service.js";

export function createConfigurationController(service = configurationService) {
  return {
    async get(req, res, next) {
      try {
        sendData(res, await service.getConfiguration());
      } catch (error) {
        next(error);
      }
    },

    async updatePricing(req, res, next) {
      try {
        sendData(res, await service.updatePricing(req.body));
      } catch (error) {
        next(error);
      }
    },

    async updatePackageSizes(req, res, next) {
      try {
        sendData(res, await service.updatePackageSizes(req.body));
      } catch (error) {
        next(error);
      }
    },

    async updateBusinessHours(req, res, next) {
      try {
        sendData(res, await service.updateBusinessHours(req.body));
      } catch (error) {
        next(error);
      }
    },

    async updateScheduling(req, res, next) {
      try {
        sendData(res, await service.updateSchedulingSettings(req.body));
      } catch (error) {
        next(error);
      }
    }
  };
}

export const configurationController = createConfigurationController();
