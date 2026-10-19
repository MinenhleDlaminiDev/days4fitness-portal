import { useState } from "react";
import { Check, Pencil, Plus, RotateCcw, Target, Trash2, X } from "lucide-react";
import { formatShortDate, localDateInputValue } from "../lib/date.js";
import {
  addClientGoal,
  getApiErrorMessage,
  removeClientGoal,
  updateClientGoal
} from "../lib/api.js";

const MAX_GOAL_LENGTH = 200;

const emptyDraft = { goal: "", targetDate: "" };

/**
 * What a client is working towards. Every write answers with the whole list in
 * the order it should be shown, so this component replaces its goals outright
 * rather than patching one in and guessing where it belongs.
 */
export default function ClientGoals({ clientId, goals, onGoalsChange, canEdit = true }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyDraft);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const working = goals.filter((item) => !item.achievedAt);
  const achieved = goals.filter((item) => item.achievedAt);

  async function run(key, request) {
    try {
      setBusyId(key);
      setError("");
      onGoalsChange(await request());
      return true;
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Could not save that goal."));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    if (!draft.goal.trim()) return;
    const saved = await run("new", () =>
      addClientGoal(clientId, {
        goal: draft.goal.trim(),
        targetDate: draft.targetDate || undefined
      })
    );
    if (saved) setDraft(emptyDraft);
  }

  async function saveEdit(goalId) {
    const saved = await run(goalId, () =>
      updateClientGoal(clientId, goalId, {
        goal: editDraft.goal.trim(),
        // An empty box means "no target date", which the API takes as null.
        targetDate: editDraft.targetDate || null
      })
    );
    if (saved) setEditingId(null);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEditDraft({ goal: item.goal, targetDate: item.targetDate ?? "" });
    setError("");
  }

  return (
    <article className="surface-card">
      <h2 className="section-title text-base sm:text-lg">
        <Target size={18} className="stroke-[1.75] text-accent" />
        Goals
      </h2>

      {goals.length === 0 && (
        <p className="rounded-xl border border-dashed border-line-strong bg-raised p-3 text-sm text-muted">
          No goals recorded yet.
        </p>
      )}

      <ul className="space-y-2">
        {working.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-line bg-surface p-3"
          >
            {editingId === item.id ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={editDraft.goal}
                  maxLength={MAX_GOAL_LENGTH}
                  onChange={(event) => setEditDraft({ ...editDraft, goal: event.target.value })}
                  aria-label="Goal"
                  className="h-11 w-full rounded-xl border border-line-strong bg-raised px-3 text-sm outline-none transition focus:border-accent"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={editDraft.targetDate}
                    onChange={(event) =>
                      setEditDraft({ ...editDraft, targetDate: event.target.value })
                    }
                    aria-label="Target date"
                    className="h-11 rounded-xl border border-line-strong bg-raised px-3 text-sm outline-none transition focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={() => saveEdit(item.id)}
                    disabled={busyId === item.id || !editDraft.goal.trim()}
                    className="action-btn action-btn-primary"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="action-btn action-btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-copy sm:text-base">{item.goal}</p>
                  {item.targetDate && (
                    <p className="text-xs text-muted">Target {formatShortDate(item.targetDate)}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() =>
                        run(item.id, () =>
                          updateClientGoal(clientId, item.id, { achieved: true })
                        )
                      }
                      disabled={busyId === item.id}
                      aria-label={`Mark "${item.goal}" achieved`}
                      className="grid h-11 w-11 place-items-center rounded-xl text-accent"
                    >
                      <Check size={16} className="stroke-[1.75]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      aria-label={`Edit "${item.goal}"`}
                      className="grid h-11 w-11 place-items-center rounded-xl text-subtle"
                    >
                      <Pencil size={15} className="stroke-[1.75]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => run(item.id, () => removeClientGoal(clientId, item.id))}
                      disabled={busyId === item.id}
                      aria-label={`Remove "${item.goal}"`}
                      className="grid h-11 w-11 place-items-center rounded-xl text-subtle"
                    >
                      <Trash2 size={15} className="stroke-[1.75]" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {achieved.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-subtle">Achieved</p>
          <ul className="mt-2 space-y-2">
            {achieved.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-xl border border-line bg-raised p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-muted line-through">{item.goal}</p>
                  <p className="text-xs text-subtle">{formatShortDate(item.achievedAt)}</p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() =>
                        run(item.id, () =>
                          updateClientGoal(clientId, item.id, { achieved: false })
                        )
                      }
                      disabled={busyId === item.id}
                      aria-label={`Put "${item.goal}" back on the list`}
                      className="grid h-11 w-11 place-items-center rounded-xl text-subtle"
                    >
                      <RotateCcw size={15} className="stroke-[1.75]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => run(item.id, () => removeClientGoal(clientId, item.id))}
                      disabled={busyId === item.id}
                      aria-label={`Remove "${item.goal}"`}
                      className="grid h-11 w-11 place-items-center rounded-xl text-subtle"
                    >
                      <X size={15} className="stroke-[1.75]" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && (
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <input
            type="text"
            value={draft.goal}
            maxLength={MAX_GOAL_LENGTH}
            placeholder="What are they working towards?"
            onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            aria-label="New goal"
            className="h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={draft.targetDate}
              min={localDateInputValue()}
              onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
              aria-label="New goal target date"
              className="h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm outline-none transition focus:border-accent"
            />
            <button
              type="button"
              onClick={add}
              disabled={busyId === "new" || !draft.goal.trim()}
              className="action-btn action-btn-secondary"
            >
              <Plus size={15} className="mr-1" /> Add goal
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-danger-border bg-danger-soft p-3 text-sm font-semibold text-danger-strong">
          {error}
        </p>
      )}
    </article>
  );
}
