"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Therapy } from "@/lib/db/schema";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useVocab } from "@/components/providers/VocabProvider";
import {
  createTherapyAction,
  deleteTherapyAction,
  toggleTherapyAction,
  updateTherapyAction,
} from "@/app/settings/therapies/actions";

export function TherapyList({ items }: { items: Therapy[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {items.map((t) => (
        <TherapyRow key={t.id} therapy={t} />
      ))}
      <NewTherapyButton />
    </div>
  );
}

function TherapyRow({ therapy }: { therapy: Therapy }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const vocab = useVocab();
  return (
    <Card
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: 18,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 12,
          height: 12,
          borderRadius: "var(--radius)",
          background: therapy.colourHex,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              color: "var(--text-primary)",
              fontWeight: 500,
              fontSize: 15,
            }}
          >
            {therapy.name}
          </span>
          {!therapy.isActive && <Badge tone="red">Inactive</Badge>}
        </div>
        <div
          style={{
            color: "var(--text-tertiary)",
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {therapy.defaultDurationMinutes} min · €{therapy.defaultPriceEur}
          {therapy.description ? ` · ${therapy.description}` : ""}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await toggleTherapyAction(therapy.id, !therapy.isActive);
            toast.success(therapy.isActive ? "Deactivated." : "Activated.");
          })
        }
      >
        {therapy.isActive ? "Deactivate" : "Activate"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Pencil size={14} />
            Edit
          </Button>
        </DialogTrigger>
        <DialogContent title={`Edit ${therapy.name}`} width={520}>
          <TherapyForm
            therapy={therapy}
            onDone={() => {
              setOpen(false);
              toast.success(`${vocab.service} updated.`);
            }}
          />
        </DialogContent>
      </Dialog>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete "${therapy.name}"? This cannot be undone.`)) return;
          start(async () => {
            const res = await deleteTherapyAction(therapy.id);
            if (res.ok) toast.success(`${vocab.service} deleted.`);
            else toast.error(res.reason);
          });
        }}
        style={{ color: "#dc2626" }}
        aria-label={`Delete ${vocab.service.toLowerCase()}`}
      >
        <Trash2 size={14} />
      </Button>
    </Card>
  );
}

function NewTherapyButton() {
  const [open, setOpen] = useState(false);
  const vocab = useVocab();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" style={{ alignSelf: "flex-start" }}>
          <Plus size={15} />
          Add {vocab.service.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent title={`New ${vocab.service.toLowerCase()}`} width={520}>
        <TherapyForm
          onDone={() => {
            setOpen(false);
            toast.success(`${vocab.service} added.`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function TherapyForm({
  therapy,
  onDone,
}: {
  therapy?: Therapy;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const vocab = useVocab();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        if (therapy) await updateTherapyAction(therapy.id, fd);
        else await createTherapyAction(fd);
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={therapy?.name ?? ""} required />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 12 }}>
        <div>
          <Label htmlFor="colourHex">Colour</Label>
          <Input
            id="colourHex"
            name="colourHex"
            defaultValue={therapy?.colourHex ?? "#58a6ff"}
            placeholder="#58a6ff"
            required
          />
        </div>
        <div>
          <Label>&nbsp;</Label>
          <input
            type="color"
            defaultValue={therapy?.colourHex ?? "#58a6ff"}
            onChange={(e) => {
              const input = (e.currentTarget.parentElement?.parentElement
                ?.querySelector("#colourHex") as HTMLInputElement) ?? null;
              if (input) input.value = e.currentTarget.value;
            }}
            style={{
              width: "100%",
              height: 38,
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              background: "transparent",
              cursor: "pointer",
            }}
          />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <Label htmlFor="defaultDurationMinutes">Duration (minutes)</Label>
          <Input
            id="defaultDurationMinutes"
            name="defaultDurationMinutes"
            type="number"
            defaultValue={therapy?.defaultDurationMinutes ?? 60}
            min={1}
            required
          />
        </div>
        <div>
          <Label htmlFor="defaultPriceEur">Price (€)</Label>
          <Input
            id="defaultPriceEur"
            name="defaultPriceEur"
            type="number"
            step="0.01"
            defaultValue={therapy?.defaultPriceEur ?? 0}
            min={0}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={therapy?.description ?? ""}
        />
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={therapy?.isActive ?? true}
        />
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Active (available for booking)
        </span>
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : therapy
              ? "Save changes"
              : `Add ${vocab.service.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
