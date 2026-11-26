"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";

import type { RotaActions } from "./RotaView";

interface Props {
  addPerson: RotaActions["addPerson"];
  onClose: () => void;
}

/** Add someone to the rota by name. */
export function AddPersonDialog({ addPerson, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    if (pending) return;
    if (!name.trim()) {
      setError("Give the person a name.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await addPerson(name);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
      toast.success("Added.");
      router.refresh();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent title="Add a person" width={440}>
        <Label htmlFor="rv-person-name">Name</Label>
        <Input
          id="rv-person-name"
          value={name}
          required
          maxLength={120}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          error={error ?? undefined}
        />
        {error && (
          <p className="rv-dlg-error" role="alert">
            {error}
          </p>
        )}
        <div className="rv-dlg-acts">
          <span className="rv-dlg-gap" />
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={pending}>
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
