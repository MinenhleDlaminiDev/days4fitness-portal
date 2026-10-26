import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CircleCheck as CheckCircleIcon,
  CircleX as XCircleIcon,
  CreditCard,
  Plus as PlusIcon,
  Search as SearchIcon
} from "lucide-react";
import { daysUntil } from "../lib/date.js";
import { pluralise } from "../lib/text.js";
import { fetchClients, getApiErrorMessage } from "../lib/api.js";

const tabs = ["Active", "Expired", "Archived", "All"];

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("Active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [summary, setSummary] = useState({ unpaid: 0 });

  useEffect(() => {
    let mounted = true;
    const timeout = window.setTimeout(async () => {
      const status = tab === "Archived" ? "archived" : tab === "All" ? "all" : "active";
      const packageStatus =
        tab === "Expired" ? "expired" : tab === "Active" ? "active" : "all";

      try {
        setIsLoading(true);
        setLoadError("");
        const result = await fetchClients({
          search,
          status,
          packageStatus,
          page,
          pageSize: 10
        });
        if (!mounted) return;
        setClients(result?.items || []);
        setPagination(result?.pagination || { page: 1, total: 0, totalPages: 1 });
        setSummary(result?.summary || { unpaid: 0 });
      } catch (error) {
        if (!mounted) return;
        const message = getApiErrorMessage(error, "Failed to load clients.");
        setLoadError(message);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
    };
  }, [page, search, tab]);

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="page-title">Clients</h1>
            <p className="page-subtitle">Client management overview</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-emerald-100">Showing</span>
            <span className="text-sm font-semibold text-white">{pagination.total}</span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-emerald-100">Unpaid</span>
            <span className="text-sm font-semibold text-white">{summary.unpaid}</span>
          </span>
        </div>
      </header>

      <div className="surface-card space-y-4">
        <label className="flex h-12 items-center rounded-xl border border-line-strong bg-surface px-3">
          <SearchIcon className="stroke-[1.75] text-faint" size={18} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search clients..."
            className="h-full w-full bg-transparent px-3 text-sm text-copy outline-none sm:text-base"
          />
        </label>

        <div className="flex rounded-xl bg-sunken p-1 text-sm font-medium text-muted sm:text-base">
          {tabs.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => {
                setTab(item);
                setPage(1);
              }}
              className={`flex-1 rounded-lg px-2 py-2 transition ${
                tab === item ? "bg-surface text-accent shadow-sm" : "hover:text-strong"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="stagger-list grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {isLoading && (
            <div className="col-span-full rounded-xl border border-line bg-raised p-4 text-sm text-muted">
              Loading clients...
            </div>
          )}
          {!isLoading && loadError && (
            <div className="col-span-full rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger-strong">
              {loadError}
            </div>
          )}
          {!isLoading && !loadError && clients.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-line-strong bg-raised p-4 text-sm text-muted">
              No clients found for this filter.
            </div>
          )}
          {clients.map((client, index) => {
            const sessionsLeft = client.sessionsTotal - client.sessionsUsed;
            const remainingDays = daysUntil(client.expiryDate);
            const paymentStatus =
              client.paymentStatus ||
              (client.paid
                ? "paid"
                : Number(client.paidAmount || 0) > 0
                  ? "partially_paid"
                  : "unpaid");
            const paymentLabel =
              paymentStatus === "paid"
                ? "Paid"
                : paymentStatus === "partially_paid"
                  ? "Partial"
                  : "Unpaid";
            return (
              <Link
                key={client.id}
                to={`/clients/${client.id}`}
                className="interactive-card stagger-item block rounded-2xl border border-line bg-surface px-4 py-4 hover:bg-raised"
                style={{ "--stagger": index }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold leading-tight sm:text-lg">{client.name}</h2>
                      {paymentStatus === "paid" ? (
                        <CheckCircleIcon size={14} className="stroke-[1.75] text-accent" />
                      ) : paymentStatus === "partially_paid" ? (
                        <CreditCard size={14} className="stroke-[1.75] text-warn-text" />
                      ) : (
                        <XCircleIcon size={14} className="stroke-[1.75] text-danger-strong" />
                      )}
                    </div>
                    <p className="text-sm text-muted">{client.program}</p>
                    <p className="text-sm text-subtle">{client.sessionsTotal} {pluralise(client.sessionsTotal, "session")}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      paymentStatus === "paid"
                        ? "bg-brand-tint text-accent"
                        : paymentStatus === "partially_paid"
                          ? "bg-warn-tint text-warn-text"
                          : "bg-danger-tint text-danger-strong"
                    }`}
                  >
                    {paymentLabel}
                  </span>
                </div>

                <hr className="my-3 border-line" />

                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-strong">
                      Sessions: {sessionsLeft} left
                    </p>
                    <p className="text-sm text-muted">
                      {client.sessionsUsed} / {client.sessionsTotal} used
                    </p>
                  </div>
                  <p className="rounded-full bg-sunken px-2 py-1 text-xs font-semibold text-copy">
                    {client.isActive ? `${remainingDays} days` : "Archived"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {!isLoading && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line pt-4">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="action-btn action-btn-secondary h-11 px-4 disabled:opacity-50"
            >
              Previous
            </button>
            <p className="text-sm font-semibold text-muted">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="action-btn action-btn-secondary h-11 px-4 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
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
