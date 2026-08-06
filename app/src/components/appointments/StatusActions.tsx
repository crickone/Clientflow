"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Label, Textarea } from "@/components/ui/Input";
import { useVocab } from "@/components/providers/VocabProvider";
import {
  completeAppointmentAction,
  uncompleteAppointmentAction,
  updateStatusAction,
  deleteAppointmentAction,
} from "@/app/appointments/actions";
import type { Package } from "@/lib/db/schema";

interface Props {
  appointmentId: number;
  status: string;
  activePackages: Package[];
  packageNames: Map<number, string>;
}

export function StatusActions({
  appointmentId,
  status,
  activePackages,
  packageNames,
}: Props) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [openComplete, setOpenComplete] = useState(false);
  const vocab = useVocab();

  function update(next: "scheduled" | "confirmed" | "cancelled" | "no_show") {
    start(async () => {
      await updateStatusAction(appointmentId, next);
      toast.success(`Marked ${next.replace("_", " ")}.`);
    });
  }

  async function remove() {
    if (!(await confirm({ title: `Delete this ${vocab.booking.toLowerCase()}?`, body: "This cannot be undone.", destructive: true }))) return;
    start(async () => {
      await deleteAppointmentAction(appointmentId);
    });
  }

  async function undoComplete() {
    if (
      !(await confirm({
        title: "Undo completion?",
        body: `This will delete the session log(s), refund any ${vocab.plan.toLowerCase()} credit used, and move the ${vocab.booking.toLowerCase()} back to Scheduled.`,
        confirmLabel: "Undo",
        destructive: true,
      }))
    )
      return;
    start(async () => {
      try {
        await uncompleteAppointmentAction(appointmentId);
        toast.success("Completion undone.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Undo failed.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {status !== "confirmed" && status !== "completed" && (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => update("confirmed")}
        >
          <Circle size={14} />
          Confirm
        </Button>
      )}
      {status !== "completed" && (
        <Dialog open={openComplete} onOpenChange={setOpenComplete}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={pending}>
              <CheckCircle2 size={14} />
              Complete
            </Button>
          </DialogTrigger>
          <DialogContent title="Log this session">
            <CompleteForm
              appointmentId={appointmentId}
              activePackages={activePackages}
              packageNames={packageNames}
              onDone={() => {
                setOpenComplete(false);
                toast.success("Session logged.");
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      {status !== "no_show" && status !== "completed" && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => update("no_show")}
        >
          No-show
        </Button>
      )}
      {status !== "cancelled" && status !== "completed" && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={async () => {
            if (await confirm({ title: `Cancel this ${vocab.booking.toLowerCase()}?`, confirmLabel: "Cancel booking", cancelLabel: "Keep" }))
              update("cancelled");
          }}
        >
          <XCircle size={14} />
          Cancel
        </Button>
      )}
      {status === "completed" && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={undoComplete}
        >
          <RotateCcw size={14} />
          Undo completion
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={remove}
        style={{ color: "#dc2626" }}
      >
        Delete
      </Button>
    </div>
  );
}

function CompleteForm({
  appointmentId,
  activePackages,
  packageNames,
  onDone,
}: {
  appointmentId: number;
  activePackages: Package[];
  packageNames: Map<number, string>;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const vocab = useVocab();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("appointmentId", String(appointmentId));
    start(async () => {
      await completeAppointmentAction(fd);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Label htmlFor="therapistNotes">Therapist notes</Label>
        <Textarea
          id="therapistNotes"
          name="therapistNotes"
          rows={4}
          placeholder="Treatment summary, observations, follow-up actions…"
        />
      </div>
      <div>
        <Label htmlFor="outcomeRating">Outcome (1–5)</Label>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              style={{
                flex: 1,
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 0",
                textAlign: "center",
                cursor: "pointer",
                color: "var(--text-secondary)",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              <input
                type="radio"
                name="outcomeRating"
                value={n}
                style={{ display: "none" }}
              />
              {n}
            </label>
          ))}
        </div>
      </div>
      {activePackages.length > 0 && (
        <div>
          <Label htmlFor="packageId">Use {vocab.plan.toLowerCase()} credit (optional)</Label>
          <select
            id="packageId"
            name="packageId"
            style={{
              width: "100%",
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: "10px 14px",
              color: "var(--text-primary)",
              fontSize: 14,
              fontFamily: "inherit",
            }}
            defaultValue=""
          >
            <option value="">No {vocab.plan.toLowerCase()}</option>
            {activePackages.map((p) => (
              <option key={p.id} value={p.id}>
                {packageNames.get(p.id) ?? p.packageName}
              </option>
            ))}
          </select>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Log session"}
        </Button>
      </div>
    </form>
  );
}
