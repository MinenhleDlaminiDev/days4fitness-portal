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
              <span className="text-xs font-medium uppercase tracking-wide text-emerald-100">{item.label}</span>
              <span className="text-sm font-semibold text-white">{item.value}</span>
            </span>
          ))}
        </div>
      </header>

      {loadError && (
        <article className="surface-card border border-danger-border bg-danger-soft text-sm font-semibold text-danger-strong">
          {loadError}
        </article>
      )}

      <article className="surface-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0 text-base sm:text-lg">
            <CalendarIcon size={18} className="stroke-[1.75] text-accent" />
            Today&apos;s Sessions
          </h2>
          <span className="rounded-full bg-sunken px-3 py-1 text-xs font-semibold text-muted">
            {dashboard.todaySessions.length} sessions
          </span>
        </div>
        <div className="stagger-list space-y-3">
          {isLoading && (
            <div className="rounded-xl border border-line bg-raised p-4 text-sm text-muted">
              Loading today&apos;s sessions...
            </div>
          )}
          {!isLoading && dashboard.todaySessions.length === 0 && (
            <div className="rounded-xl border border-dashed border-line-strong bg-raised p-4 text-sm text-muted">
              No sessions scheduled for today.
            </div>
          )}
          {dashboard.todaySessions.map((session, index) => {
            const firstAttendee = session.attendees[0];
            return (
              <Link
                key={session.id}
                to={`/schedule?weekStart=${mondayForDate(session.sessionDate)}`}
                className="interactive-card stagger-item block rounded-2xl border border-line bg-surface p-3 hover:bg-raised"
                style={{ "--stagger": index }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold sm:text-lg">
                      {session.startTime} - {session.program}
                    </p>
                    <p className="text-sm text-muted">
                      {firstAttendee
                        ? session.attendees.map((attendee) => attendee.clientName).join(", ")
                        : "No attendees"}
                    </p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-subtle">
                      {session.sessionType}
                    </p>
                  </div>
                  <span className="rounded-full bg-brand-tint px-2 py-1 text-xs font-semibold text-accent">
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
            <WalletCards size={18} className="stroke-[1.75] text-accent" />
            Package Credits
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Sessions completed</p>
              <p className="mt-1 text-2xl font-bold text-strong">{summary.completedSessions}</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Unused active credits</p>
              <p className="mt-1 text-2xl font-bold text-accent">{summary.remainingSessions}</p>
            </div>
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <Coins size={18} className="stroke-[1.75] text-warn-text" />
            Revenue
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Payments this month</p>
              <p className="mt-1 text-2xl font-bold text-strong">{currency(summary.monthRevenue)}</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Still unpaid</p>
              <p className="mt-1 text-2xl font-bold text-danger-strong">{currency(summary.outstandingBalance)}</p>
            </div>
          </div>
        </article>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <AlertCircleIcon size={18} className="stroke-[1.75] text-danger-strong" />
            Unpaid Packages
          </h2>
          <div className="stagger-list space-y-2">
            {!isLoading && dashboard.unpaidPackages.length === 0 && (
              <p className="rounded-xl border border-dashed border-line-strong bg-raised p-4 text-sm text-muted">
                No unpaid packages right now.
              </p>
            )}
            {dashboard.unpaidPackages.map((item, index) => (
              <Link
                key={item.id}
                to={`/clients/${item.clientId}`}
                className="interactive-card stagger-item block rounded-xl border border-line bg-surface p-3 hover:border-danger-border hover:bg-danger-soft/50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold sm:text-lg">{item.clientName}</p>
                  <span className="rounded-full bg-danger-tint px-2 py-1 text-xs font-semibold text-danger-strong">
                    {currency(item.outstandingBalance)}
                  </span>
                </div>
                <p className="text-sm text-muted">{item.program}</p>
                <p className="text-sm font-semibold text-danger-strong sm:text-base">
                  {currency(item.paidAmount)} paid of {currency(item.price)}
                </p>
              </Link>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <AlertCircleIcon size={18} className="stroke-[1.75] text-warn-text" />
            Expiring Soon
          </h2>
          <div className="stagger-list space-y-2">
            {!isLoading && dashboard.expiringPackages.length === 0 && (
              <p className="rounded-xl border border-dashed border-line-strong bg-raised p-4 text-sm text-muted">
                No packages expiring in the next 7 days.
              </p>
            )}
            {dashboard.expiringPackages.map((item, index) => (
              <Link
                key={item.id}
                to={`/clients/${item.clientId}`}
                className="interactive-card stagger-item block rounded-xl border border-line bg-surface p-3 hover:border-warn-border hover:bg-warn-soft/50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold sm:text-lg">{item.clientName}</p>
                  <span className="rounded-full bg-warn-tint px-2 py-1 text-xs font-semibold text-warn-text">
                    {item.daysUntilExpiry ?? daysUntil(item.expiryDate)}d
                  </span>
                </div>
                <p className="text-sm text-muted">{item.program}</p>
                <p className="text-sm text-warn-text">
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
