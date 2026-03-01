import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  Calendar as CalendarIcon,
  Clock as ClockIcon,
  Plus as PlusIcon,
  Users as UsersIcon,
  X as XIcon
} from "lucide-react";
import { clients, scheduleEntries } from "../data/mockData.js";

const weekDays = [
  { key: 0, label: "Mon", day: 11 },
  { key: 1, label: "Tue", day: 12 },
  { key: 2, label: "Wed", day: 13 },
  { key: 3, label: "Thu", day: 14 },
  { key: 4, label: "Fri", day: 15 },
  { key: 5, label: "Sat", day: 16 },
  { key: 6, label: "Sun", day: 17 }
];
const timeSlots = Array.from({ length: 14 }, (_, index) => `${String(index + 5).padStart(2, "0")}:00`);

function sessionAt(day, time) {
  return scheduleEntries.find((entry) => entry.day === day && entry.time === time);
}

function SessionDetailsModal({ session, onClose, isClosing }) {
  if (!session) return null;
  const client = clients.find((item) => item.name === session.client);
  const isPaid = typeof session.paid === "boolean" ? session.paid : Boolean(client?.paid);
  const progressPercent = client ? (client.sessionsUsed / client.sessionsTotal) * 100 : 0;

  return (
    <div className={`modal-backdrop fixed inset-0 z-50 overflow-auto bg-slate-950/40 backdrop-blur-sm ${isClosing ? "is-closing" : ""}`}>
      <div className={`modal-panel mx-auto mt-8 w-[calc(100%-1.5rem)] max-w-2xl rounded-3xl bg-white shadow-2xl ${isClosing ? "is-closing" : ""}`}>
        <header className="flex items-center justify-between rounded-t-3xl bg-gradient-to-br from-emerald-900 to-emerald-700 px-5 py-5 text-white">
          <h2 className="text-2xl font-semibold sm:text-3xl">Session Details</h2>
          <button type="button" onClick={onClose} aria-label="Close modal">
            <XIcon size={24} className="stroke-[1.75]" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-5 sm:px-5">
          <article className="rounded-2xl bg-slate-100 p-4">
            <p className="text-sm text-slate-500">Client</p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xl font-semibold sm:text-2xl">{session.client}</p>
              {client && (
                <Link to={`/clients/${client.id}`} className="text-sm font-medium text-emerald-700 sm:text-base">
                  View Profile
                </Link>
              )}
            </div>
          </article>

          <div className="grid grid-cols-2 gap-3">
            <article className="rounded-2xl bg-slate-100 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                <CalendarIcon size={16} className="stroke-[1.75] text-emerald-700" />
                Date
              </p>
              <p className="text-lg font-semibold sm:text-xl">Tue, Nov 12</p>
            </article>
            <article className="rounded-2xl bg-slate-100 p-4">
              <p className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                <ClockIcon size={16} className="stroke-[1.75] text-emerald-700" />
                Time
              </p>
              <p className="text-lg font-semibold sm:text-xl">{session.time}</p>
            </article>
          </div>

          <article className="rounded-2xl bg-slate-100 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm text-slate-500">
              <UsersIcon size={16} className="stroke-[1.75] text-emerald-700" />
              Program
            </p>
            <p className="text-xl font-semibold sm:text-2xl">{session.program}</p>
            <p className="text-base text-slate-600">{client?.sessionType ?? "Session"}</p>
          </article>

          <article className={`rounded-2xl p-4 ${client ? "bg-slate-100" : "border border-dashed border-slate-300 bg-slate-50"}`}>
            <p className="text-sm text-slate-500">Package Progress</p>
            <div className="mt-2 flex items-center justify-between text-base font-semibold sm:text-lg">
              <p>Sessions Remaining</p>
              <p className="text-emerald-700">
                {client ? `${client.sessionsTotal - client.sessionsUsed} / ${client.sessionsTotal}` : "Not available"}
              </p>
            </div>
            {client && (
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-300">
                <div className="h-full rounded-full bg-emerald-700" style={{ width: `${progressPercent}%` }} />
              </div>
            )}
          </article>

          {isPaid ? (
            <article className="rounded-2xl border-l-4 border-emerald-500 bg-emerald-50 p-4">
              <p className="text-lg font-semibold text-emerald-700 sm:text-xl">Payment Received</p>
              <p className="text-sm text-emerald-700 sm:text-base">Package fully paid</p>
            </article>
          ) : (
            <article className="rounded-2xl border-l-4 border-red-500 bg-red-50 p-4">
              <p className="text-lg font-semibold text-red-700 sm:text-xl">Payment Pending</p>
              <p className="text-sm text-red-700 sm:text-base">Package not fully paid</p>
            </article>
          )}

          <button type="button" className="action-btn action-btn-primary w-full">
            Mark Complete
          </button>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="action-btn action-btn-secondary w-full">
              Reschedule
            </button>
            <button
              type="button"
              className="action-btn w-full border border-red-600 bg-white text-red-600 hover:bg-red-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const [activeSession, setActiveSession] = useState(null);
  const [isClosingModal, setIsClosingModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState(weekDays[0].key);

  const grid = useMemo(() => {
    return timeSlots.map((time) =>
      weekDays.map((day) => ({
        day: day.key,
        time,
        session: sessionAt(day.key, time)
      }))
    );
  }, []);

  const sessionsByDay = useMemo(() => {
    return weekDays.map((day) => ({
      ...day,
      sessions: scheduleEntries
        .filter((entry) => entry.day === day.key)
        .sort((a, b) => a.time.localeCompare(b.time))
    }));
  }, []);

  const selectedDayData = sessionsByDay.find((day) => day.key === selectedDay) ?? sessionsByDay[0];

  useEffect(() => {
    if (!isClosingModal) return;
    const timeoutId = setTimeout(() => {
      setActiveSession(null);
      setIsClosingModal(false);
    }, 170);
    return () => clearTimeout(timeoutId);
  }, [isClosingModal]);

  function openSessionDetails(session) {
    setIsClosingModal(false);
    setActiveSession(session);
  }

  function closeSessionDetails() {
    setIsClosingModal(true);
  }

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header">
        <h1 className="page-title">Schedule</h1>
        <p className="page-subtitle">Weekly session planner</p>
      </header>

      <div className="surface-card overflow-hidden p-0">
        <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between text-lg font-semibold sm:text-xl">
            <button type="button" aria-label="Previous week" className="text-slate-600 hover:text-slate-900">
              <ArrowLeftIcon size={20} className="stroke-[1.75]" />
            </button>
            <h2>Nov 11 - Nov 17, 2024</h2>
            <button type="button" aria-label="Next week" className="text-slate-600 hover:text-slate-900">
              <ArrowRightIcon size={20} className="stroke-[1.75]" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-4 md:hidden">
          <div className="grid grid-cols-7 gap-1">
            {sessionsByDay.map((day) => (
              <button
                key={day.key}
                type="button"
                onClick={() => setSelectedDay(day.key)}
                className={`rounded-lg border px-1 py-2 text-center transition ${
                  selectedDay === day.key
                    ? "border-emerald-700 bg-emerald-100 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <p className="text-[10px] font-semibold leading-none">{day.label}</p>
                <p className="mt-1 text-sm font-semibold leading-none">{day.day}</p>
                <p className="mt-1 text-[10px] leading-none text-slate-500">{day.sessions.length}</p>
              </button>
            ))}
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-800">
              {selectedDayData.label} {selectedDayData.day}
            </p>
            <p className="text-xs text-slate-500">{selectedDayData.sessions.length} scheduled sessions</p>
          </div>

          <div className="stagger-list space-y-2">
            {selectedDayData.sessions.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                No sessions booked for this day.
              </div>
            )}
            {selectedDayData.sessions.map((session, index) => (
              <button
                key={`${selectedDayData.key}-${session.time}-${session.client}`}
                type="button"
                onClick={() => openSessionDetails({ ...session, time: session.time })}
                className={`interactive-card stagger-item w-full rounded-xl border px-3 py-3 text-left ${
                  session.paid ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                }`}
                style={{ "--stagger": index }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{session.client}</p>
                    <p className="text-xs text-slate-600">{session.program}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">{session.time}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden overflow-auto md:block">
          <table className="min-w-[880px] table-fixed border-collapse text-left">
            <thead>
              <tr>
                <th className="w-20 border border-slate-200 bg-white px-2 py-2 text-sm text-slate-500">
                  <ClockIcon size={16} className="stroke-[1.75]" />
                </th>
                {weekDays.map((day) => (
                  <th
                    key={day.key}
                    className="w-44 border border-slate-200 bg-white px-2 py-2 text-center text-sm font-medium text-slate-600"
                  >
                    <p>{day.label}</p>
                    <p className="text-base font-semibold text-slate-900 sm:text-lg">{day.day}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row[0].time}>
                  <td className="border border-slate-200 px-2 align-top text-sm font-semibold text-slate-600">
                    {row[0].time}
                  </td>
                  {row.map((cell) => (
                    <td key={`${cell.day}-${cell.time}`} className="h-20 border border-slate-200 p-1 align-top">
                      {cell.session && (
                        <button
                          type="button"
                          onClick={() => openSessionDetails({ ...cell.session, time: cell.time })}
                          className={`interactive-card h-full w-full rounded-lg border px-2 py-1 text-left ${
                            cell.session.paid
                              ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                              : "border-red-200 bg-red-50 hover:bg-red-100"
                          }`}
                        >
                          <p className="text-sm font-semibold leading-none">{cell.session.client}</p>
                          <p className="mt-1 text-xs text-slate-600">{cell.session.program}</p>
                        </button>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="hidden items-center justify-center gap-6 border-t border-slate-200 bg-white py-3 text-sm md:flex">
          <span className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded border border-emerald-300 bg-emerald-50" />
            Paid
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded border border-red-300 bg-red-50" />
            Unpaid
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded border border-slate-300 bg-white" />
            Available
          </span>
        </div>
      </div>

      <Link
        to="/clients/new"
        className="fab-btn"
        aria-label="Add new client"
      >
        <PlusIcon size={22} className="stroke-[1.75]" />
      </Link>

      <SessionDetailsModal session={activeSession} onClose={closeSessionDetails} isClosing={isClosingModal} />
    </section>
  );
}
