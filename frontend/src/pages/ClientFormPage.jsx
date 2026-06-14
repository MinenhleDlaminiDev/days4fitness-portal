import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft as ArrowLeftIcon } from "lucide-react";
import { addMonths, localDateInputValue } from "../lib/date.js";
import { createClient, getApiErrorMessage } from "../lib/api.js";
import { useAppConfiguration } from "../context/AppConfigurationContext.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";

const fieldClass =
  "mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none transition focus:border-emerald-700 sm:text-base";

export default function ClientFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { configuration, timeSlotsForDay } = useAppConfiguration();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    program: "",
    sessionType: "One-on-One",
    packageSize: "",
    purchaseDate: localDateInputValue(),
    paid: false,
    preferredDays: [],
    preferredSchedule: {}
  });

  const expiryMonths = configuration?.packageExpiryMonths ?? 0;
  const expiryDate = useMemo(
    () => (expiryMonths ? addMonths(form.purchaseDate, expiryMonths) : ""),
    [expiryMonths, form.purchaseDate]
  );
  const saturdayHours = configuration?.businessHours.find((item) => item.day === "Saturday");
  const lastSaturdaySlot = saturdayHours?.timeSlots.at(-1);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function togglePreferredDay(day) {
    setForm((current) => {
      const exists = current.preferredDays.includes(day);
      return {
        ...current,
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
    setForm((current) => {
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

  async function submitForm(event) {
    event.preventDefault();
    if (isEdit) {
      setSaveError("Editing is not available yet.");
      return;
    }
    for (const day of form.preferredDays) {
      const slots = form.preferredSchedule[day] || [];
      if (slots.length === 0) {
        setSaveError(`Please select at least one preferred time for ${day}.`);
        return;
      }
    }

    try {
      setIsSaving(true);
      setSaveError("");
      const savedClient = await createClient({
        ...form,
        packageSize: Number(form.packageSize)
      });
      navigate(`/clients/${savedClient.id}`);
    } catch (error) {
      const message = getApiErrorMessage(error, "Unable to save client right now.");
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeftIcon size={20} className="stroke-[1.75]" />
          </button>
          <div>
            <h1 className="page-title text-2xl sm:text-3xl">{isEdit ? "Edit Client" : "Add New Client"}</h1>
            <p className="text-sm text-emerald-100">Client intake form</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <form className="space-y-4" onSubmit={submitForm}>
        {saveError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}
        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">Basic Information</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Name *</span>
              <input
                required
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className={fieldClass}
                placeholder="Enter client name"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Phone Number *</span>
              <input
                required
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                className={fieldClass}
                placeholder="+27 82 123 4567"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Email (Optional)</span>
              <input
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className={fieldClass}
                placeholder="client@email.com"
              />
            </label>
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">Package Details</h2>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium sm:text-base">Program *</span>
              <select
                required
                value={form.program}
                onChange={(event) => updateField("program", event.target.value)}
                className={fieldClass}
              >
                <option value="">Select a program</option>
                {(configuration?.programs || [])
                  .filter((program) => program.sessionType === form.sessionType)
                  .map((program) => (
                  <option key={program.id} value={program.name}>
                    {program.name}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <p className="mb-2 text-sm font-medium sm:text-base">Session Type *</p>
              <div className="grid grid-cols-2 gap-3">
                {["One-on-One", "Group"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        sessionType: type,
                        program: ""
                      }))
                    }
                    className={`h-12 rounded-xl border text-sm font-semibold transition sm:text-base ${
                      form.sessionType === type
                        ? "border-emerald-700 bg-emerald-50 text-emerald-700"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-medium sm:text-base">Package Size *</span>
              <select
                required
                value={form.packageSize}
                onChange={(event) => updateField("packageSize", event.target.value)}
                className={fieldClass}
              >
                <option value="">Select package size</option>
                {(configuration?.packageSizes || []).map((size) => (
                  <option key={size} value={size}>
                    {size} Session{size > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium sm:text-base">Purchase Date *</span>
              <input
                required
                type="date"
                value={form.purchaseDate}
                onChange={(event) => updateField("purchaseDate", event.target.value)}
                className={fieldClass}
              />
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium sm:text-base">Preferred Training Days (Optional)</p>
                <span className="text-xs text-slate-500">{form.preferredDays.length} selected</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(configuration?.businessHours || []).map(({ day }) => {
                  const isSelected = form.preferredDays.includes(day);
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

            {form.preferredDays.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium sm:text-base">Preferred Hours *</p>
                {form.preferredDays.map((day) => {
                  const selectedSlots = form.preferredSchedule[day] || [];
                  return (
                    <div key={day} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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

            <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 p-3">
              <p className="text-sm text-slate-600">Package Expires</p>
              <p className="text-lg font-semibold text-amber-700 sm:text-xl">{expiryDate}</p>
              <p className="text-sm text-slate-500">
                {expiryMonths} months from purchase date
              </p>
            </div>
          </div>
        </article>

        <article className="surface-card">
          <h2 className="section-title text-base sm:text-lg">Payment Status</h2>
          <label className="flex items-center gap-3 text-sm sm:text-base">
            <input
              type="checkbox"
              checked={form.paid}
              onChange={(event) => updateField("paid", event.target.checked)}
              className="h-5 w-5 rounded border-slate-300"
            />
            Client has paid for this package
          </label>
        </article>

        <button
          type="submit"
          disabled={isSaving}
          className="action-btn action-btn-primary w-full disabled:opacity-70"
        >
          {isSaving ? "Saving..." : "Save Client"}
        </button>
      </form>
    </section>
  );
}
