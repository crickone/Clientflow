"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";

import { setHiddenAction } from "@/app/workout/library/actions";

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

/** Every platform program, with a preview and a switch for whether members see it. */
export function ProgramLibraryView({ rows }: { rows: LibraryRow[] }) {
  const router = useRouter();
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

  return (
    <div className="pl">
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
              <Link href={`/workout/library/${encodeURIComponent(r.key)}`} className="pl-link">
                <Eye size={14} /> Preview
              </Link>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
