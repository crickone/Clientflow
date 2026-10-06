"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { addCustomDateAction, removeCustomDateAction } from "@/app/marketing/calendar/actions";

/** "Add a date": the business's own occasions (open day, anniversary, a launch) on the calendar. */
export function AddCalendarDate() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [iso, setIso] = useState("");
  const [pending, start] = useTransition();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await addCustomDateAction(name, iso);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Date added.");
      setName("");
      setIso("");
      setOpen(false);
    });
  }

  return (
    <div ref={wrap} className="drp">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Plus size={14} /> Add a date
      </Button>
      {open && (
        <form className="szn-add" onSubmit={save} aria-label="Add a date">
          <Input autoFocus aria-label="What's happening" placeholder="What's happening, e.g. Open day" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Input type="date" aria-label="Date" value={iso} onChange={(e) => setIso(e.target.value)} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={pending} disabled={!name.trim() || !iso}>
              Add date
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function RemoveCalendarDate({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="szn-remove"
      aria-label={`Remove ${name}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeCustomDateAction(id);
          toast.success("Date removed.");
        })
      }
    >
      <X size={13} />
    </button>
  );
}
