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
    <section>
      <header className="bg-[#2f66e0] px-5 py-5 text-white">
        <h1 className="text-[42px] font-semibold leading-none tracking-tight">Clients</h1>
        <p className="mt-1 text-base text-blue-100">{filtered.length} clients</p>
      </header>

      <div className="px-4 pb-6 pt-5">
        <label className="flex h-12 items-center rounded-xl border border-slate-300 bg-white px-3">
          <SearchIcon className="text-slate-400" size={20} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients..."
            className="h-full w-full bg-transparent px-3 text-lg text-slate-700 outline-none"
          />
        </label>

        <div className="mt-5 flex border-b border-slate-300 text-[34px] font-medium text-slate-600">
          {tabs.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setTab(item)}
              className={`flex-1 border-b-2 pb-3 pt-1 ${
                tab === item ? "border-[#2f66e0] text-[#2f66e0]" : "border-transparent"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="space-y-4 pt-5">
          {filtered.map((client) => {
            const sessionsLeft = client.sessionsTotal - client.sessionsUsed;
            const remainingDays = daysUntil(client.expiryDate);
            return (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="block rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[34px] font-semibold leading-tight">{client.name}</h2>
                      {client.paid ? (
                        <CheckCircleIcon size={22} className="text-emerald-500" />
                      ) : (
                        <XCircleIcon size={22} className="text-red-500" />
                      )}
                    </div>
                    <p className="text-[30px] text-slate-600">{client.program}</p>
                    <p className="text-[30px] text-slate-500">{client.sessionsTotal} Sessions</p>
                  </div>
                  <span className="pt-1 text-3xl text-slate-400">›</span>
                </div>

                <hr className="my-3 border-slate-200" />

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[31px] font-semibold text-slate-900">
                      Sessions: {sessionsLeft} left
                    </p>
                    <p className="text-[29px] text-slate-600">
                      {client.sessionsUsed} / {client.sessionsTotal} used
                    </p>
                  </div>
                  <p className="text-[31px] font-semibold text-slate-700">{remainingDays} days left</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <Link
        to="/clients/new"
        className="fixed bottom-24 right-5 grid h-16 w-16 place-items-center rounded-full bg-[#2f66e0] text-white shadow-lg"
        aria-label="Add new client"
      >
        <PlusIcon size={28} />
      </Link>
    </section>
  );
}
