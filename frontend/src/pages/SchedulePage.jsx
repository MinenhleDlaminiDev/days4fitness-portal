import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  Clock,
  Plus,
  RefreshCw,
  UserRound,
  Users,
  X
} from "lucide-react";
import SuccessToast from "../components/SuccessToast.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { useAppConfiguration } from "../context/AppConfigurationContext.jsx";
import {
  cancelSession,
  completeSession,
  createManualSession,
  createReplacementSession,
  fetchClients,
  fetchScheduleWeek,
  fetchSession,
  getApiErrorMessage,
  markSessionNoShow,
  rescheduleSession
} from "../lib/api.js";
import { localDateInputValue } from "../lib/date.js";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateInputValue(date);
}

function mondayFor(date = new Date()) {
  const copy = new Date(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1));
  return localDateInputValue(copy);
}

function displayDate(dateText, options = {}) {
  return new Date(`${dateText}T00:00:00`).toLocaleDateString("en-ZA", options);
}

function statusClasses(session) {
  if (session.status === "cancelled") {
    return "border-slate-300 bg-slate-100 text-slate-600";
  }
  if (session.status === "completed") {
    return "border-blue-200 bg-blue-50 text-blue-900";
  }
  if (session.status === "no_show") {
    return "border-amber-300 bg-amber-50 text-amber-900";
  }
  const isPaid = session.attendees.every((attendee) => attendee.paid);
  return isPaid
    ? "border-emerald-200 bg-emerald-50 text-emerald-950"
    : "border-red-200 bg-red-50 text-red-950";
}

