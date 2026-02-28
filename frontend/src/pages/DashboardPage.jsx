import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircleIcon, CalendarIcon, CheckCircleIcon, XCircleIcon } from "../components/Icons.jsx";
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
    <section>
      <header className="bg-[#2f66e0] px-5 py-5 text-white">
        <h1 className="text-[44px] font-semibold leading-none tracking-tight">Days For Fitness</h1>
        <p className="mt-1 text-base text-blue-100">Trainer Management</p>
      </header>

      <div className="space-y-4 px-4 py-5">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-[36px] font-semibold text-slate-900">
            <CalendarIcon size={22} className="text-[#2f66e0]" />
            Today&apos;s Sessions
          </h2>
          <div className="space-y-3">
            {sessionState.map((session) => {
              const client = clientById(session.clientId);
              if (!client) return null;
              return (
                <div
                  key={session.id}
                  className="rounded-md border-l-4 border-[#4b83ff] bg-slate-50 px-3 py-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[31px] font-semibold">{client.name}</p>
                      <p className="text-[30px] text-slate-600">{client.program}</p>
                      <p className="text-[30px] text-slate-500">{session.time}</p>
                    </div>
                    {client.paid ? (
                      <CheckCircleIcon className="text-emerald-500" />
                    ) : (
                      <XCircleIcon className="text-red-500" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => markComplete(session.id)}
                    disabled={session.completed}
                    className="mt-3 h-11 w-full rounded-md bg-[#2f66e0] text-[31px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {session.completed ? "Completed" : "Mark Complete"}
                  </button>
                </div>
              );
            })}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-[36px] font-semibold text-slate-900">
            <AlertCircleIcon className="text-red-400" />
            Unpaid Packages
          </h2>
          <div className="space-y-2">
            {unpaidPackages.map((client) => (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="block rounded-md border-l-4 border-red-500 bg-red-50 p-3"
              >
                <p className="text-[31px] font-semibold">{client.name}</p>
                <p className="text-[30px] text-slate-600">{client.sessionsTotal} Sessions</p>
                <p className="text-[31px] font-semibold text-red-600">
                  R{packagePrice(client.sessionType, client.sessionsTotal)}
                </p>
              </Link>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-[36px] font-semibold text-slate-900">
            <AlertCircleIcon className="text-amber-500" />
            Expiring Soon
          </h2>
          <div className="space-y-2">
            {expiringSoon.map((client) => (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="block rounded-md border-l-4 border-amber-500 bg-amber-50 p-3"
              >
                <p className="text-[31px] font-semibold">{client.name}</p>
                <p className="text-[30px] text-slate-600">{client.program}</p>
                <p className="text-[30px] text-amber-600">
                  {client.sessionsTotal - client.sessionsUsed} sessions left · {daysUntil(client.expiryDate)} days
                  remaining
                </p>
              </Link>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
