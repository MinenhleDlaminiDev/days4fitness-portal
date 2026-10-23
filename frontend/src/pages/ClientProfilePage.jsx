import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Archive,
  ArrowLeft as ArrowLeftIcon,
  CalendarPlus,
  Check,
  CircleCheck as CheckCircleIcon,
  CircleX as XCircleIcon,
  CreditCard,
  Mail as MailIcon,
  Pencil as EditIcon,
  Plus,
  ReceiptText,
  Phone as PhoneIcon,
  RotateCcw as ReverseIcon,
  RotateCcw,
  UserX,
  X
} from "lucide-react";
import { addMonths, daysUntil, formatShortDate, localDateInputValue } from "../lib/date.js";
import {
  addPackagePayment,
  archiveClient,
  completeSession,
  createClientPackage,
  fetchClientById,
  fetchClientPackages,
  fetchClientSessions,
  getApiErrorMessage,
  markSessionNoShow,
  reversePackagePayment,
  restoreClient,
  updateClientPreferences
} from "../lib/api.js";
import {
  CONTACT_SUBJECTS,
  contactActions,
  expiringPackageMessage,
  generalMessage,
  outstandingPaymentMessage
} from "../lib/contact.js";
import { useAppConfiguration } from "../context/AppConfigurationContext.jsx";
import ContactActions from "../components/ContactActions.jsx";
import ClientGoals from "../components/ClientGoals.jsx";
import SuccessToast from "../components/SuccessToast.jsx";
import useDismissable from "../lib/useDismissable.js";

