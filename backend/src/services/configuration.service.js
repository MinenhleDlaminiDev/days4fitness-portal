import {
  BUSINESS_HOURS,
  PACKAGE_EXPIRY_MONTHS,
  PACKAGE_SIZES,
  sessionTypeFromDatabase
} from "../config/businessRules.js";
import { configurationRepository } from "../repositories/configuration.repository.js";

export function createConfigurationService(repository = configurationRepository) {
  return {
    async getConfiguration() {
      const [programRows, pricingRows, schedulingSettings] = await Promise.all([
        repository.listPrograms(),
        repository.listPricing(),
        repository.getSchedulingSettings()
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
        sessionDurationMinutes: schedulingSettings.session_duration_minutes,
        groupCapacity: schedulingSettings.group_capacity,
        packageExpiryMonths: PACKAGE_EXPIRY_MONTHS
      };
    }
  };
}

export const configurationService = createConfigurationService();
