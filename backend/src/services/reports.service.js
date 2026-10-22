import { validationError } from "../errors/AppError.js";
import { ownerScope } from "../lib/ownership.js";
import { requireIsoDate } from "../lib/validation.js";
import { reportsRepository } from "../repositories/reports.repository.js";

const MAX_RANGE_DAYS = 366;

function money(value) {
  return Number(value ?? 0);
}

function rate(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function requireRange(query = {}) {
  const from = requireIsoDate(query.from, "from");
  const to = requireIsoDate(query.to, "to");
  if (to < from) {
    throw validationError("to must be on or after from", { field: "to" });
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw validationError(`Choose a range of ${MAX_RANGE_DAYS} days or fewer`, {
      field: "to",
      days
    });
  }
  return { from, to };
}

export function createReportsService(repository = reportsRepository) {
  return {
    async getReport(query = {}, actor) {
      const range = requireRange(query);
      // Every rate below divides one scoped figure by another. A scoped
      // numerator over an unscoped denominator is still a wrong percentage,
      // so the denominator has to come out of the same scoped query.
      const scope = ownerScope(actor);
      const [summary, clientRows] = await Promise.all([
        repository.getSummary(range, scope),
        repository.getClientBreakdown(range, scope)
      ]);

      const attendancesTotal = summary.attendances_total ?? 0;
      const attendancesCompleted = summary.attendances_completed ?? 0;
      const attendancesNoShow = summary.attendances_no_show ?? 0;
      // Attendance that was actually resolved one way or the other. Scheduled
      // and cancelled sessions are not a hit or a miss, so they are excluded
      // from the rate rather than counted against the client.
      const resolved = attendancesCompleted + attendancesNoShow;

      return {
        range,
        revenue: money(summary.revenue),
        sessions: {
          total: summary.sessions_total ?? 0,
          completed: summary.sessions_completed ?? 0,
          noShow: summary.sessions_no_show ?? 0,
          cancelled: summary.sessions_cancelled ?? 0,
          scheduled: summary.sessions_scheduled ?? 0
        },
        attendance: {
          total: attendancesTotal,
          completed: attendancesCompleted,
          noShow: attendancesNoShow,
          completionRate: rate(attendancesCompleted, resolved),
          noShowRate: rate(attendancesNoShow, resolved)
        },
        clients: clientRows.map((row) => ({
          id: row.id,
          name: row.name,
          isActive: row.is_active !== false,
          sessionsBooked: row.sessions_booked,
          sessionsCompleted: row.sessions_completed,
          sessionsNoShow: row.sessions_no_show,
          sessionsCancelled: row.sessions_cancelled,
          amountPaid: money(row.amount_paid)
        }))
      };
    }
  };
}

export const reportsService = createReportsService();
