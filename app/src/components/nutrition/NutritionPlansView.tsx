"use client";

import { useMemo, useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  FileUp,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { Input } from "@/components/ui/Input";
import { PLAN_TYPE_LABEL, type MacroMode, type Macros, type PlanStatus, type PlanType } from "@/lib/nutritionModel";
import {
  deletePlanAction,
  duplicatePlanAction,
  setPlanStatusAction,
} from "@/app/nutrition/actions";

interface PlanRow {
  id: number;
  title: string;
  type: PlanType;
  macroMode: MacroMode | null;
  status: PlanStatus;
  tags: string[];
  updatedAt: number;
  dayCount: number;
  totals: Macros;
  uploadOriginalName: string | null;
}

function fmtDate(ms: number) {
  const d = new Date(ms);
  // Format the time manually — toLocaleTimeString's am/pm string differs between
  // Node (server) and the browser, which trips React hydration.
  let h = d.getHours();
  const ampm = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  const time = `${h}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
  return {
    day: d.toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }),
    time,
  };
}

export function NutritionPlansView({ plans }: { plans: PlanRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return plans;
    return plans.filter(
      (p) =>
        p.title.toLowerCase().includes(query) ||
        p.tags.some((t) => t.toLowerCase().includes(query)),
    );
  }, [plans, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {plans.length} plan{plans.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 240 }}>
            <Search
              size={15}
              style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }}
            />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plans…" style={{ paddingLeft: 32 }} />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={15} />
            Add Nutrition Plan
          </Button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 940 }}>
            <div style={{ ...row, ...headRow }}>
              <div>Title</div>
              <div>Last updated</div>
              <div>Macronutrients</div>
              <div>Calories</div>
              <div>Status</div>
              <div>Tags</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>

            {filtered.length === 0 && (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5 }}>
                No nutrition plans yet. Click <strong>Add Nutrition Plan</strong> to build your first.
              </div>
            )}

            {filtered.map((p) => (
              <PlanRowItem key={p.id} plan={p} onGo={() => router.push(`/nutrition/${p.id}`)} />
            ))}
          </div>
        </div>
      </div>

      <CreateTypeDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function PlanRowItem({ plan, onGo }: { plan: PlanRow; onGo: () => void }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, start] = useTransition();
  const dt = fmtDate(plan.updatedAt);
  const isUpload = plan.type === "upload";

  const duplicate = () =>
    start(async () => {
      const res = await duplicatePlanAction(plan.id);
      if (res.ok) {
        toast.success("Plan duplicated.");
        router.refresh();
      } else toast.error(res.error);
    });
  const toggleArchive = () =>
    start(async () => {
      await setPlanStatusAction(plan.id, plan.status === "active" ? "archived" : "active");
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      if (!(await confirm({ title: `Delete "${plan.title}"?`, body: "This cannot be undone.", destructive: true }))) return;
      await deletePlanAction(plan.id);
      toast.success("Plan deleted.");
      router.refresh();
    });

  return (
    <div style={{ ...row, opacity: pending ? 0.6 : 1 }}>
      <button onClick={onGo} style={titleCell} title="Open plan">
        <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{plan.title}</span>
        <span style={{ fontSize: 12, color: "var(--accent-ink)" }}>
          {PLAN_TYPE_LABEL[plan.type]}
          {plan.type === "macro" ? ` · ${plan.macroMode === "daily" ? "Daily totals" : "Per meal"}` : ""}
        </span>
      </button>

      <div style={cellMuted}>
        <div>{dt.day}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{dt.time}</div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5 }}>
        <Macro label="Protein" value={plan.totals.protein} />
        <Macro label="Carbs" value={plan.totals.carbs} />
        <Macro label="Fat" value={plan.totals.fat} />
      </div>

      <div>
        <span
          style={{
            fontFamily: "var(--font-mono), monospace",
            fontSize: 12.5,
            padding: "3px 9px",
            borderRadius: 6,
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
          }}
        >
          {Math.round(plan.totals.calories)}kcal
        </span>
      </div>

      <div>
        {plan.status === "active" ? (
          <span style={pill("rgba(34,197,94,0.14)", "#22c55e")}>Active</span>
        ) : (
          <span style={pill("rgba(255,255,255,0.06)", "var(--text-tertiary)")}>Archived</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {plan.tags.length === 0 ? (
          <span style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>—</span>
        ) : (
          plan.tags.slice(0, 3).map((t) => (
            <span key={t} style={pill("var(--surface-2)", "var(--text-secondary)")}>
              {t}
            </span>
          ))
        )}
      </div>

      <div style={{ textAlign: "right" }}>
        <RowMenu
          isUpload={isUpload}
          status={plan.status}
          onEdit={onGo}
          onDuplicate={duplicate}
          onArchive={toggleArchive}
          onDelete={remove}
          onDownload={isUpload ? () => window.open(`/api/nutrition/file?plan=${plan.id}`, "_blank") : undefined}
          disabled={pending}
        />
      </div>
    </div>
  );
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ color: "var(--text-secondary)" }}>
      <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono), monospace" }}>
        {Math.round(value)}g
      </strong>{" "}
      {label}
    </span>
  );
}

function RowMenu({
  isUpload,
  status,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
  onDownload,
  disabled,
}: {
  isUpload: boolean;
  status: PlanStatus;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  disabled: boolean;
}) {
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
    <button
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        textAlign: "left",
        padding: "8px 12px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        color: danger ? "#f87171" : "var(--text-primary)",
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-label="Actions"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: "var(--radius)",
          border: "1px solid var(--hairline)",
          background: "transparent",
          color: "var(--text-secondary)",
          cursor: "pointer",
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 30,
            minWidth: 176,
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
            overflow: "hidden",
            padding: "4px 0",
          }}
        >
          {item("Edit", <Pencil size={14} />, onEdit)}
          {onDownload && item("Download", <Download size={14} />, onDownload)}
          {item("Duplicate", <Copy size={14} />, onDuplicate)}
          {item(
            status === "active" ? "Archive" : "Restore",
            status === "active" ? <Archive size={14} /> : <ArchiveRestore size={14} />,
            onArchive,
          )}
          <div style={{ height: 1, background: "var(--hairline)", margin: "4px 0" }} />
          {item("Delete", <Trash2 size={14} />, onDelete, true)}
        </div>
      )}
    </div>
  );
}

// ── create-type modal (Full / Macro / Upload) ─────────────────────────────────

function CreateTypeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<"type" | "macro">("type");

  useEffect(() => {
    if (open) setStep("type");
  }, [open]);

  const go = (qs: string) => {
    onClose();
    router.push(`/nutrition/new?${qs}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={step === "type" ? "Create a nutrition plan" : "Macros for each meal or daily totals?"}
        width={700}
      >
        {step === "type" ? (
          <RevealGroup style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
            <Reveal key="full">
              <TypeCard
                icon={<UtensilsCrossed size={22} />}
                title="Full Meal Plan"
                desc="Days, meals and foods with per-food macros."
                cta="Create Full Plan"
                onClick={() => go("type=full")}
              />
            </Reveal>
            <Reveal key="macro">
              <TypeCard
                icon={<ListChecks size={22} />}
                title="Macro Only Plan"
                desc="Set protein / carbs / fat / calories targets."
                cta="Create Macro Plan"
                onClick={() => setStep("macro")}
              />
            </Reveal>
            <Reveal key="upload">
              <TypeCard
                icon={<FileUp size={22} />}
                title="Upload Plan"
                desc="Attach an existing PDF or Excel document."
                cta="Upload"
                onClick={() => go("type=upload")}
              />
            </Reveal>
          </RevealGroup>
        ) : (
          <RevealGroup style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            <Reveal key="daily">
              <TypeCard
                title="Total For Day"
                desc="One set of macro totals for the whole day."
                cta="Total For Day"
                onClick={() => go("type=macro&mode=daily")}
              />
            </Reveal>
            <Reveal key="per-meal">
              <TypeCard
                title="Each Meal"
                desc="Macro targets per meal, summed into the day."
                cta="Each Meal"
                onClick={() => go("type=macro&mode=per_meal")}
              />
            </Reveal>
          </RevealGroup>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <Button variant="ghost" onClick={step === "macro" ? () => setStep("type") : onClose}>
            {step === "macro" ? "Back" : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TypeCard({
  icon,
  title,
  desc,
  cta,
  onClick,
}: {
  icon?: React.ReactNode;
  title: string;
  desc: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        height: "100%",
        background: "var(--surface-1)",
      }}
    >
      {icon && (
        <div style={{ color: "var(--accent-ink)", height: 26, display: "flex", alignItems: "center" }}>{icon}</div>
      )}
      <div
        style={{
          fontSize: 14.5,
          fontWeight: 600,
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 38, flex: 1 }}>{desc}</div>
      <Button
        onClick={onClick}
        variant="outline"
        style={{ width: "100%", justifyContent: "center", marginTop: 8, whiteSpace: "normal", minHeight: 38 }}
      >
        {cta}
      </Button>
    </div>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────

function pill(bg: string, fg: string): React.CSSProperties {
  return {
    display: "inline-block",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontFamily: "var(--font-mono), monospace",
    padding: "2px 8px",
    borderRadius: 5,
    background: bg,
    color: fg,
  };
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.7fr 1fr 1.7fr 0.8fr 0.8fr 1fr 0.7fr",
  gap: 12,
  padding: "12px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const titleCell: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  textAlign: "left",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  minWidth: 0,
  padding: 0,
};
const cellMuted: React.CSSProperties = { color: "var(--text-secondary)", fontSize: 12.5 };
