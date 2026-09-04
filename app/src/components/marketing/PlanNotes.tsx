"use client";

import { useState, useTransition } from "react";
import { NotebookPen, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { saveYearPlanAction, saveMonthNoteAction } from "@/app/marketing/calendar/actions";

/**
 * The operator's own direction on the seasonal calendar: a plan for the year
 * plus a note per month. Adonis reads these when writing campaigns (see
 * getPlanBriefing → getBusinessContext), so this is where "we're launching the
 * small-group programme in March, hold the discounting until then" goes.
 */
export function YearPlanPanel({
  year,
  initialPlan,
}: {
  year: number;
  initialPlan: string;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [editing, setEditing] = useState(!initialPlan);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await saveYearPlanAction(year, plan);
      if (res.ok) {
        toast.success("Plan saved. Adonis will follow it.");
        setEditing(false);
      } else {
        toast.error(res.error ?? "Couldn't save the plan.");
      }
    });
  }

  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
        marginBottom: 24,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <NotebookPen size={15} style={{ color: "var(--text-tertiary)" }} />
        <span
          style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          Your plan for {year}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: "auto" }}>
          Adonis reads this when writing campaigns
        </span>
      </div>

      {editing ? (
        <>
          <Textarea
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            placeholder="What's the direction this year? Launches and their timing, what to push and when, offers to avoid, the audience you're going after, anything Adonis can't work out from the date alone."
            style={{ minHeight: 140 }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {initialPlan && (
              <Button
                variant="ghost"
                onClick={() => {
                  setPlan(initialPlan);
                  setEditing(false);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            )}
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {pending ? "Saving" : "Save plan"}
            </Button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <p
            style={{
              margin: 0,
              flex: 1,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
            }}
          >
            {plan}
          </p>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}

/** Compact per-month note, shown inside a month card. */
export function MonthNote({
  year,
  month,
  initialNote,
}: {
  year: number;
  month: number;
  initialNote: string;
}) {
  const [note, setNote] = useState(initialNote);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await saveMonthNoteAction(year, month, note);
      if (res.ok) {
        toast.success("Note saved.");
        setEditing(false);
      } else {
        toast.error(res.error ?? "Couldn't save the note.");
      }
    });
  }

  if (editing) {
    return (
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        <Textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's happening this month?"
          style={{ minHeight: 64, fontSize: 12.5, padding: "9px 11px" }}
        />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNote(initialNote);
              setEditing(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 size={12} className="spin" /> : <Check size={12} />}
            Save
          </Button>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <button type="button" className="szncal-note-add" onClick={() => setEditing(true)}>
        <Plus size={11} />
        Add note
      </button>
    );
  }

  return (
    <button
      type="button"
      className="szncal-note"
      onClick={() => setEditing(true)}
      title="Edit this month's note"
    >
      <NotebookPen size={11} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{note}</span>
    </button>
  );
}
