"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";

import type { BriefItem } from "@/lib/dashboard/briefItems";

/**
 * Needs you: up to three action rows the AI picks from live data
 * (/api/assistant/brief), each one line plus a button to the page that does
 * the job. Cached for ten minutes per tab so dashboard reloads don't re-ask.
 * A quiet day is one short line, not filler.
 */

const TTL_MS = 10 * 60 * 1000;
type State = { items: BriefItem[]; message?: string; at: number };

export function DailyBrief({ tenantId, bare = false }: { tenantId: number; bare?: boolean }) {
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

  const body = loading ? (
    <div aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="needs-row">
          <span className="needs-dot needs-dot--ghost" />
          <span className="prio-ghost" style={{ width: i ? "48%" : "64%" }} />
        </div>
      ))}
    </div>
  ) : state?.message ? (
    <p className="needs-quiet">{state.message}</p>
  ) : !state?.items.length ? (
    <p className="needs-quiet">Nothing needs you right now.</p>
  ) : (
    <div>
      {state.items.map((item) => (
        <Link key={item.kind} href={item.href} className="needs-row">
          <span className="needs-dot" />
          <span className="needs-text">
            <span className="needs-title">{item.title}</span>
            {item.detail && <span className="needs-detail">{item.detail}</span>}
          </span>
          <span className="needs-action">
            {item.action} <ArrowRight size={14} />
          </span>
        </Link>
      ))}
    </div>
  );

  const refresh = (
    <button type="button" className="prio-refresh" onClick={() => load(true)} disabled={loading} aria-label="Refresh">
      {loading ? "Updating" : `Updated ${time}`}
      <RefreshCw size={12} className={loading ? "spin" : undefined} />
    </button>
  );

  // Inside a dashboard tile the tile header already says "Needs you".
  if (bare) {
    return (
      <div aria-busy={loading}>
        {body}
        <div className="needs-foot">{refresh}</div>
      </div>
    );
  }
  return (
    <section className="needs-card" aria-label="Needs you" aria-busy={loading}>
      <div className="needs-head">
        <h2 className="needs-heading">Needs you</h2>
        {refresh}
      </div>
      {body}
    </section>
  );
}
