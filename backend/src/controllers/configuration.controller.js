import { sendData } from "../lib/apiResponse.js";
import { configurationService } from "../services/configuration.service.js";

export async function getConfiguration(req, res, next) {
  try {
    sendData(res, await configurationService.getConfiguration());
  } catch (error) {
    next(error);
  }
}
