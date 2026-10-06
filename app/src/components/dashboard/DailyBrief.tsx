"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Coins, Inbox, Megaphone, RefreshCw, UserPlus, Users, type LucideIcon } from "lucide-react";

import type { BriefItem, BriefKind } from "@/lib/dashboard/briefItems";

/**
 * Today's priorities: up to three action cards the AI picks from live data
 * (/api/assistant/brief), each one line plus a button to the page that does
 * the job. Cached for ten minutes per tab so dashboard reloads don't re-ask.
 * A quiet day is one short line, not filler.
 */

const TTL_MS = 10 * 60 * 1000;
const ICON: Record<BriefKind, LucideIcon> = {
  leads: UserPlus,
  messages: Inbox,
  schedule: CalendarDays,
  members: Users,
  money: Coins,
  campaign: Megaphone,
};

type State = { items: BriefItem[]; message?: string; at: number };

export function DailyBrief({ tenantId }: { tenantId: number }) {
  const storeKey = `cf_priorities_${tenantId}`;
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(force = false) {
    setLoading(true);
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(storeKey) ?? "null") as State | null;
        if (cached && Date.now() - cached.at < TTL_MS && Array.isArray(cached.items)) {
          setState(cached);
          setLoading(false);
          return;
        }
      } catch {
        /* storage blocked or stale shape */
      }
    }
    let next: State = { items: [], at: Date.now() };
    try {
      const res = await fetch("/api/assistant/brief", { cache: "no-store" });
      const data = (await res.json()) as { items?: BriefItem[]; message?: string };
      next = { items: Array.isArray(data.items) ? data.items : [], message: data.message, at: Date.now() };
      try {
        sessionStorage.setItem(storeKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    } catch {
      /* network: show the quiet line */
    }
    setState(next);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const time = state ? new Date(state.at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <section className="prio" aria-label="Today's priorities" aria-busy={loading}>
      <div className="prio-head">
        <h2 className="prio-title">Today&rsquo;s priorities</h2>
        <button type="button" className="prio-refresh" onClick={() => load(true)} disabled={loading} aria-label="Refresh priorities">
          {loading ? "Updating" : `Updated ${time}`}
          <RefreshCw size={12} className={loading ? "spin" : undefined} />
        </button>
      </div>

      {loading ? (
        <div className="prio-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="prio-card prio-card--ghost" aria-hidden>
              <span className="prio-ghost prio-ghost--icon" />
              <span className="prio-ghost" style={{ width: "62%" }} />
              <span className="prio-ghost" style={{ width: "84%", height: 10 }} />
            </div>
          ))}
        </div>
      ) : state?.message ? (
        <p className="prio-quiet">{state.message}</p>
      ) : !state?.items.length ? (
        <p className="prio-quiet">Nothing urgent today.</p>
      ) : (
        <div className="prio-grid">
          {state.items.map((item, i) => {
            const Icon = ICON[item.kind] ?? Megaphone;
            return (
              <Link key={item.kind} href={item.href} className="prio-card" style={{ animationDelay: `${i * 70}ms` }}>
                <span className="prio-icon">
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                <span className="prio-card-title">{item.title}</span>
                {item.detail && <span className="prio-card-detail">{item.detail}</span>}
                <span className="prio-action">
                  {item.action} <ArrowRight size={13} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
