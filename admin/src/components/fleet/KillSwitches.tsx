"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setKillSwitchAction } from "@/app/(console)/gyms/actions";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { KillSwitchState } from "@/lib/types";

/** What each switch stops and what keeps working, in plain words. */
const COPY: Record<KillSwitchState["key"], { stops: string; keeps: string; noun: string }> = {
  ai: {
    stops: "Adonis chats, Content Studio, blogs and the daily brief.",
    keeps: "Everything that does not use AI.",
    noun: "AI",
  },
  email: {
    stops: "Campaign sends and nurture emails.",
    keeps: "Invites and password resets.",
    noun: "email",
  },
  posting: {
    stops: "Scheduled social posts. They stay queued.",
    keeps: "Everything else, including drafting posts.",
    noun: "posting",
  },
};

function when(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * The three emergency stops, one card each, on /switches.
 *
 * Shown to both roles, because knowing the platform is paused explains half
 * the support calls that follow. Only an owner can move one, and stopping
 * asks for a reason: it is the most far-reaching action in the console.
 */
export function KillSwitches({ switches, isOwner }: { switches: KillSwitchState[]; isOwner: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const [pending, start] = useTransition();

  async function toggle(s: KillSwitchState) {
    const copy = COPY[s.key];
    let reason = "";
    if (!s.stopped) {
      const r = await ask({
        title: `Stop ${copy.noun} for every business?`,
        body: "Work waits while it is off and resumes when you start it again.",
        confirmLabel: "Stop",
        danger: true,
        prompt: { label: "Why?", placeholder: "Provider outage", minLength: 3 },
      });
      if (!r.ok) return;
      reason = r.value;
    }
    start(async () => {
      const r = await setKillSwitchAction(s.key, !s.stopped, reason);
      if (r.ok) {
        notify.ok(r.note);
        router.refresh();
      } else {
        notify.fail(r.error);
      }
    });
  }

  return (
    <div className="switch-grid">
      {switches.map((s) => {
        const copy = COPY[s.key] ?? { stops: s.blurb, keeps: "", noun: s.label.toLowerCase() };
        const stoppedAt = when(s.since);
        return (
          <section key={s.key} className={s.stopped ? "card switch-card is-stopped" : "card switch-card"}>
            <div className="switch-head">
              <h2 className="card-title" style={{ margin: 0 }}>{s.label}</h2>
              {s.stopped ? (
                <span className="chip" style={{ backgroundColor: "rgba(240,128,154,.12)", color: "var(--red)" }}>Stopped</span>
              ) : (
                <span className="chip" style={{ backgroundColor: "rgba(63,185,80,.12)", color: "var(--green)" }}>Running</span>
              )}
            </div>
            <div className="switch-copy">
              <p><span>Stops:</span> {copy.stops}</p>
              {copy.keeps && <p><span>Keeps working:</span> {copy.keeps}</p>}
            </div>
            {s.stopped && (
              <p className="switch-stopped-note">
                {stoppedAt ? `Stopped ${stoppedAt}${s.by ? ` by ${s.by}` : ""}.` : "Stopped."}
                {s.reason ? ` ${s.reason}` : ""}
              </p>
            )}
            {isOwner ? (
              <button
                type="button"
                className={s.stopped ? "btn btn--primary btn--md" : "btn btn--destructive btn--md"}
                disabled={pending}
                onClick={() => toggle(s)}
              >
                {s.stopped ? `Start ${copy.noun}` : `Stop ${copy.noun}`}
              </button>
            ) : (
              <p className="switch-owner-note">Only an owner can change this.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
