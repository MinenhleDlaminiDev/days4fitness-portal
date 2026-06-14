import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft as ArrowLeftIcon,
  CircleCheck as CheckCircleIcon,
  CircleX as XCircleIcon,
  Mail as MailIcon,
  Pencil as EditIcon,
  Phone as PhoneIcon
} from "lucide-react";
import { profileSessionHistory } from "../data/mockData.js";
import { daysUntil, formatShortDate } from "../lib/date.js";
import { fetchClientById, getApiErrorMessage, updateClientPreferences } from "../lib/api.js";
import { useAppConfiguration } from "../context/AppConfigurationContext.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

export default function ClientProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { configuration, packagePrice, timeSlotsForDay } = useAppConfiguration();
  const lastSaturdaySlot = configuration?.businessHours
    .find((item) => item.day === "Saturday")
    ?.timeSlots.at(-1);
  const [client, setClient] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isEditingPreferences, setIsEditingPreferences] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState("");
  const [preferenceForm, setPreferenceForm] = useState({
    preferredDays: [],
    preferredSchedule: {}
  });

  useEffect(() => {
    let mounted = true;

    async function loadClient() {
      try {
        setIsLoading(true);
        setLoadError("");
        const row = await fetchClientById(id);
        if (!mounted) return;
        setClient(row);
        setPreferenceForm({
          preferredDays: Array.isArray(row.preferredDays) ? row.preferredDays : [],
          preferredSchedule:
            row.preferredSchedule && typeof row.preferredSchedule === "object" ? row.preferredSchedule : {}
        });
      } catch (error) {
        if (!mounted) return;
        const message = getApiErrorMessage(error, "Unable to load this client.");
        setLoadError(message);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadClient();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (isLoading) {
    return (
      <section className="page-wrap">
        <div className="surface-card text-sm text-slate-600">Loading client...</div>
      </section>
    );
  }

  if (!client || loadError) {
    return (
      <section className="page-wrap space-y-4">
        <header className="page-header flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(-1)} aria-label="Go back">
              <ArrowLeftIcon size={20} className="stroke-[1.75]" />
            </button>
            <div>
              <h1 className="page-title text-2xl sm:text-3xl">Client Not Found</h1>
              <p className="text-sm text-emerald-100">Client profile</p>
            </div>
          </div>
          <ThemeToggle />
        </header>
        <article className="surface-card text-sm text-red-700">{loadError || "This client does not exist."}</article>
      </section>
    );
  }

  const sessionsLeft = client.sessionsTotal - client.sessionsUsed;
  const progress = client.sessionsTotal > 0 ? (client.sessionsUsed / client.sessionsTotal) * 100 : 0;
  const hasAnyPreference = Array.isArray(client.preferredDays) && client.preferredDays.length > 0;

  function togglePreferredDay(day) {
    setPreferenceForm((current) => {
      const exists = current.preferredDays.includes(day);
      return {
        preferredDays: exists
          ? current.preferredDays.filter((item) => item !== day)
          : [...current.preferredDays, day],
        preferredSchedule: exists
          ? Object.fromEntries(Object.entries(current.preferredSchedule).filter(([key]) => key !== day))
          : { ...current.preferredSchedule, [day]: [] }
      };
    });
  }

  function togglePreferredTime(day, time) {
    setPreferenceForm((current) => {
      const existing = Array.isArray(current.preferredSchedule[day]) ? current.preferredSchedule[day] : [];
      const isSelected = existing.includes(time);
      return {
        ...current,
        preferredSchedule: {
          ...current.preferredSchedule,
          [day]: isSelected ? existing.filter((slot) => slot !== time) : [...existing, time]
        }
      };
    });
  }

  function openPreferencesEditor() {
    setPreferencesError("");
    setPreferenceForm({
      preferredDays: Array.isArray(client.preferredDays) ? client.preferredDays : [],
      preferredSchedule:
        client.preferredSchedule && typeof client.preferredSchedule === "object" ? client.preferredSchedule : {}
    });
    setIsEditingPreferences(true);
  }

  function closePreferencesEditor() {
    setPreferencesError("");
    setIsEditingPreferences(false);
  }

  async function savePreferences() {
    for (const day of preferenceForm.preferredDays) {
      const slots = preferenceForm.preferredSchedule[day] || [];
      if (slots.length === 0) {
        setPreferencesError(`Please select at least one preferred time for ${day}.`);
        return;
      }
    }

    try {
      setIsSavingPreferences(true);
      setPreferencesError("");
      const updated = await updateClientPreferences(client.id, preferenceForm);
      setClient(updated);
      setIsEditingPreferences(false);
    } catch (error) {
      const message = getApiErrorMessage(error, "Unable to save preferences.");
      setPreferencesError(message);
    } finally {
      setIsSavingPreferences(false);
    }
  }

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeftIcon size={20} className="stroke-[1.75]" />
          </button>
          <div>
            <h1 className="page-title text-2xl sm:text-3xl">{client.name}</h1>
            <p className="text-sm text-emerald-100">Client profile</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to={`/clients/${client.id}/edit`} aria-label="Edit client">
            <EditIcon size={20} className="stroke-[1.75]" />
          </Link>
        </div>
      </header>

      <article className="surface-card">
        <h2 className="section-title text-base sm:text-lg">Contact Information</h2>
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-slate-700 sm:text-base">
            <PhoneIcon size={18} className="stroke-[1.75] text-emerald-700" />
            <a href={`tel:${client.phone}`} className="underline underline-offset-4">
              {client.phone}
            </a>
          </p>
          <p className="flex items-center gap-2 text-sm text-slate-700 sm:text-base">
            <MailIcon size={18} className="stroke-[1.75] text-emerald-700" />
            {client.email ? (
              <a href={`mailto:${client.email}`} className="underline underline-offset-4">
                {client.email}
              </a>
            ) : (
              <span>No email added</span>
            )}
          </p>
        </div>
        <div className="mt-4">
          <p className="text-sm text-slate-600">Preferred Training Days</p>
          <p className="text-base font-semibold sm:text-lg">
            {hasAnyPreference ? client.preferredDays.join(", ") : "Not set"}
          </p>
        </div>
        <div className="mt-3">
          <p className="text-sm text-slate-600">Preferred Hours</p>
          {hasAnyPreference ? (
            <div className="mt-1 space-y-1">
              {client.preferredDays.map((day) => {
                const slots = Array.isArray(client.preferredSchedule?.[day]) ? client.preferredSchedule[day] : [];
                return (
                  <p key={day} className="text-sm text-slate-700 sm:text-base">
                    <span className="font-semibold">{day}:</span> {slots.length ? slots.join(", ") : "Not set"}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="text-base font-semibold sm:text-lg">Not set</p>
          )}
        </div>
        {!isEditingPreferences ? (
          <button type="button" onClick={openPreferencesEditor} className="action-btn action-btn-secondary mt-3 w-full">
            {hasAnyPreference ? "Change Session Preferences" : "Set Session Preferences"}
          </button>
        ) : (
          <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            {preferencesError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {preferencesError}
              </div>
            )}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium sm:text-base">Training Days</p>
                <span className="text-xs text-slate-500">{preferenceForm.preferredDays.length} selected</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(configuration?.businessHours || []).map(({ day }) => {
                  const isSelected = preferenceForm.preferredDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => togglePreferredDay(day)}
                      className={`h-10 rounded-xl border px-3 text-sm font-semibold transition ${
                        isSelected
                          ? "border-emerald-700 bg-emerald-50 text-emerald-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Training is available on the days shown.
                {lastSaturdaySlot ? ` Saturday's last start time is ${lastSaturdaySlot}.` : ""}
              </p>
            </div>

            {preferenceForm.preferredDays.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium sm:text-base">Preferred Hours</p>
                {preferenceForm.preferredDays.map((day) => {
                  const selectedSlots = preferenceForm.preferredSchedule[day] || [];
                  return (
                    <div key={day} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{day}</p>
                        <span className="text-xs text-slate-500">{selectedSlots.length} selected</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {timeSlotsForDay(day).map((slot) => {
                          const isSelected = selectedSlots.includes(slot);
                          return (
                            <button
                              key={`${day}-${slot}`}
                              type="button"
                              onClick={() => togglePreferredTime(day, slot)}
                              className={`h-9 rounded-lg border px-2 text-xs font-semibold transition sm:text-sm ${
                                isSelected
                                  ? "border-emerald-700 bg-emerald-50 text-emerald-700"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {slot}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={closePreferencesEditor}
                disabled={isSavingPreferences}
                className="action-btn action-btn-secondary w-full"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePreferences}
                disabled={isSavingPreferences}
                className="action-btn action-btn-primary w-full disabled:opacity-70"
              >
                {isSavingPreferences
                  ? "Saving..."
                  : preferenceForm.preferredDays.length === 0
                    ? "Clear Preferences"
                    : "Save Preferences"}
              </button>
            </div>
          </div>
        )}
      </article>

      <article className="surface-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0 text-base sm:text-lg">Current Package</h2>
          {client.paid ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-sm font-semibold text-emerald-700">
              <CheckCircleIcon size={14} className="stroke-[1.75] text-emerald-600" />
              Paid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-sm font-semibold text-red-700">
              <XCircleIcon size={14} className="stroke-[1.75] text-red-600" />
              Unpaid
            </span>
          )}
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

        <div
          className={`mt-3 rounded-xl border-l-4 p-3 text-sm ${
            client.paid ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-700"
          }`}
        >
          {client.paid ? "Package fully paid" : "Package not fully paid"}
        </div>

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
        <h2 className="section-title text-base sm:text-lg">Session History</h2>
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
