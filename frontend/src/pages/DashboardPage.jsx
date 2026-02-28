import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircleIcon,
  CalendarIcon,
  CheckCircleIcon,
  PlusIcon,
  XCircleIcon
} from "../components/Icons.jsx";
import { clients, todaySessions } from "../data/mockData.js";
import { daysUntil } from "../lib/date.js";
import { packagePrice } from "../lib/pricing.js";

function clientById(clientId) {
  return clients.find((item) => item.id === clientId);
}

export default function DashboardPage() {
  const [sessionState, setSessionState] = useState(todaySessions);

  const unpaidPackages = useMemo(() => clients.filter((client) => !client.paid), []);
  const expiringSoon = useMemo(() => clients.filter((client) => daysUntil(client.expiryDate) <= 7), []);

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
        <h1 className="page-title">Days For Fitness</h1>
        <p className="page-subtitle">Trainer Management</p>
      </header>

      <article className="surface-card">
        <h2 className="section-title">
          <CalendarIcon size={20} className="text-emerald-700" />
          Today&apos;s Sessions
        </h2>
        <div className="space-y-3">
          {sessionState.map((session) => {
            const client = clientById(session.clientId);
            if (!client) return null;
            return (
              <div key={session.id} className="rounded-xl border-l-4 border-emerald-500 bg-emerald-50/60 px-3 py-3">
                <Link
                  to={`/clients/${client.id}`}
                  className="flex items-start justify-between gap-3 rounded-md p-1 -m-1 transition hover:bg-emerald-100"
                >
                  <div>
                    <p className="text-lg font-semibold sm:text-xl">{client.name}</p>
                    <p className="text-sm text-slate-600 sm:text-base">{client.program}</p>
                    <p className="text-sm text-slate-500">{session.time}</p>
                  </div>
                  {client.paid ? (
                    <CheckCircleIcon className="text-emerald-600" />
                  ) : (
                    <XCircleIcon className="text-red-500" />
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => markComplete(session.id)}
                  disabled={session.completed}
                  className="action-btn action-btn-primary mt-3 w-full disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {session.completed ? "Completed" : "Mark Complete"}
                </button>
              </div>
            );
          })}
        </div>
      </article>

      <article className="surface-card">
        <h2 className="section-title">
          <AlertCircleIcon className="text-red-500" />
          Unpaid Packages
        </h2>
        <div className="space-y-2">
          {unpaidPackages.map((client) => (
            <Link
              key={client.id}
              to={`/clients/${client.id}`}
              className="block rounded-xl border-l-4 border-red-500 bg-red-50 p-3 transition hover:bg-red-100"
            >
              <p className="text-lg font-semibold sm:text-xl">{client.name}</p>
              <p className="text-sm text-slate-600 sm:text-base">{client.sessionsTotal} Sessions</p>
              <p className="text-base font-semibold text-red-700 sm:text-lg">
                R{packagePrice(client.sessionType, client.sessionsTotal)}
              </p>
            </Link>
          ))}
        </div>
      </article>

      <article className="surface-card">
        <h2 className="section-title">
          <AlertCircleIcon className="text-amber-500" />
          Expiring Soon
        </h2>
        <div className="space-y-2">
          {expiringSoon.map((client) => (
            <Link
              key={client.id}
              to={`/clients/${client.id}`}
              className="block rounded-xl border-l-4 border-amber-500 bg-amber-50 p-3 transition hover:bg-amber-100"
            >
              <p className="text-lg font-semibold sm:text-xl">{client.name}</p>
              <p className="text-sm text-slate-600 sm:text-base">{client.program}</p>
              <p className="text-sm text-amber-700 sm:text-base">
                {client.sessionsTotal - client.sessionsUsed} sessions left - {daysUntil(client.expiryDate)} days
                remaining
              </p>
            </Link>
          ))}
        </div>
      </article>

      <Link
        to="/clients/new"
        className="fixed bottom-24 right-5 grid h-14 w-14 place-items-center rounded-full bg-emerald-700 text-white shadow-lg transition hover:bg-emerald-800"
        aria-label="Add new client"
      >
        <PlusIcon size={24} />
      </Link>
    </section>
  );
}
