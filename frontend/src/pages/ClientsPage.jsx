import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CircleCheck as CheckCircleIcon,
  CircleX as XCircleIcon,
  Plus as PlusIcon,
  Search as SearchIcon
} from "lucide-react";
import { clients } from "../data/mockData.js";
import { daysUntil } from "../lib/date.js";
import ThemeToggle from "../components/ThemeToggle.jsx";

const tabs = ["Active", "Expired", "All"];

function filterByTab(client, tab) {
  const active = daysUntil(client.expiryDate) > 0;
  if (tab === "All") return true;
  if (tab === "Active") return active;
  return !active;
}

export default function ClientsPage() {
  const [tab, setTab] = useState("Active");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesTab = filterByTab(client, tab);
      const matchesSearch =
        client.name.toLowerCase().includes(q) || client.program.toLowerCase().includes(q);
      return matchesTab && matchesSearch;
    });
  }, [search, tab]);
  const unpaidCount = useMemo(() => filtered.filter((client) => !client.paid).length, [filtered]);

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="page-title">Clients</h1>
            <p className="page-subtitle">Client management overview</p>
          </div>
          <ThemeToggle />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-100">Showing</span>
            <span className="text-sm font-semibold text-white">{filtered.length}</span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-100">Unpaid</span>
            <span className="text-sm font-semibold text-white">{unpaidCount}</span>
          </span>
        </div>
      </header>

      <div className="surface-card space-y-4">
        <label className="flex h-12 items-center rounded-xl border border-slate-300 bg-white px-3">
          <SearchIcon className="stroke-[1.75] text-slate-400" size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients..."
            className="h-full w-full bg-transparent px-3 text-sm text-slate-700 outline-none sm:text-base"
          />
        </label>

        <div className="flex rounded-xl bg-slate-100 p-1 text-sm font-medium text-slate-600 sm:text-base">
          {tabs.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setTab(item)}
              className={`flex-1 rounded-lg px-2 py-2 transition ${
                tab === item ? "bg-white text-emerald-700 shadow-sm" : "hover:text-slate-900"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="stagger-list space-y-3">
          {filtered.map((client, index) => {
            const sessionsLeft = client.sessionsTotal - client.sessionsUsed;
            const remainingDays = daysUntil(client.expiryDate);
            return (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="interactive-card stagger-item block rounded-2xl border border-slate-200 bg-white px-4 py-4 hover:bg-slate-50"
                style={{ "--stagger": index }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold leading-tight sm:text-lg">{client.name}</h2>
                      {client.paid ? (
                        <CheckCircleIcon size={14} className="stroke-[1.75] text-emerald-600" />
                      ) : (
                        <XCircleIcon size={14} className="stroke-[1.75] text-red-500" />
                      )}
                    </div>
                    <p className="text-sm text-slate-600">{client.program}</p>
                    <p className="text-sm text-slate-500">{client.sessionsTotal} sessions</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      client.paid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {client.paid ? "Paid" : "Pending"}
                  </span>
                </div>

                <hr className="my-3 border-slate-200" />

                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900">
                      Sessions: {sessionsLeft} left
                    </p>
                    <p className="text-sm text-slate-600">
                      {client.sessionsUsed} / {client.sessionsTotal} used
                    </p>
                  </div>
                  <p className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {remainingDays} days
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <Link
        to="/clients/new"
        className="fab-btn"
        aria-label="Add new client"
      >
        <PlusIcon size={24} />
      </Link>
    </section>
  );
}
