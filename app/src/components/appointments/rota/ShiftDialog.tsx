"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { fullDate, weekdayLong } from "@/lib/booking/format";
import type { ShiftRow } from "@/lib/scheduling/rotaModel";

import type { RotaActions } from "./RotaView";

/** Which shift the dialog is for: a new one for a person on a day, or an existing one. */
export interface ShiftTarget {
  personId: number;
  personName: string;
  date: string;
  shift?: ShiftRow;
  /** The day's opening and closing times: the defaults for a new shift. */
  open: string | null;
  close: string | null;
}

interface Props {
  target: ShiftTarget;
  actions: Pick<RotaActions, "addShift" | "updateShift" | "deleteShift">;
  onClose: () => void;
}

/** Add or edit one shift: start and end times, and remove for an existing one. */
export function ShiftDialog({ target, actions, onClose }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const { shift } = target;
  const [start, setStart] = useState(shift?.start ?? target.open ?? "09:00");
  const [end, setEnd] = useState(shift?.end ?? target.close ?? "17:00");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [removing, startRemove] = useTransition();
  const busy = saving || removing;

  const save = () => {
    if (busy) return;
    setError(null);
    startSave(async () => {
      const res = shift
        ? await actions.updateShift(shift.id, { start, end })
        : await actions.addShift({ staffId: target.personId, date: target.date, start, end });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      toast.success("Shift saved.");
      router.refresh();
    });
  };

  const remove = async () => {
    if (!shift || busy) return;
    if (!(await confirm({ title: "Remove this shift?", confirmLabel: "Remove", destructive: true }))) return;
    setError(null);
    startRemove(async () => {
      const res = await actions.deleteShift(shift.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      toast.success("Shift removed.");
      router.refresh();
    });
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={shift ? "Edit shift" : "Add a shift"}
        description={`${target.personName}, ${weekdayLong(target.date)} ${fullDate(target.date)}`}
        width={440}
      >
        <div className="rv-dlg-times">
          <div>
            <Label htmlFor="rv-shift-start">Starts</Label>
            <Input id="rv-shift-start" type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} onKeyDown={onEnter} />
          </div>
          <div>
            <Label htmlFor="rv-shift-end">Ends</Label>
            <Input id="rv-shift-end" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} onKeyDown={onEnter} />
          </div>
        </div>
        {error && (
          <p className="rv-dlg-error" role="alert">
            {error}
          </p>
        )}
        <div className="rv-dlg-acts">
          {shift && (
            <Button type="button" variant="outline" className="rv-danger" onClick={remove} loading={removing} disabled={saving}>
              Remove shift
            </Button>
          )}
          <span className="rv-dlg-gap" />
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={saving} disabled={removing}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
