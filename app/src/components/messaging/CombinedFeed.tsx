import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";

import { Card } from "@/components/ui/Card";
import type { CombinedItem } from "@/lib/combined";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hh}:${mm}`;
}

/** Read-only merged activity feed (emails + WhatsApp), newest first. */
export function CombinedFeed({ items }: { items: CombinedItem[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          fontWeight: 600,
        }}
      >
        Recent activity
      </div>
      {items.length === 0 ? (
        <Card style={{ padding: 16, fontSize: 13, color: "var(--text-tertiary)" }}>
          Nothing yet. Connect Gmail and refresh the Email tab to see messages here.
        </Card>
      ) : (
        items.slice(0, 60).map((it) => {
          const inner = (
            <Card style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {it.unread && (
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                )}
                {it.kind === "email" ? (
                  <Mail size={13} strokeWidth={1.75} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                ) : (
                  <MessageCircle size={13} strokeWidth={1.75} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: it.unread ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.title}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-tertiary)", flexShrink: 0 }}>
                  {fmt(it.at)}
                </span>
              </div>
              <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.subtitle}
              </div>
              <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.snippet}
              </div>
            </Card>
          );
          return it.href ? (
            <Link key={it.id} href={it.href} style={{ textDecoration: "none" }}>
              {inner}
            </Link>
          ) : (
            <div key={it.id}>{inner}</div>
          );
        })
      )}
    </div>
  );
}
