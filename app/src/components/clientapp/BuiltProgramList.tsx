// app/src/components/clientapp/BuiltProgramList.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { PkCard, PkSection } from "@/components/clientapp/programs/kit";
import { deleteBuiltProgramAction } from "@/app/app/programs/built/actions";
import { memberKey } from "@/lib/programs/memberTemplate";

export interface BuiltProgramItem {
  id: number;
  name: string;
  line: string;
  running: boolean;
}

export interface CurrentProgram {
  name: string;
  /** "Week 2 of 4", or that it is paused. */
  line: string;
}

/**
 * "Build your own", then My programs: the running program first with
 * Continue, then the member's own saved programs with Edit, Start and Delete.
 */
export function BuiltProgramList({ current, programs, anyLive }: { current: CurrentProgram | null; programs: BuiltProgramItem[]; anyLive: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();
  const saved = programs.filter((p) => !p.running);

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
    <>
      <Link href="/app/programs/built/new" className="pk-dashed">
        <Plus size={18} aria-hidden /> Build your own
      </Link>
      {(current || saved.length > 0) && (
        <PkSection label="My programs">
          {current && (
            <PkCard href="/app/programs/mine" accent>
              <div className="pk-row">
                <div>
                  <h3 className="pk-card-title">{current.name}</h3>
                  <span className="pk-small">{current.line}</span>
                </div>
                <span className="pk-ghost">
                  Continue <ChevronRight size={16} />
                </span>
              </div>
            </PkCard>
          )}
          {saved.map((p) => (
            <PkCard key={p.id}>
              <Link href={`/app/programs/${encodeURIComponent(memberKey(p.id))}`} className="pk-linkrow">
                <div>
                  <h3 className="pk-card-title">{p.name}</h3>
                  <span className="pk-small">{p.line}</span>
                </div>
                <ChevronRight size={18} aria-hidden className="pk-chev" />
              </Link>
              <div className="pk-actions">
                <Link href={`/app/programs/built/${p.id}`} className="pk-btn">
                  Edit
                </Link>
                {!anyLive && (
                  <Link href={`/app/programs/built/${p.id}/start`} className="pk-btn">
                    Start
                  </Link>
                )}
                <button type="button" className="pk-btn pk-btn--danger" disabled={busy !== null} onClick={() => void remove(p)}>
                  Delete
                </button>
              </div>
            </PkCard>
          ))}
          {saved.length > 0 && anyLive && <span className="pk-small">End your current program on My program to start another.</span>}
        </PkSection>
      )}
    </>
  );
}
