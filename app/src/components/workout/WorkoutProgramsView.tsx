"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Download,
  Dumbbell,
  FileUp,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { Input } from "@/components/ui/Input";
import { PROGRAM_TYPE_LABEL, type ProgramStatus, type ProgramType } from "@/lib/workoutModel";
import {
  deleteProgramAction,
  duplicateProgramAction,
  setProgramStatusAction,
} from "@/app/workout/actions";

interface ProgramRow {
  id: number;
  title: string;
  type: ProgramType;
  status: ProgramStatus;
  tags: string[];
  dayCount: number;
  exerciseCount: number;
  createdAt: number;
  updatedAt: number;
  uploadOriginalName: string | null;
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" });
}

export function WorkoutProgramsView({ programs }: { programs: ProgramRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return programs;
    return programs.filter(
      (p) => p.title.toLowerCase().includes(query) || p.tags.some((t) => t.toLowerCase().includes(query)),
    );
  }, [programs, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {programs.length} program{programs.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 240 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search programs…" style={{ paddingLeft: 32 }} />
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> Add Workout Program
          </Button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ ...row, ...headRow }}>
              <div>Program name</div>
              <div>Created</div>
              <div>Type</div>
              <div style={{ textAlign: "right" }}>Days</div>
              <div>Tags</div>
              <div>Last edit</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5 }}>
                No programs yet. Click <strong>Add Workout Program</strong> to build your first.
              </div>
            )}
            {filtered.map((p) => (
              <ProgramRowItem key={p.id} program={p} onGo={() => router.push(`/workout/${p.id}`)} />
            ))}
          </div>
        </div>
      </div>

      <CreateTypeDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function ProgramRowItem({ program, onGo }: { program: ProgramRow; onGo: () => void }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, start] = useTransition();
  const isUpload = program.type === "upload";

  const duplicate = () =>
    start(async () => {
      const res = await duplicateProgramAction(program.id);
      if (res.ok) {
        toast.success("Program duplicated.");
        router.refresh();
      } else toast.error(res.error);
    });
  const toggleArchive = () =>
    start(async () => {
      await setProgramStatusAction(program.id, program.status === "active" ? "archived" : "active");
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      if (!(await confirm({ title: `Delete "${program.title}"?`, body: "This cannot be undone.", destructive: true }))) return;
      await deleteProgramAction(program.id);
      toast.success("Program deleted.");
      router.refresh();
    });

  return (
    <div style={{ ...row, opacity: pending ? 0.6 : 1 }}>
      <button onClick={onGo} style={titleCell} title="Open program">
        <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{program.title}</span>
        {program.type !== "upload" && (
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            {program.exerciseCount} exercise{program.exerciseCount === 1 ? "" : "s"}
          </span>
        )}
      </button>
      <div style={cellMuted}>{fmtDate(program.createdAt)}</div>
      <div>
        <span style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>{PROGRAM_TYPE_LABEL[program.type]}</span>
      </div>
      <div style={{ textAlign: "right", fontFamily: "var(--font-mono), monospace", fontSize: 12.5, color: "var(--text-secondary)" }}>
        {isUpload ? "—" : program.dayCount}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {program.tags.length === 0 ? (
          <span style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>—</span>
        ) : (
          program.tags.slice(0, 3).map((t) => (
            <span key={t} style={pill("var(--surface-2)", "var(--text-secondary)")}>
              {t}
            </span>
          ))
        )}
      </div>
      <div style={cellMuted}>{fmtDate(program.updatedAt)}</div>
      <div style={{ textAlign: "right" }}>
        <RowMenu
          status={program.status}
          onEdit={onGo}
          onDuplicate={duplicate}
          onArchive={toggleArchive}
          onDelete={remove}
          onDownload={isUpload ? () => window.open(`/api/workout/file?program=${program.id}`, "_blank") : undefined}
          disabled={pending}
        />
      </div>
    </div>
  );
}

function RowMenu({
  status,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
  onDownload,
  disabled,
}: {
  status: ProgramStatus;
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

function CreateTypeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const go = (type: string) => {
    onClose();
    router.push(`/workout/new?type=${type}`);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="What type of workout do you want to add?" width={720}>
        <RevealGroup style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
          <Reveal key="simple">
            <TypeCard
              icon={<FileText size={22} />}
              title="Simple Program"
              desc="Copy & paste notes or type out a workout."
              cta="Create Simple"
              onClick={() => go("simple")}
            />
          </Reveal>
          <Reveal key="detailed">
            <TypeCard
              icon={<Dumbbell size={22} />}
              title="Detailed Program"
              desc="Days, sections & exercises with sets, reps, RIR/RPE."
              cta="Create Detailed"
              onClick={() => go("detailed")}
            />
          </Reveal>
          <Reveal key="upload">
            <TypeCard
              icon={<FileUp size={22} />}
              title="Upload Plan"
              desc="Attach an existing PDF or Excel document."
              cta="Upload"
              onClick={() => go("upload")}
            />
          </Reveal>
        </RevealGroup>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
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
  icon: React.ReactNode;
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
      <div style={{ color: "var(--accent-ink)", height: 26, display: "flex", alignItems: "center" }}>{icon}</div>
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
      <Button onClick={onClick} variant="outline" style={{ width: "100%", justifyContent: "center", marginTop: 8, whiteSpace: "normal", minHeight: 38 }}>
        {cta}
      </Button>
    </div>
  );
}

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
  gridTemplateColumns: "1.9fr 1fr 0.8fr 0.6fr 1.1fr 1fr 0.7fr",
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
