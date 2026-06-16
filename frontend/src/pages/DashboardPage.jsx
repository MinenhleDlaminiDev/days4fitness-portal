import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar as CalendarIcon,
  CircleAlert as AlertCircleIcon,
  Coins,
  Plus as PlusIcon,
  WalletCards
} from "lucide-react";
import { fetchDashboard, getApiErrorMessage } from "../lib/api.js";
import { daysUntil } from "../lib/date.js";
import ThemeToggle from "../components/ThemeToggle.jsx";

const emptyDashboard = {
  summary: {
    todaySessions: 0,
    completedSessions: 0,
    remainingSessions: 0,
    unpaidPackages: 0,
    outstandingBalance: 0,
    expiringPackages: 0,
    monthRevenue: 0,
    netRevenue: 0
  },
  todaySessions: [],
  unpaidPackages: [],
  expiringPackages: []
};

function currency(value) {
  return `R${Number(value || 0).toFixed(2)}`;
}

function mondayForDate(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dayOfMonth = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${dayOfMonth}`;
}

function sessionStatusLabel(session) {
  if (session.status === "completed") return "Completed";
  if (session.status === "no_show") return "No-show";
  const scheduledAttendees = session.attendees.filter(
    (attendee) => attendee.attendanceStatus === "scheduled"
  );
  return scheduledAttendees.length > 0 ? "Scheduled" : "Reviewed";
}

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      try {
        setIsLoading(true);
        setLoadError("");
        const result = await fetchDashboard();
        if (!mounted) return;
        setDashboard(result || emptyDashboard);
      } catch (error) {
        if (!mounted) return;
        setLoadError(getApiErrorMessage(error, "Unable to load dashboard reporting."));
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadDashboard();
    return () => {
      mounted = false;
    };
  }, []);

  const { summary } = dashboard;
  const stats = [
    { label: "Today", value: summary.todaySessions },
    { label: "Unpaid", value: summary.unpaidPackages },
    { label: "Active credits", value: summary.remainingSessions }
  ];

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Trainer management overview</p>
          </div>
          <ThemeToggle />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {stats.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5"
            >
              <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-100">{item.label}</span>
              <span className="text-sm font-semibold text-white">{item.value}</span>
            </span>
          ))}
        </div>
      </header>

      {loadError && (
        <article className="surface-card border border-red-200 bg-red-50 text-sm font-semibold text-red-700">
          {loadError}
        </article>
      )}

      <article className="surface-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0 text-base sm:text-lg">
            <CalendarIcon size={18} className="stroke-[1.75] text-emerald-700" />
            Today&apos;s Sessions
          </h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {dashboard.todaySessions.length} sessions
          </span>
        </div>
        <div className="stagger-list space-y-3">
          {isLoading && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Loading today&apos;s sessions...
            </div>
          )}
          {!isLoading && dashboard.todaySessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              No sessions scheduled for today.
            </div>
          )}
          {dashboard.todaySessions.map((session, index) => {
            const firstAttendee = session.attendees[0];
            return (
              <Link
                key={session.id}
                to={`/schedule?weekStart=${mondayForDate(session.sessionDate)}`}
                className="interactive-card stagger-item block rounded-2xl border border-slate-200 bg-white p-3 hover:bg-slate-50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold sm:text-lg">
                      {session.startTime} - {session.program}
                    </p>
                    <p className="text-sm text-slate-600">
                      {firstAttendee
                        ? session.attendees.map((attendee) => attendee.clientName).join(", ")
                        : "No attendees"}
                    </p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      {session.sessionType}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                    {sessionStatusLabel(session)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </article>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <WalletCards size={18} className="stroke-[1.75] text-emerald-700" />
            Package Credits
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">Sessions completed</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.completedSessions}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">Unused active credits</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{summary.remainingSessions}</p>
            </div>
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <Coins size={18} className="stroke-[1.75] text-amber-600" />
            Revenue
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">Payments this month</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{currency(summary.monthRevenue)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-600">Still unpaid</p>
              <p className="mt-1 text-2xl font-bold text-red-700">{currency(summary.outstandingBalance)}</p>
            </div>
          </div>
        </article>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <AlertCircleIcon size={18} className="stroke-[1.75] text-red-500" />
            Unpaid Packages
          </h2>
          <div className="stagger-list space-y-2">
            {!isLoading && dashboard.unpaidPackages.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                No unpaid packages right now.
              </p>
            )}
            {dashboard.unpaidPackages.map((item, index) => (
              <Link
                key={item.id}
                to={`/clients/${item.clientId}`}
                className="interactive-card stagger-item block rounded-xl border border-slate-200 bg-white p-3 hover:border-red-200 hover:bg-red-50/50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold sm:text-lg">{item.clientName}</p>
                  <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
                    {currency(item.outstandingBalance)}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{item.program}</p>
                <p className="text-sm font-semibold text-red-700 sm:text-base">
                  {currency(item.paidAmount)} paid of {currency(item.price)}
                </p>
              </Link>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <AlertCircleIcon size={18} className="stroke-[1.75] text-amber-500" />
            Expiring Soon
          </h2>
          <div className="stagger-list space-y-2">
            {!isLoading && dashboard.expiringPackages.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                No packages expiring in the next 7 days.
              </p>
            )}
            {dashboard.expiringPackages.map((item, index) => (
              <Link
                key={item.id}
                to={`/clients/${item.clientId}`}
                className="interactive-card stagger-item block rounded-xl border border-slate-200 bg-white p-3 hover:border-amber-200 hover:bg-amber-50/50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold sm:text-lg">{item.clientName}</p>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                    {item.daysUntilExpiry ?? daysUntil(item.expiryDate)}d
                  </span>
                </div>
                <p className="text-sm text-slate-600">{item.program}</p>
                <p className="text-sm text-amber-700">
                  {item.sessionsRemaining} sessions left
                </p>
              </Link>
            ))}
          </div>
        </article>
      </div>

      <Link
        to="/clients/new"
        className="fab-btn"
        aria-label="Add new client"
      >
        <PlusIcon size={22} className="stroke-[1.75]" />
      </Link>
    </section>
  );
}
