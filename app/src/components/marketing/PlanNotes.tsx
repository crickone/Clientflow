"use client";

import { useState, useTransition } from "react";
import { NotebookPen, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { saveMonthNoteAction } from "@/app/marketing/calendar/actions";

/**
 * The operator's own direction on the seasonal calendar, a note per month.
 * Adonis reads these when writing campaigns (see getPlanBriefing →
 * getBusinessContext), so this is where "we're launching the small-group
 * programme in March, hold the discounting until then" goes.
 */
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
