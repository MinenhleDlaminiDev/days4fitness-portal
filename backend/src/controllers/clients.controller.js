import { sendData } from "../lib/apiResponse.js";
import { clientsService } from "../services/clients.service.js";

export function createClientsController(service = clientsService) {
  return {
    async list(req, res, next) {
      try {
        sendData(res, await service.listClients());
      } catch (error) {
        next(error);
      }
    },

    async get(req, res, next) {
      try {
        sendData(res, await service.getClient(req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async create(req, res, next) {
      try {
        sendData(res, await service.createClient(req.body), { status: 201 });
      } catch (error) {
        next(error);
      }
    },

    async updatePreferences(req, res, next) {
      try {
        sendData(res, await service.updatePreferences(req.params.id, req.body));
      } catch (error) {
        next(error);
      }
    }
  };
}

export const clientsController = createClientsController();
