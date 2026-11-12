"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { setFlagAction } from "@/app/(console)/flags/actions";
import type { PlatformFlag } from "@/lib/types";

/** One module's rollout: everyone, nobody, a percentage, or a named list. Saves on Apply, after a confirm that says who gets it. */
export function FlagEditor({ flag, label, count, total, tenants, isOwner }: { flag: PlatformFlag; label: string; count: number; total: number; tenants: Array<{ id: number; name: string }>; isOwner: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<PlatformFlag>(flag);
  const norm = (f: PlatformFlag) => JSON.stringify({ ...f, allow: [...f.allow].sort((a, b) => a - b) });
  const dirty = norm(draft) !== norm(flag);
  // An empty named list gives the module to nobody; that is what "Nobody" is for.
  const emptyAllow = draft.mode === "allow" && draft.allow.length === 0;

  async function apply() {
    const r = await ask({
      title: `Change the rollout of ${label}`,
      body: draft.mode === "all" ? "Every business gets it." : draft.mode === "none" ? "No business gets it; their pages are refused and the module leaves their sidebar." : draft.mode === "percent" ? `About ${draft.percent}% of businesses get it, chosen by a stable hash so nobody flips back and forth.` : `${draft.allow.length} named ${draft.allow.length === 1 ? "business gets" : "businesses get"} it.`,
      confirmLabel: "Apply",
      danger: draft.mode === "none",
    });
    if (!r.ok) return;
    start(async () => {
      const res = await setFlagAction(draft);
      if (res.ok) { notify.ok(`${label}: rollout saved`); router.refresh(); } else notify.fail(res.error);
    });
  }

  return (
    <div className="flag">
      <div className="flag-head">
        <strong>{label}</strong>
        <span className="flag-count">{count} of {total} businesses</span>
      </div>
      <div className="toolbar">
        <select className="input" aria-label={`${label} rollout mode`} value={draft.mode} disabled={!isOwner} onChange={(e) => setDraft({ ...draft, mode: e.target.value as PlatformFlag["mode"] })}>
          <option value="all">Everyone</option>
          <option value="percent">A percentage</option>
          <option value="allow">Named businesses</option>
          <option value="none">Nobody</option>
        </select>
        {draft.mode === "percent" && (
          <label className="check">
            <input type="range" aria-label={`${label} rollout percentage`} min={0} max={100} step={5} value={draft.percent} disabled={!isOwner} onChange={(e) => setDraft({ ...draft, percent: Number(e.target.value) })} />
            <span className="flag-pct">{draft.percent}%</span>
          </label>
        )}
        {isOwner && dirty && <button type="button" className="btn btn--primary btn--sm" onClick={apply} disabled={pending || emptyAllow}>Apply</button>}
        {isOwner && dirty && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(flag)} disabled={pending}>Reset</button>}
      </div>
      {isOwner && emptyAllow && <p className="flag-hint">Tick at least one business, or choose Nobody.</p>}
      {draft.mode === "allow" && (
        <div className="flag-allow">
          {tenants.map((t) => (
            <label key={t.id} className="check">
              <input type="checkbox" checked={draft.allow.includes(t.id)} disabled={!isOwner} onChange={(e) => setDraft({ ...draft, allow: e.target.checked ? [...draft.allow, t.id] : draft.allow.filter((x) => x !== t.id) })} /> {t.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
