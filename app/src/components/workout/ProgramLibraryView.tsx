// app/src/components/workout/ProgramLibraryView.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { deleteCopyAction, makeCopyAction, setHiddenAction } from "@/app/workout/library/actions";

export interface LibraryRow {
  key: string;
  name: string;
  author: string;
  family: string;
  days: number;
  weeks: number;
  engine: string;
  warning: string | null;
  hidden: boolean;
}

export interface CopyListRow {
  id: number;
  name: string;
  basedOnName: string;
  updatedAt: number;
}

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/** The gym's own versions, then every platform program with a preview, "Make our version" and a switch for whether members see it. */
export function ProgramLibraryView({ rows, copies }: { rows: LibraryRow[]; copies: CopyListRow[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [hidden, setHiddenState] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.key, r.hidden])));
  const [pending, start] = useTransition();

  function toggle(key: string) {
    const next = !hidden[key];
    start(async () => {
      const r = await setHiddenAction(key, next);
      if (!r.ok) return void toast.error(r.error);
      setHiddenState((h) => ({ ...h, [key]: next }));
      toast.success(next ? "Hidden from members" : "Shown to members");
      router.refresh();
    });
  }

  function copy(key: string) {
    start(async () => {
      const r = await makeCopyAction(key);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Made. Change it to suit your gym.");
      router.push(`/workout/library/copies/${r.id}`);
    });
  }

  // Confirm outside the transition: a dialog awaited inside startTransition never settles.
  async function remove(c: CopyListRow) {
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      body: "Members already running it keep going with their own copy. No one new can start it.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await deleteCopyAction(c.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Deleted");
      router.refresh();
    });
  }

  return (
    <div className="pl">
      {copies.length > 0 && (
        <section className="pl-copies">
          <h2 className="pl-section-title">Your versions</h2>
          <div className="pl-table" role="table" aria-label="Your versions">
            {copies.map((c) => (
              <div key={c.id} className="pl-row pl-row--copy" role="row">
                <span role="cell" className="pl-name">
                  <b>{c.name}</b>
                  <small>
                    Our version, based on {c.basedOnName}. Changed {day(c.updatedAt)}.
                  </small>
                </span>
                <span role="cell" className="pl-actions">
                  <Link href={`/workout/library/copies/${c.id}`}>
                    <Button variant="outline" size="sm" tabIndex={-1}>
                      <Pencil size={14} /> Edit
                    </Button>
                  </Link>
                  <Link href={`/workout/library/copy-${c.id}`}>
                    <Button variant="outline" size="sm" tabIndex={-1}>
                      <Eye size={14} /> Preview
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" onClick={() => remove(c)} disabled={pending} aria-label={`Delete ${c.name}`}>
                    <Trash2 size={14} /> Delete
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="pl-section-title">Platform programs</h2>
      <div className="pl-table" role="table" aria-label="Program library">
        <div className="pl-row pl-row--head" role="row">
          <span role="columnheader">Program</span>
          <span role="columnheader">Goal</span>
          <span role="columnheader">Days</span>
          <span role="columnheader">Weeks</span>
          <span role="columnheader">Members see it</span>
          <span role="columnheader" />
        </div>
        {rows.map((r) => (
          <div key={r.key} className="pl-row" role="row">
            <span role="cell" className="pl-name">
              <b>{r.name}</b>
              <small>
                {r.author}. {r.engine}.
              </small>
              {r.warning && (
                <small className="pl-warning">
                  <AlertTriangle size={12} aria-hidden /> {r.warning}
                </small>
              )}
            </span>
            <span role="cell">{r.family}</span>
            <span role="cell">{r.days}</span>
            <span role="cell">{r.weeks}</span>
            <span role="cell">
              <button
                type="button"
                role="switch"
                className="pl-switch"
                aria-checked={!hidden[r.key]}
                aria-label={`${r.name}: ${hidden[r.key] ? "hidden from members" : "shown to members"}`}
                disabled={pending}
                onClick={() => toggle(r.key)}
              >
                <span className="pl-switch-knob" />
              </button>
            </span>
            <span role="cell" className="pl-actions">
              <Link href={`/workout/library/${encodeURIComponent(r.key)}`}>
                <Button variant="outline" size="sm" tabIndex={-1}>
                  <Eye size={14} /> Preview
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => copy(r.key)} disabled={pending}>
                <Copy size={14} /> Make our version
              </Button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
