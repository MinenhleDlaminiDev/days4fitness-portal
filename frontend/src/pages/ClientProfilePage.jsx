import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  EditIcon,
  MailIcon,
  PhoneIcon
} from "../components/Icons.jsx";
import { clients, profileSessionHistory } from "../data/mockData.js";
import { daysUntil, formatShortDate } from "../lib/date.js";
import { packagePrice } from "../lib/pricing.js";

export default function ClientProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const client = clients.find((item) => String(item.id) === id) || clients[0];

  const sessionsLeft = client.sessionsTotal - client.sessionsUsed;
  const progress = (client.sessionsUsed / client.sessionsTotal) * 100;

  return (
    <section>
      <header className="flex items-center justify-between bg-[#2f66e0] px-5 py-5 text-white">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeftIcon />
          </button>
          <h1 className="text-[40px] font-semibold">{client.name}</h1>
        </div>
        <Link to={`/clients/${client.id}/edit`} aria-label="Edit client">
          <EditIcon />
        </Link>
      </header>

      <div className="space-y-4 px-4 py-5">
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-[38px] font-semibold">Contact Information</h2>
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-[34px] text-slate-700">
              <PhoneIcon className="text-[#2f66e0]" />
              <a href={`tel:${client.phone}`} className="underline underline-offset-4">
                {client.phone}
              </a>
            </p>
            <p className="flex items-center gap-2 text-[34px] text-slate-700">
              <MailIcon className="text-[#2f66e0]" />
              <a href={`mailto:${client.email}`} className="underline underline-offset-4">
                {client.email}
              </a>
            </p>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[38px] font-semibold">Current Package</h2>
            <span className="flex items-center gap-1 text-[34px] font-semibold text-emerald-600">
              <CheckCircleIcon className="text-emerald-500" />
              Paid
            </span>
          </div>
          <p className="text-[30px] text-slate-600">Program</p>
          <p className="text-[36px] font-semibold">{client.program}</p>
          <p className="mt-3 text-[30px] text-slate-600">Package</p>
          <p className="text-[36px] font-semibold">
            {client.sessionsTotal} Sessions - {client.sessionType}
          </p>
          <p className="text-[35px] text-slate-700">R{packagePrice(client.sessionType, client.sessionsTotal)}</p>

          <hr className="my-3 border-slate-200" />

          <div className="flex items-center justify-between text-[32px]">
            <p className="text-slate-600">Sessions Progress</p>
            <p className="font-semibold">
              {client.sessionsUsed} / {client.sessionsTotal}
            </p>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-[#2f66e0]" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-[40px] font-semibold text-[#2f66e0]">{sessionsLeft} sessions remaining</p>

          <hr className="my-3 border-slate-200" />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[30px] text-slate-600">Purchase Date</p>
              <p className="text-[35px] font-semibold">{formatShortDate(client.purchaseDate)}</p>
            </div>
            <div>
              <p className="text-[30px] text-slate-600">Expiry Date</p>
              <p className="text-[35px] font-semibold">{formatShortDate(client.expiryDate)}</p>
            </div>
          </div>

          <div className="mt-3 rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-[31px] text-amber-700">
            Package expires in {daysUntil(client.expiryDate)} days
          </div>
        </article>

        <div className="space-y-2">
          <button type="button" className="h-14 w-full rounded-xl bg-[#2f66e0] text-[34px] font-semibold text-white">
            Mark Session Complete
          </button>
          <button
            type="button"
            className="h-14 w-full rounded-xl border-2 border-[#2f66e0] bg-white text-[34px] font-semibold text-[#2f66e0]"
          >
            Schedule New Session
          </button>
        </div>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-[38px] font-semibold">Session History</h2>
          <div className="space-y-2">
            {profileSessionHistory.map((entry) => (
              <div key={`${entry.date}-${entry.time}`} className="border-b border-slate-200 py-2 last:border-0">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[34px] font-semibold">{formatShortDate(entry.date)}</p>
                    <p className="text-[30px] text-slate-600">{entry.time}</p>
                  </div>
                  <p className="text-[30px] text-slate-600">{entry.completed ? "Completed" : "Pending"}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}
