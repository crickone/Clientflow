"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PackageTemplate, Therapy } from "@/lib/db/schema";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useVocab } from "@/components/providers/VocabProvider";
import {
  createPackageTemplateAction,
  deletePackageTemplateAction,
  updatePackageTemplateAction,
} from "@/app/settings/packages/actions";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

interface Props {
  items: PackageTemplate[];
  therapies: Therapy[];
}

function formatValidity(months: number) {
  if (months === 1) return "1 month";
  if (months < 12) return `${months} months`;
  if (months === 12) return "1 year";
  if (months % 12 === 0) return `${months / 12} years`;
  return `${months} months`;
}

export function PackageTemplatesEditor({ items, therapies }: Props) {
  if (therapies.length === 0) {
    return (
      <Card>
        <div
          style={{
            padding: "24px 0",
            textAlign: "center",
            color: "var(--text-tertiary)",
            fontSize: 13,
          }}
        >
          Add at least one active therapy in Settings → Therapies first.
        </div>
      </Card>
    );
  }

  const therapyById = new Map(therapies.map((t) => [t.id, t]));

  return (
    <Card>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <CardLabel style={{ marginBottom: 0 }}>Templates</CardLabel>
        <NewButton therapies={therapies} />
      </div>
      {items.length === 0 ? (
        <Empty />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((t) => (
            <Row
              key={t.id}
              template={t}
              therapy={therapyById.get(t.therapyId)}
              therapies={therapies}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function Empty() {
  return (
    <div
      style={{
        padding: "32px 0",
        textAlign: "center",
        color: "var(--text-tertiary)",
        fontSize: 13,
      }}
    >
      No templates yet. E.g. &quot;HBOT 10-pack — €855, valid 12 months&quot;.
    </div>
  );
}

function Row({
  template,
  therapy,
  therapies,
}: {
  template: PackageTemplate;
  therapy: Therapy | undefined;
  therapies: Therapy[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [pending, start] = useTransition();
  const vocab = useVocab();
  const confirm = useConfirm();

  return (
    <>
      <div
        onClick={() => setEditOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 14px",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
          opacity: template.isActive ? 1 : 0.5,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--accent, #888)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--hairline)";
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                color: "var(--text-primary)",
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              {template.name}
            </span>
            {!template.isActive && <Badge>Inactive</Badge>}
          </div>
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: 13,
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {therapy && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "var(--radius)",
                    background: therapy.colourHex,
                  }}
                />
                {therapy.name}
              </span>
            )}
            <span>•</span>
            <span>{template.totalSessions} sessions</span>
            <span>•</span>
            <span>€{template.priceEur}</span>
            <span>•</span>
            <span>Valid {formatValidity(template.validityMonths)}</span>
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
            if (!(await confirm({ title: `Delete template "${template.name}"?`, destructive: true }))) return;
            start(async () => {
              await deletePackageTemplateAction(template.id);
              toast.success("Template removed.");
            });
          }}
          style={{ color: "#dc2626" }}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent title={`Edit ${vocab.plan.toLowerCase()} template`} width={560}>
          <TemplateForm
            therapies={therapies}
            initial={template}
            onDone={() => setEditOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewButton({ therapies }: { therapies: Therapy[] }) {
  const [open, setOpen] = useState(false);
  const vocab = useVocab();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus size={14} />
          New template
        </Button>
      </DialogTrigger>
      <DialogContent title={`New ${vocab.plan.toLowerCase()} template`} width={560}>
        <TemplateForm therapies={therapies} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function TemplateForm({
  therapies,
  initial,
  onDone,
}: {
  therapies: Therapy[];
  initial?: PackageTemplate;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const vocab = useVocab();
  const isEdit = !!initial;

  // Everything the dialog opened with — what "Undo changes" restores to.
  const [opened] = useState(() => ({
    name: initial?.name ?? "",
    therapyId: initial?.therapyId ?? therapies[0]?.id ?? 0,
    sessions: initial?.totalSessions ?? 10,
    price: initial?.priceEur ?? 0,
    validity: initial?.validityMonths ?? 12,
    notes: initial?.notes ?? "",
    isActive: initial?.isActive ?? true,
  }));
  const [name, setName] = useState(opened.name);
  const [therapyId, setTherapyId] = useState<number>(opened.therapyId);
  const [sessions, setSessions] = useState<number>(opened.sessions);
  const [price, setPrice] = useState<number>(opened.price);
  const [validity, setValidity] = useState<number>(opened.validity);
  const [notes, setNotes] = useState(opened.notes);
  const [isActive, setIsActive] = useState<boolean>(opened.isActive);

  const therapy = therapies.find((t) => t.id === therapyId);
  const values = { name, therapyId, sessions, price, validity, notes, isActive };
  const savable = name.trim() !== "" && therapyId > 0 && sessions >= 1 && price >= 0 && validity >= 1;

  function toFormData(v: typeof values): FormData {
    const fd = new FormData();
    fd.set("name", v.name);
    fd.set("therapyId", String(v.therapyId));
    fd.set("totalSessions", String(v.sessions));
    fd.set("priceEur", String(v.price));
    fd.set("validityMonths", String(v.validity));
    fd.set("notes", v.notes);
    fd.set("isActive", v.isActive ? "true" : "false");
    return fd;
  }

  function autoPrice() {
    if (!therapy) return;
    setPrice(Math.round(therapy.defaultPriceEur * sessions));
  }

  // Editing autosaves; creating still needs the explicit Add — there is no row
  // to write into until it exists.
  const autosave = useAutosave({
    values,
    enabled: isEdit && savable,
    blockedReason: "Needs a name and a chosen " + vocab.service.toLowerCase(),
    save: async (v) => {
      if (!initial) return;
      await updatePackageTemplateAction(initial.id, toFormData(v));
    },
  });

  const changedSinceOpen = JSON.stringify(values) !== JSON.stringify(opened);

  function undo() {
    setName(opened.name);
    setTherapyId(opened.therapyId);
    setSessions(opened.sessions);
    setPrice(opened.price);
    setValidity(opened.validity);
    setNotes(opened.notes);
    setIsActive(opened.isActive);
  }

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    start(async () => {
      try {
        await createPackageTemplateAction(toFormData(values));
        toast.success("Template added.");
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div>
        <Label>{vocab.service}</Label>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 8,
            marginTop: 6,
          }}
        >
          {therapies.map((t) => {
            const sel = therapyId === t.id;
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => setTherapyId(t.id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  border: `1px solid ${sel ? t.colourHex : "var(--hairline)"}`,
                  background: sel ? `${t.colourHex}14` : "transparent",
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</span>
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "var(--text-tertiary)",
                    marginTop: 2,
                  }}
                >
                  €{t.defaultPriceEur} · {t.defaultDurationMinutes} min
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <Label htmlFor="totalSessions">Sessions</Label>
          <Input
            id="totalSessions"
            type="number"
            min={1}
            value={sessions}
            onChange={(e) => setSessions(Math.max(1, Number(e.target.value)))}
          />
        </div>
        <div>
          <Label htmlFor="priceEur">Price (€)</Label>
          <Input
            id="priceEur"
            type="number"
            step="0.01"
            min={0}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
          <button
            type="button"
            onClick={autoPrice}
            style={{
              marginTop: 4,
              fontSize: 11,
              background: "transparent",
              border: "none",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: 0,
              fontFamily: "inherit",
              textDecoration: "underline",
            }}
          >
            Auto-fill from rate
          </button>
        </div>
        <div>
          <Label htmlFor="validityMonths">Valid for (months)</Label>
          <Input
            id="validityMonths"
            type="number"
            min={1}
            value={validity}
            onChange={(e) => setValidity(Math.max(1, Number(e.target.value)))}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="notes" srOnly>Notes (optional)</Label>
        <Textarea
          id="notes"
          rows={2}
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--text-secondary)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        Active (visible on Sell-package page)
      </label>

      {isEdit ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button type="button" variant="ghost" disabled={!changedSinceOpen} onClick={undo}>
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending || !savable}>
            {pending ? "Adding…" : "Add template"}
          </Button>
        </div>
      )}
    </form>
  );
}
