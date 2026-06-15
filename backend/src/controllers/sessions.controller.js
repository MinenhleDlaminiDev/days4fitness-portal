import { sendData } from "../lib/apiResponse.js";
import { sessionsService } from "../services/sessions.service.js";

export function createSessionsController(service = sessionsService) {
  return {
    async listWeek(req, res, next) {
      try {
        sendData(res, await service.listWeek(req.query.weekStart));
      } catch (error) {
        next(error);
      }
    },
    async get(req, res, next) {
      try {
        sendData(res, await service.getSession(req.params.id));
      } catch (error) {
        next(error);
      }
    },
    async create(req, res, next) {
      try {
        sendData(res, await service.createManual(req.body), { status: 201 });
      } catch (error) {
        next(error);
      }
    },
    async reschedule(req, res, next) {
      try {
        sendData(res, await service.reschedule(req.params.id, req.body), { status: 201 });
      } catch (error) {
        next(error);
      }
    },
    async cancel(req, res, next) {
      try {
        sendData(res, await service.cancel(req.params.id));
      } catch (error) {
        next(error);
      }
    },
    async replacement(req, res, next) {
      try {
        sendData(res, await service.createReplacement(req.params.id, req.body), {
          status: 201
        });
      } catch (error) {
        next(error);
      }
    },
    async complete(req, res, next) {
      try {
        sendData(res, await service.recordOutcome(req.params.id, req.body, "completed"));
      } catch (error) {
        next(error);
      }
    },
    async noShow(req, res, next) {
      try {
        sendData(res, await service.recordOutcome(req.params.id, req.body, "no_show"));
      } catch (error) {
        next(error);
      }
    }
  };
}

export const sessionsController = createSessionsController();
