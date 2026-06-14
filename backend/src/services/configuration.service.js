import {
  BUSINESS_HOURS,
  GROUP_CAPACITY,
  PACKAGE_EXPIRY_MONTHS,
  PACKAGE_SIZES,
  SESSION_DURATION_MINUTES,
  sessionTypeFromDatabase
} from "../config/businessRules.js";
import { configurationRepository } from "../repositories/configuration.repository.js";

export function createConfigurationService(repository = configurationRepository) {
  return {
    async getConfiguration() {
      const [programRows, pricingRows] = await Promise.all([
        repository.listPrograms(),
        repository.listPricing()
      ]);

      return {
        programs: programRows.map((row) => ({
          id: row.id,
          name: row.name,
          sessionType: sessionTypeFromDatabase(row.type)
        })),
        packageSizes: PACKAGE_SIZES,
        pricing: pricingRows.map((row) => ({
          sessionType: sessionTypeFromDatabase(row.program_type),
          sessionsTotal: row.sessions_total,
          price: Number(row.price)
        })),
        businessHours: BUSINESS_HOURS,
        sessionDurationMinutes: SESSION_DURATION_MINUTES,
        groupCapacity: GROUP_CAPACITY,
        packageExpiryMonths: PACKAGE_EXPIRY_MONTHS
      };
    }
  };
}

export const configurationService = createConfigurationService();
