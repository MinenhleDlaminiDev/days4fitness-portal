import { sendData } from "../lib/apiResponse.js";
import { packagesService } from "../services/packages.service.js";

export function createPackagesController(service = packagesService) {
  return {
    async listForClient(req, res, next) {
      try {
        sendData(res, await service.listClientPackages(req.params.clientId, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async createForClient(req, res, next) {
      try {
        sendData(res, await service.createClientPackage(req.params.clientId, req.body, req.auth.user), {
          status: 201
        });
      } catch (error) {
        next(error);
      }
    },

    async addPayment(req, res, next) {
      try {
        sendData(res, await service.addPayment(req.params.packageId, req.body, req.auth.user), {
          status: 201
        });
      } catch (error) {
        next(error);
      }
    },

    async reversePayment(req, res, next) {
      try {
        sendData(res, await service.reversePayment(req.params.paymentId, req.body, req.auth.user), {
          status: 201
        });
      } catch (error) {
        next(error);
      }
    }
  };
}

export const packagesController = createPackagesController();
