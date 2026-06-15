import { createPortal } from "react-dom";
import { UserRoundCheck, X } from "lucide-react";

export default function SuccessToast({ title = "Schedule updated", message, onDismiss }) {
  if (!message) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "24px",
        left: "16px",
        right: "16px",
        zIndex: 2147483647,
        margin: "0 auto",
        maxWidth: "512px",
        backgroundColor: "#0f172a",
        opacity: 1
      }}
      className="flex items-start gap-3 rounded-2xl border border-emerald-400 p-4 text-white shadow-2xl ring-1 ring-white/10"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-400 text-emerald-950">
        <UserRoundCheck size={21} className="stroke-[2]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-white">{title}</p>
        <p className="mt-0.5 text-sm text-slate-200">{message}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"
        aria-label="Dismiss confirmation"
      >
        <X size={17} />
      </button>
    </div>,
    document.body
  );
}
