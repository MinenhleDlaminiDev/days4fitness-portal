import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarClock,
  Check,
  Dumbbell,
  Layers,
  Plus,
  Settings as SettingsIcon,
  X
} from "lucide-react";
import SuccessToast from "../components/SuccessToast.jsx";
import { useAppConfiguration } from "../context/AppConfigurationContext.jsx";
import {
  getApiErrorMessage,
  updateBusinessHours,
  updatePackageSizes,
  updatePricing,
  updatePrograms,
  updateSchedulingSettings
} from "../lib/api.js";
import { pluralise } from "../lib/text.js";

const SESSION_TYPES = ["One-on-One", "Group"];
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Mirrors the limit the configuration service enforces.
const MAX_PROGRAM_NAME = 60;

// Matches the window the sessions table still enforces, so the page only offers
// slots that can actually be booked.
const SLOT_HOURS = Array.from(
  { length: 15 },
  (_, index) => `${String(index + 5).padStart(2, "0")}:00`
);
const SATURDAY_LAST_SLOT = "10:00";

function slotsForDay(day) {
  return day === "Saturday" ? SLOT_HOURS.filter((slot) => slot <= SATURDAY_LAST_SLOT) : SLOT_HOURS;
}

function Section({ icon: Icon, title, description, children }) {
  return (
    <section className="surface-card space-y-4">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-tint text-accent">
          <Icon size={18} />
        </span>
        <div>
          <h2 className="text-base font-bold text-strong">{title}</h2>
          <p className="text-xs text-muted">{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function SaveRow({ onSave, isSaving, isDirty, error, saved }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
      <button
        type="button"
        onClick={onSave}
        disabled={isSaving || !isDirty}
        className="action-btn action-btn-primary"
      >
        {isSaving ? "Saving..." : "Save changes"}
      </button>
      {!isDirty && saved && (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-success-text">
          <Check size={14} /> Saved
        </span>
      )}
      {error && (
        <p className="w-full rounded-xl border border-danger-border bg-danger-soft p-3 text-sm font-semibold text-danger-strong">
          {error}
        </p>
      )}
    </div>
  );
}

// One editable section: local draft, dirty tracking, save, and its own error.
function useSection(initial, request, applyConfiguration) {
  const [value, setValue] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const isDirty = useMemo(() => JSON.stringify(value) !== JSON.stringify(initial), [value, initial]);

  async function save() {
    try {
      setIsSaving(true);
      setError("");
      applyConfiguration(await request(value));
      setSaved(true);
      return true;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not save these settings."));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return { value, setValue, isDirty, isSaving, error, saved, save };
}

export default function SettingsPage() {
  const { configuration, applyConfiguration } = useAppConfiguration();
  const [notice, setNotice] = useState("");
  const [newSize, setNewSize] = useState("");

  const initialPricing = useMemo(() => {
    const sizes = configuration?.packageSizes ?? [];
    return SESSION_TYPES.flatMap((sessionType) =>
      sizes.map((sessionsTotal) => ({
        sessionType,
        sessionsTotal,
        price: String(
          configuration?.pricing.find(
            (row) => row.sessionType === sessionType && row.sessionsTotal === sessionsTotal
          )?.price ?? 0
        )
      }))
    );
  }, [configuration]);

  const initialPrograms = useMemo(
    () =>
      (configuration?.programs ?? []).map((program) => ({
        id: program.id,
        name: program.name,
        sessionType: program.sessionType
      })),
    [configuration]
  );

  const initialHours = useMemo(
    () =>
      WEEK.map((day) => ({
        day,
        timeSlots: configuration?.businessHours.find((row) => row.day === day)?.timeSlots ?? []
      })),
    [configuration]
  );

  const initialScheduling = useMemo(
    () => ({
      groupCapacity: String(configuration?.groupCapacity ?? ""),
      sessionDurationMinutes: String(configuration?.sessionDurationMinutes ?? ""),
      packageExpiryMonths: String(configuration?.packageExpiryMonths ?? "")
    }),
    [configuration]
  );

  const pricing = useSection(
    initialPricing,
    (rows) =>
      updatePricing(
        rows.map((row) => ({
          sessionType: row.sessionType,
          sessionsTotal: row.sessionsTotal,
          price: Number(row.price)
        }))
      ),
    applyConfiguration
  );
  const sizes = useSection(
    configuration?.packageSizes ?? [],
    updatePackageSizes,
    applyConfiguration
  );
  const programs = useSection(initialPrograms, updatePrograms, applyConfiguration);
  const hours = useSection(initialHours, updateBusinessHours, applyConfiguration);
  const scheduling = useSection(
    initialScheduling,
    (values) =>
      updateSchedulingSettings({
        groupCapacity: Number(values.groupCapacity),
        sessionDurationMinutes: Number(values.sessionDurationMinutes),
        packageExpiryMonths: Number(values.packageExpiryMonths)
      }),
    applyConfiguration
  );

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function saveSection(section, message) {
    if (await section.save()) setNotice(message);
  }

  function setPrice(index, nextPrice) {
    pricing.setValue(
      pricing.value.map((row, position) => (position === index ? { ...row, price: nextPrice } : row))
    );
  }

  function setProgramName(index, name) {
    programs.setValue(
      programs.value.map((row, position) => (position === index ? { ...row, name } : row))
    );
  }

  // A new program has no id until it is saved; that is what tells the API to
  // create it rather than rename something.
  function addProgram(sessionType) {
    programs.setValue([...programs.value, { name: "", sessionType }]);
  }

  function removeProgram(index) {
    programs.setValue(programs.value.filter((row, position) => position !== index));
  }

  function addSize() {
    const value = Number(newSize);
    if (!Number.isInteger(value) || value < 1 || sizes.value.includes(value)) return;
    sizes.setValue([...sizes.value, value].sort((a, b) => a - b));
    setNewSize("");
  }

  function removeSize(size) {
    sizes.setValue(sizes.value.filter((item) => item !== size));
  }

  function toggleSlot(day, slot) {
    hours.setValue(
      hours.value.map((row) => {
        if (row.day !== day) return row;
        const has = row.timeSlots.includes(slot);
        return {
          ...row,
          timeSlots: has
            ? row.timeSlots.filter((item) => item !== slot)
            : [...row.timeSlots, slot].sort()
        };
      })
    );
  }

  if (!configuration) {
    return (
      <section className="page-wrap">
        <p className="p-6 text-sm text-muted">Loading settings...</p>
      </section>
    );
  }

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100">
          Trainer workspace
        </p>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Your prices, training hours and scheduling rules</p>
      </header>

      <Section
        icon={Dumbbell}
        title="Programs"
        description="What you train people in, per session type."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {SESSION_TYPES.map((sessionType) => (
            <div key={sessionType} className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-subtle">{sessionType}</p>
              {programs.value
                .map((row, index) => ({ row, index }))
                .filter(({ row }) => row.sessionType === sessionType)
                .map(({ row, index }) => (
                  <div key={row.id ?? `new-${index}`} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.name}
                      maxLength={MAX_PROGRAM_NAME}
                      onChange={(event) => setProgramName(index, event.target.value)}
                      aria-label={`${sessionType} program name`}
                      className="h-11 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
                    />
                    <button
                      type="button"
                      onClick={() => removeProgram(index)}
                      aria-label={`Remove ${row.name || "this program"}`}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-subtle"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              <button
                type="button"
                onClick={() => addProgram(sessionType)}
                className="action-btn action-btn-secondary"
              >
                <Plus size={15} className="mr-1" /> Add {sessionType.toLowerCase()} program
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-subtle">
          Renaming a program updates it everywhere, including past packages and reports. A
          program keeps the session type it was created with, because its existing sessions are
          recorded against it — add a new program instead. One that clients already have packages
          on cannot be removed.
        </p>
        <SaveRow
          onSave={() => saveSection(programs, "Programs saved.")}
          isSaving={programs.isSaving}
          isDirty={programs.isDirty}
          error={programs.error}
          saved={programs.saved}
        />
      </Section>

      <Section
        icon={Layers}
        title="Package sizes"
        description="How many sessions a package can be sold in."
      >
        <div className="flex flex-wrap gap-2">
          {sizes.value.map((size) => (
            <span
              key={size}
              className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-raised py-1 pl-3 pr-1 text-sm font-semibold text-copy"
            >
              {size}
              <button
                type="button"
                onClick={() => removeSize(size)}
                aria-label={`Remove the ${size} session package`}
                className="grid h-9 w-9 place-items-center rounded-lg text-subtle"
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="Sessions"
            value={newSize}
            onChange={(event) => setNewSize(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addSize();
              }
            }}
            className="h-11 w-32 rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
          />
          <button
            type="button"
            onClick={addSize}
            disabled={!newSize}
            className="action-btn action-btn-secondary"
          >
            <Plus size={15} className="mr-1" /> Add size
          </button>
        </div>
        <p className="text-xs text-subtle">
          A new size starts at R0 for both session types — set its price below. A size clients
          have already bought cannot be removed.
        </p>
        <SaveRow
          onSave={() => saveSection(sizes, "Package sizes saved.")}
          isSaving={sizes.isSaving}
          isDirty={sizes.isDirty}
          error={sizes.error}
          saved={sizes.saved}
        />
      </Section>

      <Section
        icon={Banknote}
        title="Package pricing"
        description="What each package costs, per session type."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {SESSION_TYPES.map((sessionType) => (
            <div key={sessionType} className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-subtle">{sessionType}</p>
              {pricing.value
                .map((row, index) => ({ row, index }))
                .filter(({ row }) => row.sessionType === sessionType)
                .map(({ row, index }) => (
                  <label
                    key={`${row.sessionType}-${row.sessionsTotal}`}
                    className="flex items-center gap-2"
                  >
                    <span className="w-24 shrink-0 text-sm text-copy">
                      {row.sessionsTotal} {pluralise(row.sessionsTotal, "session")}
                    </span>
                    <span className="text-sm text-subtle">R</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={row.price}
                      onChange={(event) => setPrice(index, event.target.value)}
                      className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
                    />
                  </label>
                ))}
            </div>
          ))}
        </div>
        <SaveRow
          onSave={() => saveSection(pricing, "Pricing saved.")}
          isSaving={pricing.isSaving}
          isDirty={pricing.isDirty}
          error={pricing.error}
          saved={pricing.saved}
        />
      </Section>

      <Section
        icon={CalendarClock}
        title="Training hours"
        description="Your own week. Tap a time to offer it or take it off your schedule."
      >
        <div className="space-y-4">
          {hours.value.map((row) => (
            <div key={row.day}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold text-strong">{row.day}</p>
                <span className="text-xs text-subtle">
                  {row.timeSlots.length} {row.timeSlots.length === 1 ? "slot" : "slots"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {slotsForDay(row.day).map((slot) => {
                  const active = row.timeSlots.includes(slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSlot(row.day, slot)}
                      className={`inline-flex h-11 min-w-[76px] items-center justify-center gap-1 rounded-xl border px-3 text-xs font-semibold transition ${
                        active
                          ? "border-accent bg-brand-tint text-accent"
                          : "border-line bg-surface text-subtle"
                      }`}
                    >
                      {active ? <Check size={13} /> : <Plus size={13} />}
                      {slot}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <SaveRow
          onSave={() => saveSection(hours, "Training hours saved.")}
          isSaving={hours.isSaving}
          isDirty={hours.isDirty}
          error={hours.error}
          saved={hours.saved}
        />
      </Section>

      <Section
        icon={SettingsIcon}
        title="Scheduling rules"
        description="Your group size, session length and how long a package stays valid."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { key: "groupCapacity", label: "Group capacity", suffix: "clients per group" },
            { key: "sessionDurationMinutes", label: "Session length", suffix: "minutes" },
            { key: "packageExpiryMonths", label: "Package expiry", suffix: "months" }
          ].map((field) => (
            <label key={field.key} className="block">
              <span className="text-xs font-bold uppercase tracking-wide text-subtle">
                {field.label}
              </span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={scheduling.value[field.key]}
                onChange={(event) =>
                  scheduling.setValue({ ...scheduling.value, [field.key]: event.target.value })
                }
                className="mt-2 h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
              />
              <span className="mt-1 block text-xs text-subtle">{field.suffix}</span>
            </label>
          ))}
        </div>
        <p className="rounded-xl border border-warn-border bg-warn-soft p-3 text-xs text-warn-text">
          A new package expiry applies to packages bought from now on. Packages already sold keep
          the window they were sold with.
        </p>
        <SaveRow
          onSave={() => saveSection(scheduling, "Scheduling rules saved.")}
          isSaving={scheduling.isSaving}
          isDirty={scheduling.isDirty}
          error={scheduling.error}
          saved={scheduling.saved}
        />
      </Section>

      <SuccessToast message={notice} onDismiss={() => setNotice("")} />
    </section>
  );
}
