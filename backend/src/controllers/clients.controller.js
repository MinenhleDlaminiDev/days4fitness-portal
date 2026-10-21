import { sendData } from "../lib/apiResponse.js";
import { clientsService } from "../services/clients.service.js";

export function createClientsController(service = clientsService) {
  return {
    async list(req, res, next) {
      try {
        sendData(res, await service.listClients(req.query, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async options(req, res, next) {
      try {
        sendData(res, await service.listClientOptions(req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async get(req, res, next) {
      try {
        sendData(res, await service.getClient(req.params.id, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async create(req, res, next) {
      try {
        sendData(res, await service.createClient(req.body, req.auth.user), { status: 201 });
      } catch (error) {
        next(error);
      }
    },

    async updatePreferences(req, res, next) {
      try {
        sendData(res, await service.updatePreferences(req.params.id, req.body, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async update(req, res, next) {
      try {
        sendData(res, await service.updateClient(req.params.id, req.body, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async addGoal(req, res, next) {
      try {
        sendData(res, await service.addClientGoal(req.params.id, req.body, req.auth.user), { status: 201 });
      } catch (error) {
        next(error);
      }
    },

    async updateGoal(req, res, next) {
      try {
        sendData(
          res,
          await service.updateClientGoal(req.params.id, req.params.goalId, req.body, req.auth.user)
        );
      } catch (error) {
        next(error);
      }
    },

    async removeGoal(req, res, next) {
      try {
        sendData(res, await service.removeClientGoal(req.params.id, req.params.goalId, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async archive(req, res, next) {
      try {
        sendData(res, await service.setClientActive(req.params.id, false, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async restore(req, res, next) {
      try {
        sendData(res, await service.setClientActive(req.params.id, true, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async packages(req, res, next) {
      try {
        sendData(res, await service.getPackageHistory(req.params.id, req.auth.user));
      } catch (error) {
        next(error);
      }
    },

    async sessions(req, res, next) {
      try {
        sendData(res, await service.getSessionHistory(req.params.id, req.auth.user));
      } catch (error) {
        next(error);
      }
    }
  };
}

export const clientsController = createClientsController();
