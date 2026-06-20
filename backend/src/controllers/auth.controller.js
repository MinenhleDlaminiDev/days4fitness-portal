import { bearerToken } from "../middleware/auth.js";
import { sendData } from "../lib/apiResponse.js";
import { authService } from "../services/auth.service.js";

export function createAuthController(service = authService) {
  return {
    async login(req, res, next) {
      try {
        sendData(res, await service.login(req.body));
      } catch (error) {
        next(error);
      }
    },

    async google(req, res, next) {
      try {
        sendData(res, await service.googleLogin(req.body));
      } catch (error) {
        next(error);
      }
    },

    async googleSignup(req, res, next) {
      try {
        sendData(res, await service.googleSignup(req.body));
      } catch (error) {
        next(error);
      }
    },

    async me(req, res, next) {
      try {
        sendData(res, await service.me(bearerToken(req)));
      } catch (error) {
        next(error);
      }
    },

    async logout(req, res, next) {
      try {
        sendData(res, await service.logout(bearerToken(req)));
      } catch (error) {
        next(error);
      }
    }
  };
}

export const authController = createAuthController();
