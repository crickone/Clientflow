"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Dumbbell, Eye, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import { deleteCircuitAction, duplicateCircuitAction } from "@/app/workout/circuits/actions";

interface CircuitRow {
  id: number;
  name: string;
  tags: string[];
  rounds: number;
  exerciseCount: number;
  createdAt: number;
  updatedAt: number;
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" });
}

export function CircuitsView({ circuits }: { circuits: CircuitRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return circuits;
    return circuits.filter((c) => c.name.toLowerCase().includes(query) || c.tags.some((t) => t.toLowerCase().includes(query)));
  }, [circuits, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {circuits.length} circuit{circuits.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", width: 240 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search circuits…" style={{ paddingLeft: 32 }} />
          </div>
          <Button onClick={() => router.push("/workout/circuits/new")}>
            <Plus size={15} /> Add Circuit
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Dumbbell size={32} strokeWidth={1.4} />}
          title="No circuits yet"
          message="Click Add Circuit to build your first."
        />
      ) : (
        <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 820 }}>
              <div style={{ ...row, ...headRow }}>
                <div>Circuit name</div>
                <div>Created</div>
                <div style={{ textAlign: "right" }}>Exercises</div>
                <div>Tags</div>
                <div>Last edit</div>
                <div style={{ textAlign: "right" }}>Actions</div>
                <div style={{ textAlign: "center" }}>View</div>
              </div>
              {filtered.map((c) => (
                <CircuitRowItem key={c.id} circuit={c} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CircuitRowItem({ circuit }: { circuit: CircuitRow }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, start] = useTransition();
  const onEdit = () => router.push(`/workout/circuits/${circuit.id}`);
  const onView = () => router.push(`/workout/circuits/${circuit.id}/preview`);

  const duplicate = () =>
    start(async () => {
      const res = await duplicateCircuitAction(circuit.id);
      if (res.ok) {
        toast.success("Circuit duplicated.");
        router.refresh();
      } else toast.error(res.error);
    });
  const remove = () =>
    start(async () => {
      if (!(await confirm({ title: `Delete "${circuit.name}"?`, body: "This cannot be undone.", destructive: true }))) return;
      await deleteCircuitAction(circuit.id);
      toast.success("Circuit deleted.");
      router.refresh();
    });

  return (
    <div style={{ ...row, opacity: pending ? 0.6 : 1 }}>
      <button onClick={onEdit} style={titleCell} title="Open circuit">
        <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{circuit.name}</span>
      </button>
      <div style={cellMuted}>{fmtDate(circuit.createdAt)}</div>
      <div style={{ textAlign: "right", fontFamily: "var(--font-mono), monospace", fontSize: 12.5, color: "var(--text-secondary)" }}>{circuit.exerciseCount}</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {circuit.tags.length === 0 ? (
          <span style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>—</span>
        ) : (
          circuit.tags.slice(0, 3).map((t) => (
            <span key={t} style={pill}>
              {t}
            </span>
          ))
        )}
      </div>
      <div style={cellMuted}>{fmtDate(circuit.updatedAt)}</div>
      <div style={{ textAlign: "right" }}>
        <RowMenu onEdit={onEdit} onView={onView} onDuplicate={duplicate} onDelete={remove} disabled={pending} />
      </div>
      <div style={{ textAlign: "center" }}>
        <Tooltip label="Preview">
          <button onClick={onView} aria-label="View" style={iconBtn}>
            <Eye size={15} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function RowMenu({ onEdit, onView, onDuplicate, onDelete, disabled }: { onEdit: () => void; onView: () => void; onDuplicate: () => void; onDelete: () => void; disabled: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button disabled={disabled} aria-label="Actions" style={iconBtn}>
          <MoreHorizontal size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit} style={{ color: "var(--text-primary)" }}>
          <Pencil size={14} /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onView} style={{ color: "var(--text-primary)" }}>
          <Eye size={14} /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate} style={{ color: "var(--text-primary)" }}>
          <Copy size={14} /> Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} destructive>
          <Trash2 size={14} /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const pill: React.CSSProperties = { display: "inline-block", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "var(--font-mono), monospace", padding: "2px 8px", borderRadius: 5, background: "var(--surface-2)", color: "var(--text-secondary)" };
const row: React.CSSProperties = { display: "grid", gridTemplateColumns: "2fr 1fr 0.7fr 1.1fr 1fr 0.6fr 0.5fr", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--hairline)", alignItems: "center", fontSize: 13 };
const headRow: React.CSSProperties = { background: "var(--surface-1)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" };
const titleCell: React.CSSProperties = { textAlign: "left", background: "transparent", border: "none", cursor: "pointer", minWidth: 0, padding: 0 };
const cellMuted: React.CSSProperties = { color: "var(--text-secondary)", fontSize: 12.5 };
const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" };