export default function ClientProfilePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { configuration, packagePrice, timeSlotsForDay } = useAppConfiguration();
  const lastSaturdaySlot = configuration?.businessHours
    .find((item) => item.day === "Saturday")
    ?.timeSlots.at(-1);
  const [client, setClient] = useState(null);
  const [goals, setGoals] = useState([]);
  const [packages, setPackages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [isEditingPreferences, setIsEditingPreferences] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showArchiveConfirmation, setShowArchiveConfirmation] = useState(false);
  const [activeSessionAction, setActiveSessionAction] = useState(null);
  const [packageAction, setPackageAction] = useState("");
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentToReverse, setPaymentToReverse] = useState(null);
  const [notice, setNotice] = useState(null);
  const [packageForm, setPackageForm] = useState({
    program: "",
    sessionType: "One-on-One",
    // Filled from the trainer's own package sizes once the configuration
    // arrives; see the effect below. Never a literal (SET-06).
    sessionsTotal: "",
    purchaseDate: localDateInputValue()
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    paymentDate: localDateInputValue(),
    method: "eft",
    reference: "",
    notes: ""
  });
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
        setHistoryError("");
        setClient(null);
        setGoals([]);
        setPackages([]);
        setSessions([]);
        const row = await fetchClientById(id);
        const [packageResult, sessionResult] = await Promise.allSettled([
          fetchClientPackages(id),
          fetchClientSessions(id)
        ]);
        if (!mounted) return;
        setClient(row);
        setGoals(Array.isArray(row.goals) ? row.goals : []);
        setPackages(packageResult.status === "fulfilled" ? packageResult.value || [] : []);
        setSessions(sessionResult.status === "fulfilled" ? sessionResult.value || [] : []);
        if (packageResult.status === "rejected" || sessionResult.status === "rejected") {
          setHistoryError("Some client history could not be loaded. Refresh to try again.");
        }
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

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  // SET-06: the sizes on offer are this trainer's own since AUTH-10, so the
  // renewal form cannot start on a literal. Snap to the first size the trainer
  // actually sells whenever the held value is not one of them: on first load,
  // and again if they change their sizes in /settings. Returning `current`
  // unchanged when it is already valid keeps this from looping.
  const packageSizes = configuration?.packageSizes;
  useEffect(() => {
    if (!packageSizes?.length) return;
    setPackageForm((current) =>
      packageSizes.includes(Number(current.sessionsTotal))
        ? current
        : { ...current, sessionsTotal: packageSizes[0] }
    );
  }, [packageSizes]);

  // Declared before the early returns below so the hook order stays stable.
  const closeArchiveConfirmation = useCallback(() => setShowArchiveConfirmation(false), []);
  const [isArchiveClosing, dismissArchiveConfirmation] = useDismissable(closeArchiveConfirmation);
  const closePaymentReversal = useCallback(() => setPaymentToReverse(null), []);
  const [isReversalClosing, dismissPaymentReversal] = useDismissable(closePaymentReversal);

  if (isLoading) {
    return (
      <section className="page-wrap">
        <div className="surface-card text-sm text-muted">Loading client...</div>
      </section>
    );
  }

  if (!client) {
    return (
      <section className="page-wrap space-y-4">
        <header className="page-header flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl"
            >
              <ArrowLeftIcon size={20} className="stroke-[1.75]" />
            </button>
            <div>
              <h1 className="page-title text-2xl sm:text-3xl">Client Not Found</h1>
              <p className="text-sm text-emerald-100">Client profile</p>
            </div>
          </div>
        </header>
        <article className="surface-card text-sm text-danger-strong">{loadError || "This client does not exist."}</article>
      </section>
    );
  }

  const sessionsLeft = client.sessionsTotal - client.sessionsUsed;
  const progress = client.sessionsTotal > 0 ? (client.sessionsUsed / client.sessionsTotal) * 100 : 0;
  const hasAnyPreference = Array.isArray(client.preferredDays) && client.preferredDays.length > 0;
  const sessionPreferences = Array.isArray(client.sessionPreferences)
    ? client.sessionPreferences
    : [];
  const currentPackage = packages[0] || null;
  const paymentStatus =
    client.paymentStatus ||
    (client.paid ? "paid" : Number(client.paidAmount || 0) > 0 ? "partially_paid" : "unpaid");
  const availablePrograms = (configuration?.programs || []).filter(
    (program) => program.sessionType === packageForm.sessionType
  );
  // SET-05: the expiry window is this trainer's own setting, and a renewal uses
  // it. The signup form shows the date it will produce; this one showed nothing,
  // so the screen where the window used to break gave no sign of it at all.
  const renewalExpiryMonths = configuration?.packageExpiryMonths ?? 0;
  const renewalExpiryDate = renewalExpiryMonths
    ? addMonths(packageForm.purchaseDate, renewalExpiryMonths)
    : "";
  // The draft message follows whatever most needs saying: money owed first,
  // then a package about to lapse, otherwise an opening line to type into.
  const expiresInDays = client.expiryDate ? daysUntil(client.expiryDate) : null;
  const contactDraft =
    Number(client.outstandingBalance || 0) > 0
      ? {
          subject: CONTACT_SUBJECTS.outstanding,
          message: outstandingPaymentMessage(
            client.name,
            client.outstandingBalance,
            client.program
          )
        }
      : sessionsLeft > 0 && expiresInDays !== null && expiresInDays >= 0 && expiresInDays <= 7
        ? {
            subject: CONTACT_SUBJECTS.expiring,
            message: expiringPackageMessage(
              client.name,
              sessionsLeft,
              formatShortDate(client.expiryDate)
            )
          }
        : { subject: CONTACT_SUBJECTS.general, message: generalMessage(client.name) };
  const clientContactActions = contactActions(
    { phone: client.phone, email: client.email },
    contactDraft
  );

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

  async function toggleArchive() {
    try {
      setIsUpdatingStatus(true);
      setActionError("");
      const updated = client.isActive
        ? await archiveClient(client.id)
        : await restoreClient(client.id);
      setClient(updated);
      setIsEditingPreferences(false);
      try {
        const sessionRows = await fetchClientSessions(client.id);
        setSessions(sessionRows || []);
        setHistoryError("");
      } catch {
        setHistoryError("Session history could not be refreshed. Refresh to try again.");
      }
      setNotice({
        title: updated.isActive ? "Client restored" : "Client archived",
        message: updated.isActive
          ? `${updated.name} is active again.`
          : `${updated.name} has been removed from active client workflows.`
      });
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Unable to update client status."));
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  async function recordSessionOutcome(session, outcome) {
    try {
      setActiveSessionAction(`${session.id}-${outcome}`);
      setActionError("");
      if (outcome === "completed") {
        await completeSession(session.id, client.id);
      } else {
        await markSessionNoShow(session.id, client.id);
      }
      const [updatedClient, sessionRows] = await Promise.all([
        fetchClientById(client.id),
        fetchClientSessions(client.id)
      ]);
      setClient(updatedClient);
      setSessions(sessionRows || []);
      setNotice({
        title: outcome === "completed" ? "Session completed" : "No-show recorded",
        message: "The session outcome and package credit were updated."
      });
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Unable to update this session."));
    } finally {
      setActiveSessionAction(null);
    }
  }

  async function refreshPackages() {
    const [updatedClient, packageRows] = await Promise.all([
      fetchClientById(client.id),
      fetchClientPackages(client.id)
    ]);
    setClient(updatedClient);
    setPackages(packageRows || []);
  }

  async function savePackage(event) {
    event.preventDefault();
    try {
      setPackageAction("package");
      setActionError("");
      await createClientPackage(client.id, {
        ...packageForm,
        sessionsTotal: Number(packageForm.sessionsTotal)
      });
      await refreshPackages();
      setShowPackageForm(false);
      setNotice({
        title: "Package created",
        message: "The new package is ready and existing preferences require approval."
      });
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Unable to create this package."));
    } finally {
      setPackageAction("");
    }
  }

  function openPaymentForm() {
    setPaymentForm({
      amount: currentPackage?.outstandingBalance
        ? String(currentPackage.outstandingBalance)
        : "",
      paymentDate: localDateInputValue(),
      method: "eft",
      reference: "",
      notes: ""
    });
    setShowPaymentForm(true);
  }

  async function savePayment(event) {
    event.preventDefault();
    try {
      setPackageAction("payment");
      setActionError("");
      await addPackagePayment(currentPackage.id, {
        ...paymentForm,
        amount: Number(paymentForm.amount)
      });
      await refreshPackages();
      setShowPaymentForm(false);
      setNotice({
        title: "Payment recorded",
        message: "The package balance has been updated."
      });
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Unable to record this payment."));
    } finally {
      setPackageAction("");
    }
  }

  async function reversePayment(payment) {
    try {
      setPackageAction(`reverse-${payment.id}`);
      setActionError("");
      await reversePackagePayment(payment.id, {
        paymentDate: localDateInputValue(),
        reference: `Reversal of payment ${payment.id}`,
        notes: "Payment correction"
      });
      await refreshPackages();
      setPaymentToReverse(null);
      setNotice({
        title: "Payment reversed",
        message: "The reversal was added and the package balance recalculated."
      });
    } catch (error) {
      setActionError(getApiErrorMessage(error, "Unable to reverse this payment."));
    } finally {
      setPackageAction("");
    }
  }

  return (
    <section className="page-wrap space-y-4 sm:space-y-5">
      <header className="page-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="-ml-2 grid h-11 w-11 shrink-0 place-items-center rounded-xl"
            >
            <ArrowLeftIcon size={20} className="stroke-[1.75]" />
          </button>
          <div>
            <h1 className="page-title text-2xl sm:text-3xl">{client.name}</h1>
            <p className="text-sm text-emerald-100">Client profile</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ContactActions
            clientName={client.name}
            variant="header"
            actions={clientContactActions}
          />
          {client.isActive && (
            <Link
              to={`/clients/${client.id}/edit`}
              aria-label="Edit client"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
            >
              <EditIcon size={20} className="stroke-[1.75]" />
            </Link>
          )}
        </div>
      </header>

      {!client.isActive && (
        <div className="rounded-2xl border border-warn-border bg-warn-soft p-4 text-sm font-semibold text-warn-text">
          This client is archived and excluded from active scheduling.
        </div>
      )}

      {actionError && (
        <div className="rounded-2xl border border-danger-border bg-danger-soft p-4 text-sm font-semibold text-danger-strong">
          {actionError}
        </div>
      )}

      {historyError && (
        <div className="rounded-2xl border border-warn-border bg-warn-soft p-4 text-sm font-semibold text-warn-text">
          {historyError}
        </div>
      )}

      {/* Two columns from lg up; a single stacked column on phones. */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2 lg:items-start">
      <div className="space-y-4 sm:space-y-5">

      <ClientGoals
        clientId={client.id}
        goals={goals}
        onGoalsChange={setGoals}
        canEdit={client.isActive}
      />

      <article className="surface-card">
        <h2 className="section-title text-base sm:text-lg">Contact Information</h2>
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-copy sm:text-base">
            <PhoneIcon size={18} className="stroke-[1.75] text-accent" />
            <a href={`tel:${client.phone}`} className="underline underline-offset-4">
              {client.phone}
            </a>
          </p>
          <p className="flex items-center gap-2 text-sm text-copy sm:text-base">
            <MailIcon size={18} className="stroke-[1.75] text-accent" />
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
          <p className="text-sm text-muted">Preferred Training Days</p>
          <p className="text-base font-semibold sm:text-lg">
            {hasAnyPreference ? client.preferredDays.join(", ") : "Not set"}
          </p>
        </div>
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">Session Times</p>
            {hasAnyPreference && (
              <div className="flex gap-2 text-xs font-semibold">
                <span className="rounded-full bg-brand-tint px-2 py-1 text-accent">
                  Approved
                </span>
                <span className="rounded-full bg-warn-tint px-2 py-1 text-warn-text">
                  Preference
                </span>
              </div>
            )}
          </div>
          {hasAnyPreference ? (
            <div className="mt-2 space-y-2">
              {client.preferredDays.map((day) => {
                const slots = Array.isArray(client.preferredSchedule?.[day]) ? client.preferredSchedule[day] : [];
                return (
                  <div key={day}>
                    <p className="text-sm font-semibold text-copy sm:text-base">{day}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {slots.map((slot) => {
                        const preference = sessionPreferences.find(
                          (item) => item.day === day && item.startTime === slot
                        );
                        const isApproved = preference?.status === "approved";
                        return (
                          <span
                            key={`${day}-${slot}`}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold sm:text-sm ${
                              isApproved
                                ? "border-success-border bg-brand-tint text-accent"
                                : "border-warn-border bg-warn-tint text-warn-text"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                isApproved ? "bg-brand" : "bg-warn-solid"
                              }`}
                            />
                            {slot}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-base font-semibold sm:text-lg">Not set</p>
          )}
        </div>
        {client.isActive &&
          (!isEditingPreferences ? (
            <button
              type="button"
              onClick={openPreferencesEditor}
              className="action-btn action-btn-secondary mt-3 w-full"
            >
              {hasAnyPreference ? "Change Session Preferences" : "Set Session Preferences"}
            </button>
          ) : (
            <div className="mt-3 space-y-3 rounded-xl border border-line bg-raised p-3">
              {preferencesError && (
                <div className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger-strong">
                  {preferencesError}
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium sm:text-base">Training Days</p>
                  <span className="text-xs text-subtle">
                    {preferenceForm.preferredDays.length} selected
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(configuration?.businessHours || []).map(({ day }) => {
                    const isSelected = preferenceForm.preferredDays.includes(day);
                    const selectedSlots = preferenceForm.preferredSchedule[day] || [];
                    const hasPendingSlot = selectedSlots.some(
                      (slot) =>
                        !sessionPreferences.some(
                          (item) =>
                            item.day === day &&
                            item.startTime === slot &&
                            item.status === "approved"
                        )
                    );
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => togglePreferredDay(day)}
                        className={`h-11 rounded-xl border px-3 text-sm font-semibold transition ${
                          isSelected
                            ? hasPendingSlot
                              ? "border-warn-border bg-warn-soft text-warn-text"
                              : "border-accent bg-success-soft text-accent"
                            : "border-line-strong bg-surface text-copy hover:bg-raised"
                        }`}
                      >
                        {day.slice(0, 3)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-subtle">
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
                      <div key={day} className="rounded-xl border border-line bg-surface p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-body">{day}</p>
                          <span className="text-xs text-subtle">
                            {selectedSlots.length} selected
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {timeSlotsForDay(day).map((slot) => {
                            const isSelected = selectedSlots.includes(slot);
                            const isApproved = sessionPreferences.some(
                              (item) =>
                                item.day === day &&
                                item.startTime === slot &&
                                item.status === "approved"
                            );
                            return (
                              <button
                                key={`${day}-${slot}`}
                                type="button"
                                onClick={() => togglePreferredTime(day, slot)}
                                className={`h-11 rounded-lg border px-2 text-xs font-semibold transition sm:text-sm ${
                                  isSelected
                                    ? isApproved
                                      ? "border-accent bg-success-soft text-accent"
                                      : "border-warn-border bg-warn-soft text-warn-text"
                                    : "border-line-strong bg-surface text-copy hover:bg-raised"
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
          ))}
      </article>

      <article className="surface-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0 text-base sm:text-lg">Current Package</h2>
          {paymentStatus === "paid" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-1 text-sm font-semibold text-accent">
              <CheckCircleIcon size={14} className="stroke-[1.75] text-accent" />
              Paid
            </span>
          ) : paymentStatus === "partially_paid" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-tint px-2 py-1 text-sm font-semibold text-warn-text">
              <CreditCard size={14} className="stroke-[1.75] text-warn-text" />
              Partially paid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-1 text-sm font-semibold text-danger-strong">
              <XCircleIcon size={14} className="stroke-[1.75] text-danger-strong" />
              Unpaid
            </span>
          )}
        </div>
        <p className="text-sm text-muted">Program</p>
        <p className="text-lg font-semibold sm:text-xl">{client.program}</p>
        <p className="mt-3 text-sm text-muted">Package</p>
        <p className="text-lg font-semibold sm:text-xl">
          {client.sessionsTotal} Sessions - {client.sessionType}
        </p>
        <p className="text-base text-copy sm:text-lg">
          R{Number(client.price || packagePrice(client.sessionType, client.sessionsTotal)).toFixed(2)}
        </p>

        <hr className="my-3 border-line" />

        <div className="flex items-center justify-between text-sm sm:text-base">
          <p className="text-muted">Sessions Progress</p>
          <p className="font-semibold">
            {client.sessionsUsed} / {client.sessionsTotal}
          </p>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-line">
          <div className="h-full rounded-full bg-brand-strong" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-lg font-semibold text-accent sm:text-xl">{sessionsLeft} sessions remaining</p>

        <div
          className={`mt-3 rounded-xl border-l-4 p-3 text-sm ${
            paymentStatus === "paid"
              ? "border-accent bg-success-soft text-accent"
              : paymentStatus === "partially_paid"
                ? "border-warn-border bg-warn-soft text-warn-text"
                : "border-danger-border bg-danger-soft text-danger-strong"
          }`}
        >
          {paymentStatus === "paid"
            ? "Package fully paid"
            : `R${Number(client.outstandingBalance || 0).toFixed(2)} outstanding`}
        </div>

        <hr className="my-3 border-line" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-sm text-muted">Purchase Date</p>
            <p className="text-base font-semibold sm:text-lg">{formatShortDate(client.purchaseDate)}</p>
          </div>
          <div>
            <p className="text-sm text-muted">Expiry Date</p>
            <p className="text-base font-semibold sm:text-lg">{formatShortDate(client.expiryDate)}</p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border-l-4 border-warn-border bg-warn-soft p-3 text-sm text-warn-text">
          Package expires in {daysUntil(client.expiryDate)} days
        </div>
      </article>

      </div>
      <div className="space-y-4 sm:space-y-5">

      <article className="surface-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title mb-0 text-base sm:text-lg">Package History</h2>
          {client.isActive &&
            currentPackage &&
            ["expired", "exhausted"].includes(currentPackage.packageStatus) && (
              <button
                type="button"
                onClick={() => setShowPackageForm((current) => !current)}
                className="inline-flex items-center gap-1 text-sm font-bold text-accent"
              >
                <Plus size={16} /> New Package
              </button>
            )}
        </div>
        {showPackageForm && (
          <form onSubmit={savePackage} className="mb-4 space-y-3 rounded-2xl border border-success-border bg-success-soft p-4">
            <p className="font-bold text-accent">Create replacement package</p>
            <select
              required
              value={packageForm.program}
              onChange={(event) =>
                setPackageForm((current) => ({ ...current, program: event.target.value }))
              }
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3"
            >
              <option value="">Select program</option>
              {availablePrograms.map((program) => (
                <option key={`${program.name}-${program.sessionType}`} value={program.name}>
                  {program.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={packageForm.sessionType}
                onChange={(event) =>
                  setPackageForm((current) => ({
                    ...current,
                    sessionType: event.target.value,
                    program: ""
                  }))
                }
                className="h-11 rounded-xl border border-line-strong bg-surface px-3"
              >
                <option>One-on-One</option>
                <option>Group</option>
              </select>
              <select
                value={packageForm.sessionsTotal}
                onChange={(event) =>
                  setPackageForm((current) => ({
                    ...current,
                    sessionsTotal: Number(event.target.value)
                  }))
                }
                className="h-11 rounded-xl border border-line-strong bg-surface px-3"
              >
                {(configuration?.packageSizes || []).map((size) => (
                  <option key={size} value={size}>
                    {size} {size === 1 ? "session" : "sessions"}
                  </option>
                ))}
              </select>
            </div>
            <input
              required
              type="date"
              value={packageForm.purchaseDate}
              onChange={(event) =>
                setPackageForm((current) => ({
                  ...current,
                  purchaseDate: event.target.value
                }))
              }
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3"
            />
            {renewalExpiryDate && (
              <div className="rounded-xl border-l-4 border-warn-border bg-warn-soft p-3">
                <p className="text-sm text-muted">Package Expires</p>
                <p className="text-lg font-semibold text-warn-text">{renewalExpiryDate}</p>
                <p className="text-sm text-subtle">
                  {renewalExpiryMonths} {renewalExpiryMonths === 1 ? "month" : "months"} from
                  purchase date
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowPackageForm(false)} className="action-btn action-btn-secondary">
                Cancel
              </button>
              <button
                type="submit"
                // No size means the configuration has not arrived yet, so there
                // is nothing to sell and nothing valid to submit (SET-06).
                disabled={Boolean(packageAction) || !packageForm.sessionsTotal}
                className="action-btn action-btn-primary"
              >
                {packageAction === "package" ? "Creating..." : "Create Package"}
              </button>
            </div>
          </form>
        )}
        {currentPackage?.outstandingBalance > 0 && client.isActive && (
          <button
            type="button"
            onClick={openPaymentForm}
            className="action-btn action-btn-primary mb-4 w-full"
          >
            <CreditCard size={17} className="mr-2" /> Record Payment
          </button>
        )}
        {showPaymentForm && currentPackage && (
          <form onSubmit={savePayment} className="mb-4 space-y-3 rounded-2xl border border-line bg-raised p-4">
            <p className="font-bold text-strong">Record package payment</p>
            <div className="grid grid-cols-2 gap-3">
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                max={currentPackage.outstandingBalance}
                value={paymentForm.amount}
                onChange={(event) =>
                  setPaymentForm((current) => ({ ...current, amount: event.target.value }))
                }
                className="h-11 rounded-xl border border-line-strong bg-surface px-3"
                placeholder="Amount"
              />
              <input
                required
                type="date"
                value={paymentForm.paymentDate}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    paymentDate: event.target.value
                  }))
                }
                className="h-11 rounded-xl border border-line-strong bg-surface px-3"
              />
            </div>
            <select
              value={paymentForm.method}
              onChange={(event) =>
                setPaymentForm((current) => ({ ...current, method: event.target.value }))
              }
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3"
            >
              <option value="cash">Cash</option>
              <option value="eft">EFT</option>
              <option value="card">Card</option>
            </select>
            <input
              value={paymentForm.reference}
              onChange={(event) =>
                setPaymentForm((current) => ({ ...current, reference: event.target.value }))
              }
              className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3"
              placeholder="Reference (optional)"
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setShowPaymentForm(false)} className="action-btn action-btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={Boolean(packageAction)} className="action-btn action-btn-primary">
                {packageAction === "payment" ? "Saving..." : "Record Payment"}
              </button>
            </div>
          </form>
        )}
        <div className="space-y-3">
          {packages.length === 0 && (
            <p className="text-sm text-muted">No package history recorded yet.</p>
          )}
          {packages.map((item) => (
            <div key={item.id} className="rounded-xl border border-line bg-raised p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-strong">{item.program}</p>
                  <p className="text-sm text-muted">
                    {item.sessionsUsed} of {item.sessionsTotal} sessions used
                  </p>
                  <p className="mt-1 text-sm font-semibold text-copy">
                    R{item.paidAmount.toFixed(2)} paid · R{item.outstandingBalance.toFixed(2)} outstanding
                  </p>
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-surface px-2 py-1 text-xs font-semibold capitalize text-muted ring-1 ring-line">
                    {item.packageStatus}
                  </span>
                  <p className="mt-2 text-xs text-subtle">{formatShortDate(item.purchaseDate)}</p>
                </div>
              </div>
              {item.payments.length > 0 && (
                <div className="mt-3 border-t border-line pt-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-subtle">
                    <ReceiptText size={14} /> Payment ledger
                  </p>
                  <div className="space-y-2">
                    {item.payments.map((payment) => {
                      const reversed = item.payments.some(
                        (entry) => entry.reversesPaymentId === payment.id
                      );
                      return (
                        <div key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className={`font-semibold ${payment.entryType === "reversal" ? "text-danger-strong" : "text-body"}`}>
                              {payment.entryType === "reversal" ? "-" : ""}R{Math.abs(payment.amount).toFixed(2)}
                              <span className="ml-2 font-normal uppercase text-subtle">{payment.method}</span>
                            </p>
                            <p className="text-xs text-subtle">
                              {formatShortDate(payment.paymentDate)}
                              {payment.reference ? ` · ${payment.reference}` : ""}
                            </p>
                          </div>
                          {payment.entryType === "payment" && !reversed && (
                            <button
                              type="button"
                              disabled={Boolean(packageAction)}
                              onClick={() => setPaymentToReverse(payment)}
                              className="-mr-2 inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-bold text-danger-strong"
                            >
                              <ReverseIcon size={14} /> Reverse
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </article>

      {client.isActive && (
        <Link
          to={`/schedule?clientId=${client.id}`}
          className="action-btn action-btn-primary w-full"
        >
          <CalendarPlus size={18} className="mr-2" /> Schedule New Session
        </Link>
      )}

      <article className="surface-card">
        <h2 className="section-title text-base sm:text-lg">Session History</h2>
        <div className="space-y-2">
          {sessions.length === 0 && (
            <p className="text-sm text-muted">No sessions recorded yet.</p>
          )}
          {sessions.map((entry) => (
            <div key={entry.id} className="border-b border-line py-3 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-semibold sm:text-lg">
                    {formatShortDate(entry.sessionDate)}
                  </p>
                  <p className="text-sm text-muted">
                    {entry.startTime} - {entry.program}
                  </p>
                </div>
                <p className="text-sm font-semibold capitalize text-muted">
                  {entry.attendanceStatus.replace("_", " ")}
                </p>
              </div>
              {entry.attendanceStatus === "scheduled" && entry.hasStarted && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {entry.hasEnded && (
                    <button
                      type="button"
                      disabled={Boolean(activeSessionAction)}
                      onClick={() => recordSessionOutcome(entry, "completed")}
                      className="action-btn action-btn-primary h-11"
                    >
                      <Check size={16} className="mr-1" /> Complete
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={Boolean(activeSessionAction)}
                    onClick={() => recordSessionOutcome(entry, "no_show")}
                    className={`action-btn action-btn-warn h-11 ${
                      entry.hasEnded ? "" : "col-span-2"
                    }`}
                  >
                    <UserX size={16} className="mr-1" /> No-show
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </article>

      </div>
      </div>

      <button
        type="button"
        onClick={() => {
          if (client.isActive) {
            setShowArchiveConfirmation(true);
          } else {
            toggleArchive();
          }
        }}
        disabled={isUpdatingStatus}
        className={`action-btn w-full ${
          client.isActive ? "action-btn-danger" : "action-btn-secondary"
        }`}
      >
        {client.isActive ? (
          <Archive size={18} className="mr-2" />
        ) : (
          <RotateCcw size={18} className="mr-2" />
        )}
        {isUpdatingStatus
          ? "Updating..."
          : client.isActive
            ? "Archive Client"
            : "Restore Client"}
      </button>

      {showArchiveConfirmation && (
        <div
          className={`modal-backdrop fixed inset-0 z-50 overflow-auto bg-slate-950/60 p-3 backdrop-blur-sm ${
            isArchiveClosing ? "is-closing" : ""
          }`}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissArchiveConfirmation();
          }}
        >
          <div
            className={`modal-panel relative mx-auto mt-20 w-full max-w-md rounded-3xl bg-surface p-5 shadow-2xl sm:p-6 ${
              isArchiveClosing ? "is-closing" : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-client-title"
          >
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-danger-tint text-danger-strong">
              <Archive size={22} />
            </div>
            <h2 id="archive-client-title" className="mt-4 text-xl font-bold text-strong">
              Archive {client.name}?
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              This rejects pending preferences and cancels recurring bookings and future
              sessions. Restoring the client later will not recreate those bookings.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={dismissArchiveConfirmation}
                className="action-btn action-btn-secondary"
              >
                Keep Active
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowArchiveConfirmation(false);
                  toggleArchive();
                }}
                className="action-btn action-btn-danger-solid"
              >
                Archive Client
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentToReverse && (
        <div
          className={`modal-backdrop fixed inset-0 z-50 overflow-auto bg-slate-950/60 p-3 backdrop-blur-sm ${
            isReversalClosing ? "is-closing" : ""
          }`}
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              packageAction !== `reverse-${paymentToReverse.id}`
            ) {
              dismissPaymentReversal();
            }
          }}
        >
          <div
            className={`modal-panel relative mx-auto mt-20 w-full max-w-md rounded-3xl bg-surface p-5 shadow-2xl sm:p-6 ${
              isReversalClosing ? "is-closing" : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reverse-payment-title"
          >
            <button
              type="button"
              disabled={packageAction === `reverse-${paymentToReverse.id}`}
              onClick={dismissPaymentReversal}
              className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-xl text-subtle transition hover:bg-sunken hover:text-strong disabled:opacity-50"
              aria-label="Close payment reversal modal"
            >
              <X size={19} />
            </button>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-danger-tint text-danger-strong">
              <ReverseIcon size={22} />
            </div>
            <h2 id="reverse-payment-title" className="mt-4 text-xl font-bold text-strong">
              Reverse this payment?
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              The original payment remains in the ledger. A reversal entry will be added and
              the package balance will be recalculated.
            </p>
            <div className="mt-4 rounded-2xl border border-line bg-raised p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Amount</span>
                <span className="font-bold text-strong">
                  R{Math.abs(paymentToReverse.amount).toFixed(2)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Payment date</span>
                <span className="font-semibold text-body">
                  {formatShortDate(paymentToReverse.paymentDate)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Method</span>
                <span className="font-semibold uppercase text-body">
                  {paymentToReverse.method}
                </span>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={packageAction === `reverse-${paymentToReverse.id}`}
                onClick={dismissPaymentReversal}
                className="action-btn action-btn-secondary"
              >
                Keep Payment
              </button>
              <button
                type="button"
                disabled={packageAction === `reverse-${paymentToReverse.id}`}
                onClick={() => reversePayment(paymentToReverse)}
                className="action-btn action-btn-danger-solid disabled:opacity-70"
              >
                {packageAction === `reverse-${paymentToReverse.id}`
                  ? "Reversing..."
                  : "Reverse Payment"}
              </button>
            </div>
          </div>
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
