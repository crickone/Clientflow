"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
function heading(): string {
  const d = new Date();
  const h = d.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part} — ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function DailyBrief({ tenantId }: { tenantId: number }) {
  const storeKey = `cf_brief_${tenantId}`;
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(force = false) {
    setLoading(true);
    if (!force) {
      try {
        const raw = sessionStorage.getItem(storeKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { day: string; brief: string };
          if (parsed.day === todayKey()) {
            setBrief(parsed.brief);
            setLoading(false);
            return;
          }
        }
      } catch {
        /* ignore */
      }
    }
    try {
      const res = await fetch("/api/assistant/brief", { cache: "no-store" });
      const data = (await res.json()) as { brief?: string };
      const b = data.brief ?? "";
      setBrief(b);
      try {
        sessionStorage.setItem(storeKey, JSON.stringify({ day: todayKey(), brief: b }));
      } catch {
        /* ignore */
      }
    } catch {
      setBrief("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Nothing to show (AI off / no data) — hide entirely.
  if (!loading && !brief) return null;

  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        background: "linear-gradient(180deg, var(--surface-2), var(--surface-1))",
        padding: "16px 18px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Sparkles size={15} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
        <strong style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{heading()}</strong>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>· your brief</span>
        <button
          onClick={() => load(true)}
          disabled={loading}
          title="Refresh brief"
          style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", display: "inline-flex", padding: 2 }}
        >
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
        </button>
      </div>
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[92, 78, 85].map((w, i) => (
            <div key={i} style={{ height: 11, width: `${w}%`, borderRadius: 6, background: "var(--surface-2)", opacity: 0.7 }} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(brief ?? "").split("\n").map((line, i) => {
            const t = line.trim().replace(/^[-*•]\s*/, "");
            if (!t) return null;
            return (
              <div key={i} style={{ display: "flex", gap: 8, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>
                <span>{renderBold(t)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function renderBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
    /^\*\*[^*]+\*\*$/.test(seg) ? (
      <strong key={i} style={{ color: "var(--text-primary)" }}>{seg.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{seg}</span>
    ),
  );
}
