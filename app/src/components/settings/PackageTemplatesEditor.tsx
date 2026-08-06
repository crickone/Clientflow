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

  const [therapyId, setTherapyId] = useState<number>(
    initial?.therapyId ?? therapies[0]?.id ?? 0,
  );
  const [sessions, setSessions] = useState<number>(initial?.totalSessions ?? 10);
  const [price, setPrice] = useState<number>(initial?.priceEur ?? 0);
  const [validity, setValidity] = useState<number>(initial?.validityMonths ?? 12);
  const [isActive, setIsActive] = useState<boolean>(initial?.isActive ?? true);

  const therapy = therapies.find((t) => t.id === therapyId);

  function autoPrice() {
    if (!therapy) return;
    setPrice(Math.round(therapy.defaultPriceEur * sessions));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("therapyId", String(therapyId));
    fd.set("totalSessions", String(sessions));
    fd.set("priceEur", String(price));
    fd.set("validityMonths", String(validity));
    fd.set("isActive", isActive ? "true" : "false");
    start(async () => {
      try {
        if (isEdit && initial) {
          await updatePackageTemplateAction(initial.id, fd);
          toast.success("Template updated.");
        } else {
          await createPackageTemplateAction(fd);
          toast.success("Template added.");
        }
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
        <Input
          id="name"
          name="name"
          placeholder="e.g. 10-session pack"
          defaultValue={initial?.name ?? ""}
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
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
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

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending
            ? isEdit
              ? "Saving…"
              : "Adding…"
            : isEdit
              ? "Save changes"
              : "Add template"}
        </Button>
      </div>
    </form>
  );
}
