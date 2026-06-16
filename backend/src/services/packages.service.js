import { conflictError, notFoundError, validationError } from "../errors/AppError.js";
import {
  cleanString,
  requireIsoDate,
  requireOneOf,
  requirePositiveInteger
} from "../lib/validation.js";
import {
  PACKAGE_SIZES,
  sessionTypeFromDatabase,
  sessionTypeToDatabase
} from "../config/businessRules.js";
import { packagesRepository } from "../repositories/packages.repository.js";

const PAYMENT_METHODS = ["cash", "eft", "card"];

function requireAmount(value) {
  const text = String(value).trim();
  const amount = Number(text);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || !Number.isFinite(amount) || amount <= 0) {
    throw validationError("amount must be a positive value with at most two decimal places", {
      field: "amount"
    });
  }
  return amount;
}

function toPaymentDto(row) {
  return {
    id: row.id,
    packageId: row.package_id,
    amount: Number(row.amount),
    paymentDate: row.payment_date,
    method: row.method,
    reference: row.reference || "",
    notes: row.notes || "",
    entryType: row.entry_type,
    reversesPaymentId: row.reverses_payment_id,
    createdAt: row.created_at
  };
}

function toPackageDto(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    programId: row.program_id,
    program: row.program_name,
    sessionType: sessionTypeFromDatabase(row.program_type),
    sessionsTotal: row.sessions_total,
    sessionsUsed: row.sessions_used,
    sessionsRemaining: row.sessions_total - row.sessions_used,
    price: Number(row.price),
    paidAmount: Number(row.paid_amount),
    outstandingBalance: Number(row.outstanding_balance),
    paymentStatus: row.payment_status,
    packageStatus: row.package_status,
    purchaseDate: row.purchase_date,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    payments: (row.payments || []).map(toPaymentDto)
  };
}

function translateError(error) {
  if (
    [
      "PACKAGE_STILL_ACTIVE",
      "PAYMENT_EXCEEDS_BALANCE",
      "PAYMENT_NOT_REVERSIBLE",
      "PAYMENT_ALREADY_REVERSED",
      "23505"
    ].includes(error.code)
  ) {
    throw conflictError(error.message);
  }
  if (error.code === "PACKAGE_CONFIGURATION_MISSING") {
    throw validationError("Selected package configuration is not available");
  }
  throw error;
}

export function createPackagesService(repository = packagesRepository) {
  return {
    async listClientPackages(clientId) {
      const id = requirePositiveInteger(clientId, "clientId");
      if (!(await repository.clientExists(id))) {
        throw notFoundError("Client not found");
      }
      return (await repository.findForClient(id)).map(toPackageDto);
    },

    async createClientPackage(clientId, input = {}) {
      const id = requirePositiveInteger(clientId, "clientId");
      const sessionType = requireOneOf(input.sessionType, ["One-on-One", "Group"], "sessionType");
      const program = cleanString(input.program);
      if (!program) throw validationError("program is required", { field: "program" });
      const sessionsTotal = Number(input.sessionsTotal);
      if (!PACKAGE_SIZES.includes(sessionsTotal)) {
        throw validationError(`sessionsTotal must be one of: ${PACKAGE_SIZES.join(", ")}`);
      }
      const purchaseDate = requireIsoDate(input.purchaseDate, "purchaseDate");
      try {
        const packageId = await repository.createForClient(id, {
          programName: program,
          programType: sessionTypeToDatabase(sessionType),
          sessionsTotal,
          purchaseDate
        });
        if (!packageId) throw notFoundError("Client not found");
        return (await repository.findForClient(id)).map(toPackageDto).find(
          (packageRow) => packageRow.id === packageId
        );
      } catch (error) {
        translateError(error);
      }
    },

    async addPayment(packageId, input = {}) {
      const id = requirePositiveInteger(packageId, "packageId");
      try {
        const payment = await repository.addPayment(id, {
          amount: requireAmount(input.amount),
          paymentDate: requireIsoDate(input.paymentDate, "paymentDate"),
          method: requireOneOf(input.method, PAYMENT_METHODS, "method"),
          reference: cleanString(input.reference) || null,
          notes: cleanString(input.notes) || null
        });
        if (!payment) throw notFoundError("Package not found");
        return toPaymentDto(payment);
      } catch (error) {
        translateError(error);
      }
    },

    async reversePayment(paymentId, input = {}) {
      const id = requirePositiveInteger(paymentId, "paymentId");
      try {
        const reversal = await repository.reversePayment(id, {
          paymentDate: requireIsoDate(input.paymentDate, "paymentDate"),
          reference: cleanString(input.reference) || null,
          notes: cleanString(input.notes) || null
        });
        if (!reversal) throw notFoundError("Payment not found");
        return toPaymentDto(reversal);
      } catch (error) {
        translateError(error);
      }
    }
  };
}

export const packagesService = createPackagesService();
