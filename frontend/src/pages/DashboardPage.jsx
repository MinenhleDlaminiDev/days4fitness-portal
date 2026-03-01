import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar as CalendarIcon,
  CircleAlert as AlertCircleIcon,
  CircleCheck as CheckCircleIcon,
  CircleX as XCircleIcon,
  Plus as PlusIcon
} from "lucide-react";
import { clients, todaySessions } from "../data/mockData.js";
import { daysUntil } from "../lib/date.js";
import { packagePrice } from "../lib/pricing.js";
import ThemeToggle from "../components/ThemeToggle.jsx";

function clientById(clientId) {
  return clients.find((item) => item.id === clientId);
}

export default function DashboardPage() {
  const [sessionState, setSessionState] = useState(todaySessions);

  const unpaidPackages = useMemo(() => clients.filter((client) => !client.paid), []);
  const expiringSoon = useMemo(() => clients.filter((client) => daysUntil(client.expiryDate) <= 7), []);
  const completedSessions = useMemo(
    () => sessionState.filter((session) => session.completed).length,
    [sessionState]
  );
  const stats = [
    { label: "Sessions", value: sessionState.length },
    { label: "Unpaid", value: unpaidPackages.length },
    { label: "Complete", value: completedSessions }
  ];

  function markComplete(sessionId) {
    setSessionState((current) =>
      current.map((session) =>
        session.id === sessionId ? { ...session, completed: true } : session
      )
    );
  }

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

      <article className="surface-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0 text-base sm:text-lg">
            <CalendarIcon size={18} className="stroke-[1.75] text-emerald-700" />
            Today&apos;s Sessions
          </h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {completedSessions}/{sessionState.length} complete
          </span>
        </div>
        <div className="stagger-list space-y-3">
          {sessionState.map((session, index) => {
            const client = clientById(session.clientId);
            if (!client) return null;
            return (
              <div
                key={session.id}
                className="stagger-item rounded-2xl border border-slate-200 bg-white p-3"
                style={{ "--stagger": index }}
              >
                <Link
                  to={`/clients/${client.id}`}
                  className="interactive-card flex items-start justify-between gap-3 rounded-xl p-2 -m-2 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-base font-semibold sm:text-lg">{client.name}</p>
                    <p className="text-sm text-slate-600">{client.program}</p>
                    <p className="mt-1 text-xs font-medium tracking-wide text-slate-500">{session.time}</p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${
                      client.paid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {client.paid ? (
                      <>
                        <CheckCircleIcon size={14} className="stroke-[1.75] text-emerald-600" />
                        Paid
                      </>
                    ) : (
                      <>
                        <XCircleIcon size={14} className="stroke-[1.75] text-red-600" />
                        Pending
                      </>
                    )}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => markComplete(session.id)}
                  disabled={session.completed}
                  className="action-btn action-btn-primary mt-3 h-10 w-full"
                >
                  {session.completed ? "Completed" : "Mark Complete"}
                </button>
              </div>
            );
          })}
        </div>
      </article>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">
            <AlertCircleIcon size={18} className="stroke-[1.75] text-red-500" />
            Unpaid Packages
          </h2>
          <div className="stagger-list space-y-2">
            {unpaidPackages.map((client, index) => (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="interactive-card stagger-item block rounded-xl border border-slate-200 bg-white p-3 hover:border-red-200 hover:bg-red-50/50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold sm:text-lg">{client.name}</p>
                  <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">Pending</span>
                </div>
                <p className="text-sm text-slate-600">{client.sessionsTotal} sessions</p>
                <p className="text-sm font-semibold text-red-700 sm:text-base">
                  R{packagePrice(client.sessionType, client.sessionsTotal)}
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
            {expiringSoon.map((client, index) => (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="interactive-card stagger-item block rounded-xl border border-slate-200 bg-white p-3 hover:border-amber-200 hover:bg-amber-50/50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold sm:text-lg">{client.name}</p>
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                    {daysUntil(client.expiryDate)}d
                  </span>
                </div>
                <p className="text-sm text-slate-600">{client.program}</p>
                <p className="text-sm text-amber-700">
                  {client.sessionsTotal - client.sessionsUsed} sessions left - {daysUntil(client.expiryDate)} days
                  remaining
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
