"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { FormTypeMeta, FormType } from "@/lib/formsModel";
import {
  deleteFormAction,
  duplicateFormAction,
  setFormDefaultAction,
  setFormStatusAction,
  setFormTriggerStatusAction,
} from "@/app/forms/actions";

interface FormRow {
  id: number;
  title: string;
  isDefault: boolean;
  status: boolean;
  triggerStatus: boolean;
  shareSlug: string | null;
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

function fmtDate(ms: number) {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  const t = `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
  return { day: d.toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }), time: t };
}

export function Switch({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      style={{ width: 44, height: 25, borderRadius: 999, background: on ? "var(--accent)" : "var(--surface-3)", border: "1px solid var(--hairline)", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.15s var(--ease)" }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 21 : 2, width: 19, height: 19, borderRadius: "50%", background: "#fff", transition: "left 0.15s var(--ease)" }} />
    </button>
  );
}

export function FormsListView({ type, meta, forms }: { type: FormType; meta: FormTypeMeta; forms: FormRow[] }) {
  const router = useRouter();
  const isContact = meta.kind === "contact";
  const showDefault = meta.kind === "wizard";

  const cols = isContact
    ? "1.6fr 0.9fr 0.9fr 1fr 0.7fr"
    : showDefault
      ? "1.8fr 0.8fr 0.8fr 1.1fr 1.1fr 0.7fr"
      : "1.8fr 0.8fr 1.1fr 1.1fr 0.7fr";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {forms.length} {forms.length === 1 ? "form" : "forms"}
        </span>
        <Button style={{ marginLeft: "auto" }} onClick={() => router.push(`/forms/${type}/new`)}>
          <Plus size={15} /> {meta.addLabel}
        </Button>
      </div>

      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ ...rowStyle(cols), ...headRow }}>
              <div>{isContact ? "Form title" : "Title"}</div>
              {isContact ? (
                <>
                  <div style={{ textAlign: "center" }}>Status</div>
                  <div style={{ textAlign: "center" }}>Trigger status</div>
                  <div>View link</div>
                </>
              ) : (
                <>
                  {showDefault && <div style={{ textAlign: "center" }}>Default</div>}
                  <div style={{ textAlign: "center" }}>Status</div>
                  <div>Created on</div>
                  <div>Last updated</div>
                </>
              )}
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>

            {forms.length === 0 && (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5 }}>
                It looks like you don&apos;t have any yet. Click <strong>{meta.addLabel}</strong> to add one.
              </div>
            )}

            {forms.map((f) => (
              <FormRowItem key={f.id} form={f} type={type} meta={meta} cols={cols} isContact={isContact} showDefault={showDefault} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FormRowItem({
  form,
  type,
  meta,
  cols,
  isContact,
  showDefault,
}: {
  form: FormRow;
  type: FormType;
  meta: FormTypeMeta;
  cols: string;
  isContact: boolean;
  showDefault: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [status, setStatus] = useState(form.status);
  const [trigger, setTrigger] = useState(form.triggerStatus);
  const d = fmtDate(form.createdAt);
  const u = fmtDate(form.updatedAt);
  const onEdit = () => router.push(`/forms/${type}/${form.id}`);

  const toggleStatus = () => {
    const next = !status;
    setStatus(next);
    start(async () => {
      await setFormStatusAction(form.id, next, type);
      router.refresh();
    });
  };
  const toggleTrigger = () => {
    const next = !trigger;
    setTrigger(next);
    start(async () => {
      await setFormTriggerStatusAction(form.id, next, type);
      router.refresh();
    });
  };
  const setDefault = () =>
    start(async () => {
      await setFormDefaultAction(form.id, type);
      router.refresh();
    });
  const duplicate = () =>
    start(async () => {
      const res = await duplicateFormAction(form.id, type);
      if (res.ok) {
        toast.success("Duplicated.");
        router.refresh();
      } else toast.error(res.error);
    });
  const remove = () =>
    start(async () => {
      if (!(await confirm({ title: `Delete "${form.title || "this form"}"?`, destructive: true }))) return;
      await deleteFormAction(form.id, type);
      toast.success("Deleted.");
      router.refresh();
    });
  const copyLink = () => {
    const url = `${window.location.origin}/f/${form.shareSlug ?? form.id}`;
    navigator.clipboard?.writeText(url);
    toast.success("Link copied.");
  };

  return (
    <div style={{ ...rowStyle(cols), opacity: pending ? 0.7 : 1 }}>
      <button onClick={onEdit} style={{ textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{form.title || `Untitled ${meta.label}`}</div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{form.questionCount} question{form.questionCount === 1 ? "" : "s"}</div>
      </button>

      {isContact ? (
        <>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Switch on={status} onClick={toggleStatus} disabled={pending} />
          </div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Switch on={trigger} onClick={toggleTrigger} disabled={pending} />
          </div>
          <div>
            <button onClick={copyLink} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--accent-ink)", cursor: "pointer", fontSize: 13 }}>
              <Link2 size={14} /> Copy link
            </button>
          </div>
        </>
      ) : (
        <>
          {showDefault && (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Switch on={form.isDefault} onClick={setDefault} disabled={pending || form.isDefault} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Switch on={status} onClick={toggleStatus} disabled={pending} />
          </div>
          <div style={cellMuted}>
            <div>{d.day}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{d.time}</div>
          </div>
          <div style={cellMuted}>
            <div>{u.day}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{u.time}</div>
          </div>
        </>
      )}

      <div style={{ textAlign: "right" }}>
        <RowMenu onEdit={onEdit} onDuplicate={duplicate} onDelete={remove} disabled={pending} />
      </div>
    </div>
  );
}

function RowMenu({ onEdit, onDuplicate, onDelete, disabled }: { onEdit: () => void; onDuplicate: () => void; onDelete: () => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const item = (label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button onClick={() => { setOpen(false); onClick(); }} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", fontSize: 13, color: danger ? "#f87171" : "var(--text-primary)" }}>
      {icon}
      {label}
    </button>
  );
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen((v) => !v)} disabled={disabled} aria-label="Actions" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30, minWidth: 150, background: "var(--surface-1)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", boxShadow: "0 8px 28px rgba(0,0,0,0.28)", overflow: "hidden", padding: "4px 0" }}>
          {item("Edit", <Pencil size={14} />, onEdit)}
          {item("Duplicate", <Copy size={14} />, onDuplicate)}
          <div style={{ height: 1, background: "var(--hairline)", margin: "4px 0" }} />
          {item("Delete", <Trash2 size={14} />, onDelete, true)}
        </div>
      )}
    </div>
  );
}

function rowStyle(cols: string): React.CSSProperties {
  return { display: "grid", gridTemplateColumns: cols, gap: 12, padding: "13px 16px", borderBottom: "1px solid var(--hairline)", alignItems: "center", fontSize: 13 };
}
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const cellMuted: React.CSSProperties = { color: "var(--text-secondary)", fontSize: 12.5 };
