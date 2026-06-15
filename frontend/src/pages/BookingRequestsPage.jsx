import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  ChevronRight,
  Clock,
  Inbox,
  RefreshCw,
  UserRound,
  X
} from "lucide-react";
import ThemeToggle from "../components/ThemeToggle.jsx";
import SuccessToast from "../components/SuccessToast.jsx";
import {
  approveBookingRequest,
  fetchPendingBookingRequests,
  getApiErrorMessage,
  rejectBookingRequest
} from "../lib/api.js";
import { formatShortDate } from "../lib/date.js";

function groupByClient(requests) {
  const groups = new Map();

  for (const request of requests) {
    if (!groups.has(request.clientId)) {
      groups.set(request.clientId, {
        clientId: request.clientId,
        clientName: request.clientName,
        program: request.program,
        sessionType: request.sessionType,
        expiryDate: request.expiryDate,
        requests: []
      });
    }
    groups.get(request.clientId).requests.push(request);
  }

  return [...groups.values()];
}

export default function BookingRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeReview, setActiveReview] = useState(null);
  const [requestErrors, setRequestErrors] = useState({});
  const [notice, setNotice] = useState(null);

  async function loadRequests() {
    try {
      setIsLoading(true);
      setLoadError("");
      const rows = await fetchPendingBookingRequests();
      setRequests(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setLoadError(getApiErrorMessage(error, "Unable to load pending requests."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadInitialRequests() {
      try {
        const rows = await fetchPendingBookingRequests();
        if (mounted) {
          setRequests(Array.isArray(rows) ? rows : []);
        }
      } catch (error) {
        if (mounted) {
          setLoadError(getApiErrorMessage(error, "Unable to load pending requests."));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadInitialRequests();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;

    const timeoutId = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const clientGroups = useMemo(() => groupByClient(requests), [requests]);

  async function reviewRequest(request, action) {
    try {
      setActiveReview({ requestId: request.id, action });
      setNotice(null);
      setRequestErrors((current) => ({ ...current, [request.id]: "" }));

      if (action === "approve") {
        const result = await approveBookingRequest(request.id);
        const sessionLabel = result.generatedSessions === 1 ? "session" : "sessions";
        setNotice({
          title: "Session successfully added",
          message:
            `${request.clientName}'s ${request.day} ${request.startTime} request was approved. ` +
            `${result.generatedSessions} ${sessionLabel} scheduled.`
        });
      } else {
        await rejectBookingRequest(request.id);
        setNotice({
          title: "Session request declined",
          message: `${request.clientName}'s ${request.day} ${request.startTime} request was declined.`
        });
      }

      setRequests((current) => current.filter((item) => item.id !== request.id));
    } catch (error) {
      setRequestErrors((current) => ({
        ...current,
        [request.id]: getApiErrorMessage(error, `Unable to ${action} this request.`)
      }));
    } finally {
      setActiveReview(null);
    }
  }

  return (
    <section className="booking-requests-page page-wrap space-y-4 sm:space-y-5">
      <header className="page-header overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">
              Trainer workspace
            </p>
            <h1 className="page-title">Session Approvals</h1>
            <p className="page-subtitle">Review clients&apos; recurring weekly preferences</p>
          </div>
          <ThemeToggle />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
            <Inbox size={15} className="stroke-[1.75]" />
            <span className="text-sm font-semibold">
              {requests.length} pending {requests.length === 1 ? "slot" : "slots"}
            </span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5">
            <UserRound size={15} className="stroke-[1.75]" />
            <span className="text-sm font-semibold">
              {clientGroups.length} {clientGroups.length === 1 ? "client" : "clients"}
            </span>
          </span>
        </div>
      </header>

      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <AlertTriangle size={19} className="mt-0.5 shrink-0 stroke-[1.75]" />
        <p className="text-sm">
          These times are preferences until you approve them. Each approved slot repeats weekly
          until the client&apos;s package expires or its session credits are allocated.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Pending preferences</h2>
          <p className="text-sm text-slate-600">Approve or reject each weekly slot separately.</p>
        </div>
        <button
          type="button"
          onClick={loadRequests}
          disabled={isLoading}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={16} className={`stroke-[1.75] ${isLoading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {isLoading && (
        <div className="surface-card text-sm text-slate-600">Loading booking requests...</div>
      )}

      {!isLoading && loadError && (
        <div className="surface-card border-red-200 bg-red-50 text-red-700">
          <p className="text-sm font-medium">{loadError}</p>
          <button
            type="button"
            onClick={loadRequests}
            className="mt-3 text-sm font-bold underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !loadError && requests.length === 0 && (
        <div className="surface-card py-10 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CalendarCheck size={27} className="stroke-[1.6]" />
          </span>
          <h2 className="mt-4 text-xl font-bold text-slate-900">All caught up</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
            New session preferences will appear here after they are selected on a client profile.
          </p>
          <Link
            to="/clients"
            className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-emerald-700 hover:text-emerald-800"
          >
            View clients
            <ChevronRight size={16} />
          </Link>
        </div>
      )}

      {!isLoading && !loadError && clientGroups.length > 0 && (
        <div className="stagger-list space-y-4">
          {clientGroups.map((group, groupIndex) => (
            <article
              key={group.clientId}
              className="surface-card stagger-item overflow-hidden p-0 sm:p-0"
              style={{ "--stagger": groupIndex }}
            >
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      to={`/clients/${group.clientId}`}
                      className="inline-flex items-center gap-1 text-lg font-bold text-slate-900 hover:text-emerald-700"
                    >
                      {group.clientName}
                      <ChevronRight size={17} />
                    </Link>
                    <p className="text-sm text-slate-600">{group.program}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                      {group.sessionType}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                      Expires {formatShortDate(group.expiryDate)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-200">
                {group.requests.map((request) => {
                  const isReviewing = activeReview?.requestId === request.id;
                  const anotherRequestIsActive =
                    activeReview !== null && activeReview.requestId !== request.id;

                  return (
                    <div key={request.id} className="px-4 py-4 sm:px-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                            <Clock size={20} className="stroke-[1.75]" />
                          </span>
                          <div>
                            <p className="font-bold text-slate-900">{request.day}</p>
                            <p className="text-sm text-slate-600">
                              {request.startTime} - one hour
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:flex">
                          <button
                            type="button"
                            onClick={() => reviewRequest(request, "reject")}
                            disabled={isReviewing || anotherRequestIsActive}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`Reject ${request.day} at ${request.startTime} for ${request.clientName}`}
                          >
                            {isReviewing && activeReview.action === "reject" ? (
                              <RefreshCw size={17} className="animate-spin stroke-[2]" />
                            ) : (
                              <X size={17} className="stroke-[2]" />
                            )}
                            Reject
                          </button>
                          <button
                            type="button"
                            onClick={() => reviewRequest(request, "approve")}
                            disabled={isReviewing || anotherRequestIsActive}
                            className="action-btn action-btn-primary h-11 gap-2 px-4 text-sm sm:h-11 sm:text-sm"
                            aria-label={`Approve ${request.day} at ${request.startTime} for ${request.clientName}`}
                          >
                            {isReviewing && activeReview.action === "approve" ? (
                              <RefreshCw size={17} className="animate-spin stroke-[2]" />
                            ) : (
                              <Check size={17} className="stroke-[2]" />
                            )}
                            Approve
                          </button>
                        </div>
                      </div>

                      {requestErrors[request.id] && (
                        <div
                          role="alert"
                          className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                        >
                          <AlertTriangle size={17} className="mt-0.5 shrink-0 stroke-[1.75]" />
                          <span>{requestErrors[request.id]}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}

      <SuccessToast
        title={notice?.title}
        message={notice?.message}
        onDismiss={() => setNotice(null)}
      />
    </section>
  );
}
