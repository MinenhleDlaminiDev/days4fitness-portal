import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart3, CalendarRange, RefreshCw, TrendingUp, UserRound } from "lucide-react";
import { fetchReport, getApiErrorMessage } from "../lib/api.js";
import { localDateInputValue } from "../lib/date.js";

function money(value) {
  return `R${Number(value || 0).toFixed(2)}`;
}

function monthRange(offset = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: localDateInputValue(start), to: localDateInputValue(end) };
}

const PRESETS = [
  { id: "this-month", label: "This month", range: () => monthRange(0) },
  { id: "last-month", label: "Last month", range: () => monthRange(-1) }
];

function Tile({ icon: Icon, label, value, hint }) {
  return (
    <div className="surface-card">
      <div className="flex items-center gap-2 text-subtle">
        <Icon size={15} />
        <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-strong">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default function ReportsPage() {
  const [preset, setPreset] = useState("this-month");
  const [range, setRange] = useState(() => monthRange(0));
  const [report, setReport] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (next) => {
    try {
      setIsLoading(true);
      setError("");
      setReport(await fetchReport(next));
    } catch (requestError) {
      setReport(null);
      setError(getApiErrorMessage(requestError, "Unable to load the report."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  function choosePreset(id) {
    setPreset(id);
    const found = PRESETS.find((item) => item.id === id);
    if (found) setRange(found.range());
  }

  function setCustom(field, value) {
    setPreset("custom");
    setRange((current) => ({ ...current, [field]: value }));
  }

  const isEmpty = useMemo(
    () => report && report.sessions.total === 0 && report.revenue === 0,
    [report]
  );

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">
          Trainer workspace
        </p>
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Revenue, attendance and per-client totals</p>
      </header>

      <div className="surface-card space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={preset === item.id}
              onClick={() => choosePreset(item.id)}
              className={`inline-flex h-11 items-center rounded-xl border px-4 text-xs font-semibold transition ${
                preset === item.id
                  ? "border-accent bg-brand-tint text-accent"
                  : "border-line bg-surface text-subtle"
              }`}
            >
              {item.label}
            </button>
          ))}
          <span
            className={`inline-flex h-11 items-center rounded-xl border px-4 text-xs font-semibold ${
              preset === "custom"
                ? "border-accent bg-brand-tint text-accent"
                : "border-line bg-surface text-subtle"
            }`}
          >
            <CalendarRange size={14} className="mr-1" /> Custom
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-subtle">From</span>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(event) => setCustom("from", event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-wide text-subtle">To</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(event) => setCustom("to", event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
            />
          </label>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted">
          <RefreshCw size={17} className="animate-spin" /> Loading report...
        </div>
      )}

      {!isLoading && error && (
        <p className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm font-semibold text-danger-strong">
          {error}
        </p>
      )}

      {!isLoading && !error && isEmpty && (
        <div className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">
          Nothing happened in this period. Pick a different range.
        </div>
      )}

      {!isLoading && !error && report && !isEmpty && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile icon={TrendingUp} label="Revenue" value={money(report.revenue)} hint="Payments received in this period" />
            <Tile
              icon={BarChart3}
              label="Sessions completed"
              value={report.sessions.completed}
              hint={`${report.sessions.cancelled} cancelled, ${report.sessions.scheduled} still to come`}
            />
            <Tile
              icon={UserRound}
              label="No-show rate"
              value={report.attendance.noShowRate === null ? "—" : `${report.attendance.noShowRate}%`}
              hint={
                report.attendance.noShowRate === null
                  ? "No sessions finished yet"
                  : `${report.attendance.noShow} of ${report.attendance.completed + report.attendance.noShow} finished sessions`
              }
            />
          </div>

          <div className="surface-card overflow-hidden p-0">
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-base font-bold text-strong">Per client</h2>
              <p className="text-xs text-muted">Ordered by what they paid in this period</p>
            </div>

            {report.clients.length === 0 && (
              <p className="p-6 text-center text-sm text-muted">
                No client activity in this period.
              </p>
            )}

            <ul className="divide-y divide-line md:hidden">
              {report.clients.map((client) => (
                <li key={client.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/clients/${client.id}`} className="font-bold text-accent">
                      {client.name}
                    </Link>
                    <span className="font-bold text-strong">{money(client.amountPaid)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {client.sessionsCompleted} completed · {client.sessionsNoShow} no-show ·{" "}
                    {client.sessionsCancelled} cancelled
                  </p>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-subtle">
                    <th className="px-5 py-3 font-bold">Client</th>
                    <th className="px-3 py-3 text-right font-bold">Booked</th>
                    <th className="px-3 py-3 text-right font-bold">Completed</th>
                    <th className="px-3 py-3 text-right font-bold">No-show</th>
                    <th className="px-3 py-3 text-right font-bold">Cancelled</th>
                    <th className="px-5 py-3 text-right font-bold">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {report.clients.map((client) => (
                    <tr key={client.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <Link to={`/clients/${client.id}`} className="font-semibold text-accent">
                          {client.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right text-copy">{client.sessionsBooked}</td>
                      <td className="px-3 py-3 text-right text-copy">{client.sessionsCompleted}</td>
                      <td className="px-3 py-3 text-right text-copy">{client.sessionsNoShow}</td>
                      <td className="px-3 py-3 text-right text-copy">{client.sessionsCancelled}</td>
                      <td className="px-5 py-3 text-right font-bold text-strong">
                        {money(client.amountPaid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
