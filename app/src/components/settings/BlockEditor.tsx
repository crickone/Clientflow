"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BlockOut } from "@/lib/db/schema";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  createBlockAction,
  deleteBlockAction,
  updateBlockAction,
} from "@/app/settings/blocks/actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function daysForBlock(b: BlockOut): number[] {
  if (b.daysOfWeek) {
    return b.daysOfWeek
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  }
  if (b.dayOfWeek != null) return [b.dayOfWeek];
  return [];
}

function formatDays(days: number[]): string {
  if (days.length === 0) return "—";
  if (days.length === 7) return "Every day";
  // Detect weekdays (Mon-Fri)
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.join(",") === "1,2,3,4,5") return "Weekdays";
  if (sorted.join(",") === "0,6") return "Weekends";
  return sorted.map((d) => DAYS[d]).join(", ");
}

export function BlockManager({ items }: { items: BlockOut[] }) {
  const recurring = items.filter((b) => b.type === "recurring");
  const oneOff = items.filter((b) => b.type === "one_off");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <CardLabel style={{ marginBottom: 0 }}>Recurring</CardLabel>
          <NewBlockButton type="recurring" />
        </div>
        {recurring.length === 0 ? (
          <Empty type="recurring" />
        ) : (
          <BlockList items={recurring} />
        )}
      </Card>

      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <CardLabel style={{ marginBottom: 0 }}>One-off</CardLabel>
          <NewBlockButton type="one_off" />
        </div>
        {oneOff.length === 0 ? (
          <Empty type="one_off" />
        ) : (
          <BlockList items={oneOff} />
        )}
      </Card>
    </div>
  );
}

function Empty({ type }: { type: "recurring" | "one_off" }) {
  return (
    <div
      style={{
        padding: "32px 0",
        textAlign: "center",
        color: "var(--text-tertiary)",
        fontSize: 13,
      }}
    >
      {type === "recurring"
        ? "No recurring blocks. E.g. lunch every weekday 13:00–14:00."
        : "No one-off blocks. E.g. closed Dec 24–26."}
    </div>
  );
}

function BlockList({ items }: { items: BlockOut[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((b) => (
        <BlockRow key={b.id} block={b} />
      ))}
    </div>
  );
}

function BlockRow({ block }: { block: BlockOut }) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const days = daysForBlock(block);

  return (
    <>
      <div
        onClick={() => setEditOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 14px",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover, rgba(0,0,0,0.02))";
          e.currentTarget.style.borderColor = "var(--accent, #888)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderColor = "var(--hairline)";
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge>
              {block.type === "recurring"
                ? formatDays(days)
                : block.endDate && block.endDate !== block.date
                  ? `${block.date} → ${block.endDate}`
                  : block.date}
            </Badge>
            <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              {block.startTime}–{block.endTime}
            </span>
          </div>
          <div
            style={{
              color: "var(--text-primary)",
              fontSize: 14,
              marginTop: 4,
            }}
          >
            {block.reason}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Edit"
          onClick={(e) => {
            e.stopPropagation();
            setEditOpen(true);
          }}
          style={{ color: "var(--text-secondary)" }}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Delete"
          disabled={pending}
          onClick={async (e) => {
            e.stopPropagation();
            if (!(await confirm({ title: "Delete this block-out?", destructive: true }))) return;
            start(async () => {
              await deleteBlockAction(block.id);
              toast.success("Block removed.");
            });
          }}
          style={{ color: "#dc2626" }}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent
          title={
            block.type === "recurring"
              ? "Edit recurring block-out"
              : "Edit one-off block-out"
          }
          width={520}
        >
          <BlockForm
            type={block.type as "recurring" | "one_off"}
            initial={block}
            onDone={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewBlockButton({ type }: { type: "recurring" | "one_off" }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus size={14} />
          {type === "recurring" ? "Add recurring" : "Add one-off"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={type === "recurring" ? "Recurring block-out" : "One-off block-out"}
        width={520}
      >
        <BlockForm type={type} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function BlockForm({
  type,
  initial,
  onDone,
}: {
  type: "recurring" | "one_off";
  initial?: BlockOut;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const isEdit = !!initial;

  const initialDays = initial ? daysForBlock(initial) : [1];
  const [selectedDays, setSelectedDays] = useState<number[]>(initialDays);

  function toggleDay(d: number) {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("type", type);
    if (type === "recurring") {
      fd.delete("daysOfWeek");
      if (selectedDays.length === 0) {
        toast.error("Pick at least one day.");
        return;
      }
      for (const d of selectedDays) fd.append("daysOfWeek", String(d));
    }
    start(async () => {
      try {
        if (isEdit && initial) {
          await updateBlockAction(initial.id, fd);
          toast.success("Block updated.");
        } else {
          await createBlockAction(fd);
          toast.success("Block-out added.");
        }
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {type === "recurring" ? (
        <div>
          <Label>Days of week</Label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 6,
              marginTop: 6,
            }}
          >
            {DAYS.map((d, i) => {
              const active = selectedDays.includes(i);
              return (
                <button
                  type="button"
                  key={i}
                  aria-label={DAY_FULL[i]}
                  aria-pressed={active}
                  onClick={() => toggleDay(i)}
                  style={{
                    padding: "10px 0",
                    borderRadius: "var(--radius)",
                    border: active
                      ? "1px solid var(--accent, #58a6ff)"
                      : "1px solid var(--hairline)",
                    background: active ? "var(--accent, #58a6ff)" : "var(--bg)",
                    color: active ? "#fff" : "var(--text-primary)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <Label htmlFor="date">Start date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              defaultValue={initial?.date ?? todayIso}
              required
            />
          </div>
          <div>
            <Label htmlFor="endDate">End date (optional)</Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={
                initial?.endDate && initial.endDate !== initial.date
                  ? initial.endDate
                  : ""
              }
            />
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <Label htmlFor="startTime">Start time</Label>
          <Input
            id="startTime"
            name="startTime"
            type="time"
            defaultValue={initial?.startTime ?? "13:00"}
            required
          />
        </div>
        <div>
          <Label htmlFor="endTime">End time</Label>
          <Input
            id="endTime"
            name="endTime"
            type="time"
            defaultValue={initial?.endTime ?? "14:00"}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="reason">Name</Label>
        <Input
          id="reason"
          name="reason"
          placeholder={type === "recurring" ? "Lunch break" : "Bank holiday"}
          defaultValue={initial?.reason ?? ""}
          required
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? (isEdit ? "Saving…" : "Adding…") : isEdit ? "Save changes" : "Add block-out"}
        </Button>
      </div>
    </form>
  );
}
