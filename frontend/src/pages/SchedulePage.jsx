import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  UsersIcon,
  XIcon
} from "../components/Icons.jsx";
import { scheduleEntries } from "../data/mockData.js";

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

function SessionDetailsModal({ session, onClose }) {
  if (!session) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-white">
      <header className="flex items-center justify-between bg-[#2f66e0] px-5 py-5 text-white">
        <h2 className="text-[46px] font-semibold">Session Details</h2>
        <button type="button" onClick={onClose} aria-label="Close modal">
          <XIcon size={34} />
        </button>
      </header>

      <div className="space-y-4 px-4 py-5">
        <article className="rounded-2xl bg-slate-100 p-4">
          <p className="text-[31px] text-slate-500">Client</p>
          <div className="flex items-center justify-between">
            <p className="text-[46px] font-semibold">{session.client}</p>
            <Link to="/clients/1" className="text-[34px] font-medium text-[#2f66e0]">
              View Profile
            </Link>
          </div>
        </article>

        <div className="grid grid-cols-2 gap-3">
          <article className="rounded-2xl bg-slate-100 p-4">
            <p className="mb-2 flex items-center gap-2 text-[31px] text-slate-500">
              <CalendarIcon className="text-[#2f66e0]" />
              Date
            </p>
            <p className="text-[42px] font-semibold">Tue, Nov 12</p>
          </article>
          <article className="rounded-2xl bg-slate-100 p-4">
            <p className="mb-2 flex items-center gap-2 text-[31px] text-slate-500">
              <ClockIcon className="text-[#2f66e0]" />
              Time
            </p>
            <p className="text-[42px] font-semibold">{session.time}</p>
          </article>
        </div>

        <article className="rounded-2xl bg-slate-100 p-4">
          <p className="mb-2 flex items-center gap-2 text-[31px] text-slate-500">
            <UsersIcon className="text-[#2f66e0]" />
            Program
          </p>
          <p className="text-[46px] font-semibold">{session.program}</p>
          <p className="text-[40px] text-slate-600">One-on-One</p>
        </article>

        <article className="rounded-2xl bg-slate-100 p-4">
          <p className="text-[31px] text-slate-500">Package Progress</p>
          <div className="mt-2 flex items-center justify-between text-[42px] font-semibold">
            <p>Sessions Remaining</p>
            <p className="text-[#2f66e0]">7 / 12</p>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-300">
            <div className="h-full w-2/3 rounded-full bg-[#2f66e0]" />
          </div>
        </article>

        <article className="rounded-2xl border-l-4 border-emerald-500 bg-emerald-50 p-4">
          <p className="text-[42px] font-semibold text-emerald-700">Payment Received</p>
          <p className="text-[34px] text-emerald-700">Package fully paid</p>
        </article>

        <button type="button" className="h-14 w-full rounded-xl bg-[#2f66e0] text-[35px] font-semibold text-white">
          Mark Complete
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="h-14 rounded-xl border-2 border-[#2f66e0] bg-white text-[35px] font-semibold text-[#2f66e0]"
          >
            Reschedule
          </button>
          <button
            type="button"
            className="h-14 rounded-xl border-2 border-red-500 bg-white text-[35px] font-semibold text-red-500"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SchedulePage() {
  const [activeSession, setActiveSession] = useState(null);

  const grid = useMemo(() => {
    return timeSlots.map((time) =>
      weekDays.map((day) => ({
        day: day.key,
        time,
        session: sessionAt(day.key, time)
      }))
    );
  }, []);

  return (
    <section>
      <header className="bg-[#2f66e0] px-5 py-5 text-white">
        <h1 className="text-[44px] font-semibold leading-none">Schedule</h1>
        <p className="mt-1 text-base text-blue-100">Book and manage sessions</p>
      </header>

      <div className="overflow-auto pb-6">
        <div className="border-b border-slate-300 bg-white px-5 py-4">
          <div className="flex items-center justify-between text-[42px] font-semibold">
            <button type="button" aria-label="Previous week">
              <ArrowLeftIcon size={30} />
            </button>
            <h2>Nov 11 - Nov 17, 2024</h2>
            <button type="button" aria-label="Next week">
              <ArrowRightIcon size={30} />
            </button>
          </div>
        </div>

        <table className="min-w-[980px] table-fixed border-collapse text-left">
          <thead>
            <tr>
              <th className="w-20 border border-slate-300 bg-white px-2 py-2 text-[28px] text-slate-500">
                <ClockIcon size={18} />
              </th>
              {weekDays.map((day) => (
                <th
                  key={day.key}
                  className="w-44 border border-slate-300 bg-white px-2 py-2 text-center text-[31px] font-medium text-slate-600"
                >
                  <p>{day.label}</p>
                  <p className="text-[37px] font-semibold text-slate-900">{day.day}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row[0].time}>
                <td className="border border-slate-300 px-2 align-top text-[31px] font-semibold text-slate-600">
                  {row[0].time}
                </td>
                {row.map((cell) => (
                  <td key={`${cell.day}-${cell.time}`} className="h-20 border border-slate-300 p-1 align-top">
                    {cell.session && (
                      <button
                        type="button"
                        onClick={() => setActiveSession({ ...cell.session, time: cell.time })}
                        className={`h-full w-full rounded-sm px-2 py-1 text-left ${
                          cell.session.paid ? "bg-emerald-50" : "bg-red-50"
                        }`}
                      >
                        <p className="text-[31px] font-semibold leading-none">{cell.session.client}</p>
                        <p className="mt-1 text-[28px] text-slate-600">{cell.session.program}</p>
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex items-center justify-center gap-6 border-t border-slate-300 bg-white py-3 text-[32px]">
          <span className="flex items-center gap-2">
            <span className="inline-block h-5 w-5 rounded border border-emerald-300 bg-emerald-50" />
            Paid
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-5 w-5 rounded border border-red-300 bg-red-50" />
            Unpaid
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-5 w-5 rounded border border-slate-300 bg-white" />
            Available
          </span>
        </div>
      </div>

      <button
        type="button"
        className="fixed bottom-24 right-5 grid h-16 w-16 place-items-center rounded-full bg-[#2f66e0] text-white shadow-lg"
        aria-label="Add session"
      >
        <PlusIcon size={28} />
      </button>

      <SessionDetailsModal session={activeSession} onClose={() => setActiveSession(null)} />
    </section>
  );
}
