"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { notify } from "@/lib/toast";
import { lostCount, segmentOf, whoHasIt } from "@/lib/flagWho";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { setFlagAction } from "@/app/(console)/flags/actions";
import type { PlatformFlag } from "@/lib/types";

export interface FlagRowData {
  flag: PlatformFlag;
  label: string;
  /** What the module does; empty when the app did not send one. */
  blurb: string;
  /** Businesses that can be ticked in the Some panel (live ones, plus any not-live ones already on the list). */
  tenants: Array<{ id: number; name: string }>;
}

type Segment = "everyone" | "some" | "nobody";
const SEGMENTS: Array<{ id: Segment; label: string }> = [
  { id: "everyone", label: "Everyone" },
  { id: "some", label: "Some" },
  { id: "nobody", label: "Nobody" },
];

/** Every module on one table: what it does, who has it, and one rollout control. Data only in, so a server page can render it. */
export function FlagsTable({ rows, total, isOwner }: { rows: FlagRowData[]; total: number; isOwner: boolean }) {
  return (
    <div className="tbl-scroll">
      <table className="tbl flags-tbl">
        <thead>
          <tr>
            <th style={{ width: "18%" }}>Module</th>
            <th>What it does</th>
            <th style={{ width: "26%" }}>Who has it</th>
            <th style={{ width: 300 }}>Rollout</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            // Keyed on the saved flag so a save or a refresh resets the row's draft.
            <FlagRow key={`${r.flag.key}:${JSON.stringify(r.flag)}`} row={r} total={total} isOwner={isOwner} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlagRow({ row, total, isOwner }: { row: FlagRowData; total: number; isOwner: boolean }) {
  const { flag, label, blurb, tenants } = row;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  // The panel edits either a named list or a percentage; start from what is saved.
  const ask = useConfirm();
  const savedDraft = (): PlatformFlag => (flag.mode === "percent" ? flag : { ...flag, mode: "allow" });
  const [draft, setDraft] = useState<PlatformFlag>(savedDraft);
  const usePercent = draft.mode === "percent";
  const emptyAllow = !usePercent && draft.allow.length === 0;
  const active: Segment = open ? "some" : segmentOf(flag);
  const nameOf = (id: number) => tenants.find((t) => t.id === id)?.name ?? `Business ${id}`;
  const who = whoHasIt(flag, total, nameOf);

  function save(next: PlatformFlag, done?: () => void) {
    start(async () => {
      const res = await setFlagAction(next);
      if (res.ok) {
        notify.ok(`${label}: rollout saved`);
        done?.();
        router.refresh();
      } else notify.fail(res.error);
    });
  }

  function closePanel() {
    setOpen(false);
    setDraft(savedDraft());
  }

  async function pick(seg: Segment) {
    if (!isOwner || pending) return;
    if (seg === "some") {
      if (open) closePanel();
      else setOpen(true);
      return;
    }
    closePanel();
    if (segmentOf(flag) === seg) return;
    // Everyone and Nobody are platform-wide, so they ask first. The saved list and percentage are kept so switching back is lossless.
    const r = seg === "nobody"
      ? await ask({ title: `Turn off ${label} for every business?`, body: "No business gets it. Their pages are refused and the module leaves their sidebar until you turn it back on.", confirmLabel: "Turn off", danger: true })
      : await ask({ title: `Turn on ${label} for every business?`, body: `All ${total} businesses get it. A business that switched it off on its own Features tab stays off.`, confirmLabel: "Turn on" });
    if (!r.ok) return;
    save({ ...flag, mode: seg === "everyone" ? "all" : "none" });
  }

  async function saveDraft() {
    const lost = lostCount(flag, draft, tenants.map((t) => t.id));
    if (lost !== 0) {
      const body = lost === null ? `Fewer businesses will have ${label}.` : `${lost} ${lost === 1 ? "business loses" : "businesses lose"} ${label}.`;
      const r = await ask({ title: `Change who has ${label}?`, body, confirmLabel: "Save", danger: true });
      if (!r.ok) return;
    }
    save(draft, () => setOpen(false));
  }

  return (
    <Fragment>
      <tr>
        <td><strong>{label}</strong></td>
        <td style={{ color: "var(--text-tertiary)" }}>{blurb || "-"}</td>
        <td className="flags-who">
          {who.text !== null ? (
            <span style={{ color: flag.mode === "all" ? "var(--text-primary)" : "var(--text-tertiary)" }}>{who.text}</span>
          ) : (
            <span className="flags-chips">
              {who.names.map((n, i) => <span key={`${n}:${i}`} className="chip">{n}</span>)}
              {who.more > 0 && <span style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>+{who.more} more</span>}
            </span>
          )}
        </td>
        <td>
          <div className="seg" role="group" aria-label={`${label} rollout`}>
            {SEGMENTS.map((s) => (
              <button key={s.id} type="button" className={active === s.id ? "on" : undefined} aria-pressed={active === s.id} disabled={!isOwner || pending} onClick={() => pick(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="flags-panel-row">
          <td colSpan={4}>
            <div className="flags-panel">
              {!usePercent && (
                <>
                  <div className="flags-panel-title">Tick the businesses that get {label}</div>
                  <div className="flag-allow">
                    {tenants.map((t) => (
                      <label key={t.id} className="check">
                        <input type="checkbox" checked={draft.allow.includes(t.id)} onChange={(e) => setDraft({ ...draft, allow: e.target.checked ? [...draft.allow, t.id] : draft.allow.filter((x) => x !== t.id) })} /> {t.name}
                      </label>
                    ))}
                  </div>
                  {emptyAllow && <p className="flag-hint">Tick at least one business, or choose Nobody.</p>}
                </>
              )}
              {usePercent && (
                <div className="flags-panel-pct">
                  <div className="flags-panel-title">Give {label} to a share of businesses</div>
                  <label className="check">
                    <input type="range" aria-label={`${label} rollout percentage`} min={0} max={100} step={5} value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: Number(e.target.value) })} />
                    <span className="flag-pct">{draft.percent}%</span>
                  </label>
                  <p className="flag-hint">Chosen by a stable hash, so a business never flips back and forth.</p>
                </div>
              )}
              <div className="toolbar">
                <label className="check">
                  <input type="checkbox" checked={usePercent} onChange={(e) => setDraft(e.target.checked ? { ...draft, mode: "percent" } : { ...draft, mode: "allow" })} /> Percentage instead
                </label>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn--ghost btn--sm" onClick={closePanel} disabled={pending}>Cancel</button>
                <button type="button" className="btn btn--primary btn--sm" onClick={saveDraft} disabled={pending || emptyAllow}>Save</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
