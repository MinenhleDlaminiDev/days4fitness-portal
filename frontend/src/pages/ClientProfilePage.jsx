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
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeftIcon />
          </button>
          <h1 className="page-title text-2xl sm:text-3xl">{client.name}</h1>
        </div>
        <Link to={`/clients/${client.id}/edit`} aria-label="Edit client">
          <EditIcon />
        </Link>
      </header>

      <article className="surface-card">
        <h2 className="section-title">Contact Information</h2>
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-slate-700 sm:text-base">
            <PhoneIcon className="text-emerald-700" />
            <a href={`tel:${client.phone}`} className="underline underline-offset-4">
              {client.phone}
            </a>
          </p>
          <p className="flex items-center gap-2 text-sm text-slate-700 sm:text-base">
            <MailIcon className="text-emerald-700" />
            <a href={`mailto:${client.email}`} className="underline underline-offset-4">
              {client.email}
            </a>
          </p>
        </div>
      </article>

      <article className="surface-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0">Current Package</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-sm font-semibold text-emerald-700">
            <CheckCircleIcon size={16} className="text-emerald-600" />
            Paid
          </span>
        </div>
        <p className="text-sm text-slate-600">Program</p>
        <p className="text-lg font-semibold sm:text-xl">{client.program}</p>
        <p className="mt-3 text-sm text-slate-600">Package</p>
        <p className="text-lg font-semibold sm:text-xl">
          {client.sessionsTotal} Sessions - {client.sessionType}
        </p>
        <p className="text-base text-slate-700 sm:text-lg">R{packagePrice(client.sessionType, client.sessionsTotal)}</p>

        <hr className="my-3 border-slate-200" />

        <div className="flex items-center justify-between text-sm sm:text-base">
          <p className="text-slate-600">Sessions Progress</p>
          <p className="font-semibold">
            {client.sessionsUsed} / {client.sessionsTotal}
          </p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-emerald-700" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-lg font-semibold text-emerald-700 sm:text-xl">{sessionsLeft} sessions remaining</p>

        <hr className="my-3 border-slate-200" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-sm text-slate-600">Purchase Date</p>
            <p className="text-base font-semibold sm:text-lg">{formatShortDate(client.purchaseDate)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Expiry Date</p>
            <p className="text-base font-semibold sm:text-lg">{formatShortDate(client.expiryDate)}</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-700">
          Package expires in {daysUntil(client.expiryDate)} days
        </div>
      </article>

      <div className="surface-card space-y-2">
        <button type="button" className="action-btn action-btn-primary w-full">
          Mark Session Complete
        </button>
        <button type="button" className="action-btn action-btn-secondary w-full">
          Schedule New Session
        </button>
      </div>

      <article className="surface-card">
        <h2 className="section-title">Session History</h2>
        <div className="space-y-2">
          {profileSessionHistory.map((entry) => (
            <div key={`${entry.date}-${entry.time}`} className="border-b border-slate-200 py-2 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold sm:text-lg">{formatShortDate(entry.date)}</p>
                  <p className="text-sm text-slate-600">{entry.time}</p>
                </div>
                <p className="text-sm text-slate-600">{entry.completed ? "Completed" : "Pending"}</p>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