function BookingForm({ clients, initial, title, submitLabel, onCancel, onSubmit, isSaving }) {
  const { timeSlotsForDay } = useAppConfiguration();
  const [clientId, setClientId] = useState(initial?.clientId || "");
  const [sessionDate, setSessionDate] = useState(initial?.sessionDate || localDateInputValue());
  const [startTime, setStartTime] = useState(initial?.startTime || "");
  const dayName = sessionDate
    ? new Date(`${sessionDate}T00:00:00`).toLocaleDateString("en-ZA", { weekday: "long" })
    : "";
  const timeSlots = timeSlotsForDay(dayName);

  useEffect(() => {
    if (!timeSlots.includes(startTime)) setStartTime(timeSlots[0] || "");
  }, [sessionDate, startTime, timeSlots]);

  function submit(event) {
    event.preventDefault();
    onSubmit({
      ...(initial?.hideClient ? {} : { clientId: Number(clientId) }),
      sessionDate,
      startTime
    });
  }

  return (
    <form onSubmit={submit}>
      {!initial?.hideClient && (
        <header className="bg-gradient-to-br from-emerald-900 to-emerald-700 px-5 py-5 text-white sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">
            Schedule manager
          </p>
          <h3 className="mt-1 text-2xl font-bold">{title}</h3>
          <p className="mt-1 text-sm text-emerald-100">
            Choose the client, training date, and available start time.
          </p>
        </header>
      )}

      <div className="space-y-4 p-4 sm:p-6">
        {initial?.hideClient && (
          <div>
            <h3 className="text-xl font-bold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">
              Choose a new date and available start time.
            </p>
          </div>
        )}
        {!initial?.hideClient && (
          <label className="block rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                <UserRound size={18} />
              </span>
              Select client
            </span>
            <select
              required
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              className="mt-3 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-700 sm:text-base"
            >
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} - {client.sessionsTotal - client.sessionsUsed} credits remaining
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
              <Calendar size={18} />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-800">Session slot</p>
              <p className="text-xs text-slate-500">All sessions are one hour long.</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Training date</span>
              <input
                required
                type="date"
                min={localDateInputValue()}
                value={sessionDate}
                onChange={(event) => setSessionDate(event.target.value)}
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-700 sm:text-base"
              />
            </label>
            <label className="block">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Clock size={15} /> Start time
              </span>
              <select
                required
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-700 sm:text-base"
              >
                {timeSlots.length === 0 && <option value="">No training hours</option>}
                {timeSlots.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {dayName ? `${dayName} training hours are shown above.` : "Select a training date."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="action-btn action-btn-secondary"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={isSaving || !startTime}
            className="action-btn action-btn-primary disabled:opacity-60"
          >
            {isSaving ? "Saving..." : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function SessionModal({
  session,
  clients,
  mode,
  error,
  isSaving,
  onClose,
  onMode,
  onDateAction,
  onCancelSession,
  onOutcome
}) {
  if (!session) return null;
  const hasStarted = session.hasStarted;
  const hasEnded = session.hasEnded;

  return (
    <div className="modal-backdrop fixed inset-0 z-50 overflow-auto bg-slate-950/50 p-3 backdrop-blur-sm">
      <div className="modal-panel mx-auto mt-5 w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-center justify-between bg-gradient-to-br from-emerald-900 to-emerald-700 px-5 py-5 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              {session.status.replace("_", " ")}
            </p>
            <h2 className="text-2xl font-bold">{session.program}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close modal">
            <X size={24} />
          </button>
        </header>

        <div className="space-y-4 p-4 sm:p-5">
          {mode && (
            <BookingForm
              clients={clients}
              initial={{
                hideClient: true,
                sessionDate: session.sessionDate,
                startTime: session.startTime
              }}
              title={mode === "reschedule" ? "Reschedule session" : "Book replacement session"}
              submitLabel={mode === "reschedule" ? "Reschedule" : "Book replacement"}
              onCancel={() => onMode(null)}
              onSubmit={onDateAction}
              isSaving={isSaving}
            />
          )}

          {!mode && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <article className="rounded-2xl bg-slate-100 p-4">
                  <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Calendar size={16} /> Date
                  </p>
                  <p className="mt-2 font-bold">
                    {displayDate(session.sessionDate, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    })}
                  </p>
                </article>
                <article className="rounded-2xl bg-slate-100 p-4">
                  <p className="flex items-center gap-2 text-sm text-slate-500">
                    <Clock size={16} /> Time
                  </p>
                  <p className="mt-2 font-bold">{session.startTime}</p>
                </article>
              </div>

              <article className="rounded-2xl bg-slate-100 p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-600">
                  <Users size={16} /> {session.attendees.length} attendee
                  {session.attendees.length === 1 ? "" : "s"}
                </p>
                <div className="space-y-3">
                  {session.attendees.map((attendee) => (
                    <div key={attendee.attendanceId} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <Link
                            to={`/clients/${attendee.clientId}`}
                            className="font-bold text-slate-900 hover:text-emerald-700"
                          >
                            {attendee.clientName}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {attendee.sessionsTotal - attendee.sessionsUsed} of {attendee.sessionsTotal} credits remaining
                          </p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize text-slate-600">
                          {attendee.status.replace("_", " ")}
                        </span>
                      </div>
                      {session.status === "scheduled" &&
                         attendee.status === "scheduled" &&
                         hasStarted && (
                        <div className={`mt-3 grid gap-2 ${hasEnded ? "grid-cols-2" : "grid-cols-1"}`}>
                          {hasEnded && (
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => onOutcome("complete", attendee.clientId)}
                              className="action-btn action-btn-primary h-9 sm:h-9"
                            >
                              <Check size={15} className="mr-1" /> Complete
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => onOutcome("no-show", attendee.clientId)}
                            className="action-btn h-9 border border-amber-400 bg-amber-50 text-amber-800 sm:h-9"
                          >
                            No-show
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>

              {session.status === "scheduled" && !hasStarted && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => onMode("reschedule")}
                    className="action-btn action-btn-secondary"
                  >
                    Reschedule
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={onCancelSession}
                    className="action-btn border border-red-500 bg-white text-red-700"
                  >
                    Cancel session
                  </button>
                </div>
              )}
              {session.status === "cancelled" && !session.replacementSessionId && (
                <button
                  type="button"
                  onClick={() => onMode("replacement")}
                  className="action-btn action-btn-primary w-full"
                >
                  Book replacement
                </button>
              )}
            </>
          )}

          {error && <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const { configuration } = useAppConfiguration();
  const [weekStart, setWeekStart] = useState(() => mondayFor());
  const [sessions, setSessions] = useState([]);
  const [clients, setClients] = useState([]);
  const [selectedDay, setSelectedDay] = useState(0);
  const [activeSession, setActiveSession] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [showManualBooking, setShowManualBooking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const weekDays = useMemo(
    () =>
      DAY_NAMES.map((day, index) => ({
        key: index,
        name: day,
        label: day.slice(0, 3),
        date: addDays(weekStart, index),
        timeSlots: configuration.businessHours.find((hours) => hours.day === day)?.timeSlots || []
      })),
    [configuration, weekStart]
  );
  const timeSlots = useMemo(
    () => [...new Set(weekDays.flatMap((day) => day.timeSlots))],
    [weekDays]
  );
  const sessionsByDay = useMemo(
    () =>
      weekDays.map((day) => ({
        ...day,
        sessions: sessions
          .filter(
            (session) =>
              session.sessionDate === day.date && session.status !== "cancelled"
          )
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
      })),
    [sessions, weekDays]
  );
  const selectedDayData = sessionsByDay[selectedDay] || sessionsByDay[0];

  async function loadSchedule() {
    try {
      setIsLoading(true);
      setError("");
       const [scheduleRows, clientRows] = await Promise.all([
         fetchScheduleWeek(weekStart),
         fetchClients()
       ]);
      setSessions(scheduleRows || []);
      setClients(clientRows || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load the weekly schedule."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadSchedule();
  }, [weekStart]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function openSession(session) {
    setActiveSession(session);
    setModalMode(null);
    setError("");
    try {
      setActiveSession(await fetchSession(session.id));
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to refresh this session."));
    }
  }

  async function runAction(action, successMessage) {
    try {
      setIsSaving(true);
      setError("");
      const updated = await action();
      setActiveSession(updated);
      await loadSchedule();
      setNotice("");
      window.setTimeout(() => setNotice(successMessage), 0);
      return updated;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to update this session."));
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function submitManual(payload) {
    const created = await runAction(
      () => createManualSession(payload),
      "The session was successfully booked."
    );
    if (created) {
      setShowManualBooking(false);
      setActiveSession(created);
    }
  }

  async function submitDateAction(payload) {
    const action =
      modalMode === "reschedule"
        ? () => rescheduleSession(activeSession.id, payload)
        : () => createReplacementSession(activeSession.id, payload);
    const updated = await runAction(
      action,
      modalMode === "reschedule"
        ? "The session was successfully rescheduled."
        : "The replacement session was successfully booked."
    );
    if (updated) setModalMode(null);
  }

  const weekEnd = addDays(weekStart, 6);

  return (
    <section className="page-wrap schedule-page space-y-4 sm:space-y-5">
      <header className="page-header">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">
              Trainer workspace
            </p>
            <h1 className="page-title">Schedule</h1>
            <p className="page-subtitle">Book, track, and manage weekly sessions</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="surface-card overflow-hidden p-0">
        <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between text-lg font-bold sm:text-xl">
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              aria-label="Previous week"
            >
              <ArrowLeft size={21} />
            </button>
            <div className="text-center">
              <h2>
                {displayDate(weekStart, { day: "numeric", month: "short" })} -{" "}
                {displayDate(weekEnd, { day: "numeric", month: "short", year: "numeric" })}
              </h2>
              <button
                type="button"
                onClick={() => setWeekStart(mondayFor())}
                className="text-xs font-semibold text-emerald-700"
              >
                Return to current week
              </button>
            </div>
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              aria-label="Next week"
            >
              <ArrowRight size={21} />
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-600">
            <RefreshCw size={17} className="animate-spin" /> Loading schedule...
          </div>
        )}
        {!isLoading && error && !activeSession && (
          <div className="p-6 text-center text-sm font-semibold text-red-700">{error}</div>
        )}

        {!isLoading && !error && (
          <>
            <div className="space-y-4 p-4 md:hidden">
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}
              >
                {sessionsByDay.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDay(day.key)}
                    className={`rounded-lg border px-1 py-2 text-center ${
                      selectedDay === day.key
                        ? "border-emerald-700 bg-emerald-100 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-700"
                    }`}
                  >
                    <p className="text-[10px] font-bold">{day.label}</p>
                    <p className="text-sm font-bold">{Number(day.date.slice(-2))}</p>
                    <p className="text-[10px] text-slate-500">{day.sessions.length}</p>
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {selectedDayData.sessions.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                    No sessions booked for this day.
                  </div>
                )}
                {selectedDayData.sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => openSession(session)}
                    className={`interactive-card w-full rounded-xl border p-3 text-left ${statusClasses(session)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold">
                          {session.attendees.map((attendee) => attendee.clientName).join(", ")}
                        </p>
                        <p className="text-xs opacity-75">{session.program}</p>
                      </div>
                      <p className="font-bold">{session.startTime}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden overflow-auto md:block">
              <table className="min-w-[880px] table-fixed border-collapse">
                <thead>
                  <tr>
                    <th className="w-20 border border-slate-200 bg-white p-2 text-slate-500">
                      <Clock size={16} />
                    </th>
                    {weekDays.map((day) => (
                      <th key={day.date} className="w-44 border border-slate-200 bg-white p-2 text-center">
                        <p className="text-sm font-medium text-slate-600">{day.label}</p>
                        <p className="text-lg font-bold text-slate-900">{Number(day.date.slice(-2))}</p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map((time) => (
                    <tr key={time}>
                      <td className="border border-slate-200 p-2 align-top text-sm font-bold text-slate-600">
                        {time}
                      </td>
                      {weekDays.map((day) => {
                        const cellSessions = day.timeSlots.includes(time)
                          ? sessions.filter(
                              (session) =>
                                session.sessionDate === day.date &&
                                session.startTime === time &&
                                session.status !== "cancelled"
                            )
                          : [];
                        return (
                          <td
                            key={`${day.date}-${time}`}
                            className={`h-20 border border-slate-200 p-1 align-top ${
                              day.timeSlots.includes(time) ? "" : "bg-slate-100"
                            }`}
                          >
                            <div className="space-y-1">
                              {cellSessions.map((session) => (
                                <button
                                  key={session.id}
                                  type="button"
                                  onClick={() => openSession(session)}
                                  className={`interactive-card w-full rounded-lg border p-2 text-left ${statusClasses(session)}`}
                                >
                                  <p className="truncate text-sm font-bold">
                                    {session.attendees.map((attendee) => attendee.clientName).join(", ")}
                                  </p>
                                  <p className="truncate text-xs opacity-75">{session.program}</p>
                                </button>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setError("");
          setShowManualBooking(true);
        }}
        className="fab-btn"
        aria-label="Book a session"
      >
        <Plus size={22} />
      </button>

      {showManualBooking && (
        <div className="modal-backdrop fixed inset-0 z-50 overflow-auto bg-slate-950/50 p-3 backdrop-blur-sm">
          <div className="modal-panel mx-auto mt-5 max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <BookingForm
              clients={clients}
              title="Book a session"
              submitLabel="Book session"
              onCancel={() => {
                setShowManualBooking(false);
                setError("");
              }}
              onSubmit={submitManual}
              isSaving={isSaving}
            />
            {error && (
              <p className="mx-4 mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700 sm:mx-6 sm:mb-6">
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      <SessionModal
        session={activeSession}
        clients={clients}
        mode={modalMode}
        error={activeSession ? error : ""}
        isSaving={isSaving}
        onClose={() => {
          setActiveSession(null);
          setModalMode(null);
          setError("");
        }}
        onMode={setModalMode}
        onDateAction={submitDateAction}
        onCancelSession={() =>
          runAction(
            () => cancelSession(activeSession.id),
            "The session was cancelled without consuming a credit."
          )
        }
        onOutcome={(outcome, clientId) =>
          runAction(
            () =>
              outcome === "complete"
                ? completeSession(activeSession.id, clientId)
                : markSessionNoShow(activeSession.id, clientId),
            outcome === "complete"
              ? "The session was marked complete and one credit was used."
              : "The client was marked as a no-show and one credit was used."
          )
        }
      />

      <SuccessToast message={notice} onDismiss={() => setNotice("")} />
    </section>
  );
}
