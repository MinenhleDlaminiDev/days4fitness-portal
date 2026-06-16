import { sessionTypeFromDatabase } from "../config/businessRules.js";
import { dashboardRepository } from "../repositories/dashboard.repository.js";

function money(value) {
  return Number(value ?? 0);
}

function toTodaySessionDto(row) {
  return {
    id: row.id,
    sessionDate: row.session_date,
    startTime: row.start_time.slice(0, 5),
    sessionType: sessionTypeFromDatabase(row.session_type),
    status: row.status,
    capacity: row.capacity,
    program: row.program_name,
    attendees: (row.attendees || []).map((attendee) => ({
      clientId: attendee.clientId,
      clientName: attendee.clientName,
      attendanceStatus: attendee.attendanceStatus,
      paid: Boolean(attendee.paid)
    }))
  };
}

function toPackageDto(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    program: row.program_name,
    sessionType: sessionTypeFromDatabase(row.program_type),
    sessionsTotal: row.sessions_total,
    sessionsUsed: row.sessions_used,
    sessionsRemaining: row.sessions_total - row.sessions_used,
    expiryDate: row.expiry_date,
    daysUntilExpiry: row.days_until_expiry === undefined ? undefined : Number(row.days_until_expiry),
    price: money(row.price),
    paidAmount: money(row.paid_amount),
    outstandingBalance: money(row.outstanding_balance)
  };
}

function toSummaryDto(row) {
  return {
    todaySessions: 0,
    completedSessions: Number(row.completed_sessions ?? 0),
    remainingSessions: Number(row.remaining_sessions ?? 0),
    unpaidPackages: Number(row.unpaid_packages ?? 0),
    outstandingBalance: money(row.outstanding_balance),
    expiringPackages: Number(row.expiring_count ?? 0),
    monthRevenue: money(row.month_revenue),
    netRevenue: money(row.net_revenue)
  };
}

export function createDashboardService(repository = dashboardRepository) {
  return {
    async getTodaySessions() {
      return (await repository.findTodaySessions()).map(toTodaySessionDto);
    },

    async getOverview() {
      const [sessions, summaryRow, unpaidPackages, expiringPackages] = await Promise.all([
        repository.findTodaySessions(),
        repository.getSummary(),
        repository.findUnpaidPackages(),
        repository.findExpiringPackages()
      ]);
      const todaySessions = sessions.map(toTodaySessionDto);
      return {
        summary: {
          ...toSummaryDto(summaryRow),
          todaySessions: todaySessions.length
        },
        todaySessions,
        unpaidPackages: unpaidPackages.map(toPackageDto),
        expiringPackages: expiringPackages.map(toPackageDto)
      };
    }
  };
}

export const dashboardService = createDashboardService();
