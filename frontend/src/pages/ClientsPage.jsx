import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircleIcon, PlusIcon, SearchIcon, XCircleIcon } from "../components/Icons.jsx";
import { clients } from "../data/mockData.js";
import { daysUntil } from "../lib/date.js";

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

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header">
        <h1 className="page-title">Clients</h1>
        <p className="page-subtitle">{filtered.length} clients</p>
      </header>

      <div className="surface-card space-y-4">
        <label className="flex h-12 items-center rounded-xl border border-slate-300 bg-white px-3">
          <SearchIcon className="text-slate-400" size={20} />
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

        <div className="space-y-3">
          {filtered.map((client) => {
            const sessionsLeft = client.sessionsTotal - client.sessionsUsed;
            const remainingDays = daysUntil(client.expiryDate);
            return (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="block rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold leading-tight sm:text-xl">{client.name}</h2>
                      {client.paid ? (
                        <CheckCircleIcon size={20} className="text-emerald-600" />
                      ) : (
                        <XCircleIcon size={20} className="text-red-500" />
                      )}
                    </div>
                    <p className="text-sm text-slate-600 sm:text-base">{client.program}</p>
                    <p className="text-sm text-slate-500">{client.sessionsTotal} Sessions</p>
                  </div>
                  <span className="pt-1 text-xl text-slate-400">&gt;</span>
                </div>

                <hr className="my-3 border-slate-200" />

                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900 sm:text-lg">
                      Sessions: {sessionsLeft} left
                    </p>
                    <p className="text-sm text-slate-600">
                      {client.sessionsUsed} / {client.sessionsTotal} used
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700 sm:text-base">{remainingDays} days left</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

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
