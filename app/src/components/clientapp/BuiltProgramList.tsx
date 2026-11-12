// app/src/components/clientapp/BuiltProgramList.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, SectionTitle } from "@/components/clientapp/ui";
import { deleteBuiltProgramAction } from "@/app/app/programs/built/actions";

export interface BuiltProgramItem {
  id: number;
  name: string;
  line: string;
  running: boolean;
}

/** "Build your own", then the member's own programs with Edit, Start and Delete. */
export function BuiltProgramList({ programs, anyLive }: { programs: BuiltProgramItem[]; anyLive: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();

  async function remove(p: BuiltProgramItem) {
    if (busy !== null) return;
    setBusy(p.id);
    try {
      const ok = await confirm({ title: `Delete ${p.name}?`, body: "The program goes. Workouts you logged with it are kept.", confirmLabel: "Delete", destructive: true });
      if (!ok) return;
      const r = await deleteBuiltProgramAction(p.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Program deleted");
      start(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Link href="/app/programs/built/new" className="pg-cta">
        <Plus size={18} aria-hidden /> Build your own
      </Link>
      {programs.length > 0 && <SectionTitle>My programs</SectionTitle>}
      {programs.map((p) => (
        <Card key={p.id} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{p.name}</span>
            {p.running && <span className="pg-tag">Running</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{p.line}</div>
          <div className="bld-row">
            <Link href={`/app/programs/built/${p.id}`} className="pg-chip bld-chip-link">
              Edit
            </Link>
            {!anyLive && (
              <Link href={`/app/programs/built/${p.id}/start`} className="pg-chip bld-chip-link">
                Start
              </Link>
            )}
            {!p.running && (
              <button type="button" className="pg-chip" disabled={busy !== null} onClick={() => void remove(p)}>
                Delete
              </button>
            )}
          </div>
        </Card>
      ))}
      {programs.length > 0 && anyLive && <div className="bld-hint">End your current program on My program to start another.</div>}
    </div>
  );
}
