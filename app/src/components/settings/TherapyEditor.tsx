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
import { useConfirm } from "@/components/ui/ConfirmDialog";
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
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

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
  const confirm = useConfirm();
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
        onClick={async () => {
          if (!(await confirm({ title: `Delete "${therapy.name}"?`, body: "This cannot be undone.", destructive: true }))) return;
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

interface TherapyValues {
  name: string;
  colourHex: string;
  defaultDurationMinutes: string;
  defaultPriceEur: string;
  description: string;
  isActive: boolean;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Mirrors `readForm` in the server action — the shape it expects, exactly. */
function toFormData(v: TherapyValues): FormData {
  const fd = new FormData();
  fd.set("name", v.name);
  fd.set("colourHex", v.colourHex);
  fd.set("defaultDurationMinutes", v.defaultDurationMinutes);
  fd.set("defaultPriceEur", v.defaultPriceEur);
  fd.set("description", v.description);
  if (v.isActive) fd.set("isActive", "on");
  return fd;
}

/**
 * The action parses with zod and THROWS on anything malformed, so autosave is
 * held until every field would survive that parse. Otherwise a half-typed
 * colour would put a raw ZodError in the status line.
 */
function isSavable(v: TherapyValues): boolean {
  const duration = Number(v.defaultDurationMinutes);
  const price = Number(v.defaultPriceEur);
  return (
    v.name.trim() !== "" &&
    HEX_RE.test(v.colourHex.trim()) &&
    Number.isInteger(duration) &&
    duration > 0 &&
    Number.isFinite(price) &&
    price >= 0
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
  const isEdit = Boolean(therapy);

  // The values as the dialog was opened — what "Undo changes" restores to.
  const [opened] = useState<TherapyValues>(() => ({
    name: therapy?.name ?? "",
    colourHex: therapy?.colourHex ?? "#58a6ff",
    defaultDurationMinutes: String(therapy?.defaultDurationMinutes ?? 60),
    defaultPriceEur: String(therapy?.defaultPriceEur ?? 0),
    description: therapy?.description ?? "",
    isActive: therapy?.isActive ?? true,
  }));
  const [v, setV] = useState<TherapyValues>(opened);

  function set<K extends keyof TherapyValues>(key: K, value: TherapyValues[K]) {
    setV((prev) => ({ ...prev, [key]: value }));
  }

  // Editing an existing row autosaves. Creating one cannot — there is no row to
  // save into until it is added, and a half-typed name is not a therapy.
  const autosave = useAutosave({
    values: v,
    enabled: isEdit && isSavable(v),
    blockedReason: "Needs a name, a #rrggbb colour, a duration and a price",
    save: async (next) => {
      if (!therapy) return;
      await updateTherapyAction(therapy.id, toFormData(next));
    },
  });

  const changedSinceOpen = JSON.stringify(v) !== JSON.stringify(opened);

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    start(async () => {
      try {
        await createTherapyAction(toFormData(v));
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form
      onSubmit={isEdit ? (e) => e.preventDefault() : create}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div>
        <Label htmlFor="name" srOnly>Name</Label>
        <Input
          id="name"
          placeholder="Name"
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
          required
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 12 }}>
        <div>
          <Label htmlFor="colourHex">Colour</Label>
          <Input
            id="colourHex"
            value={v.colourHex}
            onChange={(e) => set("colourHex", e.target.value)}
            placeholder="#58a6ff"
            required
          />
        </div>
        <div>
          <Label>&nbsp;</Label>
          <input
            type="color"
            aria-label="Pick colour"
            value={HEX_RE.test(v.colourHex) ? v.colourHex : "#58a6ff"}
            onChange={(e) => set("colourHex", e.target.value)}
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
            type="number"
            value={v.defaultDurationMinutes}
            onChange={(e) => set("defaultDurationMinutes", e.target.value)}
            min={1}
            required
          />
        </div>
        <div>
          <Label htmlFor="defaultPriceEur">Price (€)</Label>
          <Input
            id="defaultPriceEur"
            type="number"
            step="0.01"
            value={v.defaultPriceEur}
            onChange={(e) => set("defaultPriceEur", e.target.value)}
            min={0}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="description" srOnly>Description</Label>
        <Textarea
          id="description"
          rows={3}
          placeholder="Description"
          value={v.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={v.isActive}
          onChange={(e) => set("isActive", e.target.checked)}
        />
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Active (available for booking)
        </span>
      </label>

      {isEdit ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Autosave means there is nothing to cancel — so the escape hatch is
              a real undo back to how the dialog opened, which then saves. */}
          <Button
            type="button"
            variant="ghost"
            disabled={!changedSinceOpen}
            onClick={() => setV(opened)}
          >
            Undo changes
          </Button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <SaveStatus autosave={autosave} sticky={false} />
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Done
              </Button>
            </DialogClose>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending || !isSavable(v)}>
            {pending ? "Saving…" : `Add ${vocab.service.toLowerCase()}`}
          </Button>
        </div>
      )}
    </form>
  );
}
