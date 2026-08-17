"use client";

import { Sparkles, MessageCircle } from "lucide-react";
import type { LeadWithSla } from "@/lib/leads";
import { Badge } from "@/components/ui/Badge";
import { slaTone, isStale } from "@/lib/pipeline/boardMetrics";
import { initialsOf } from "@/lib/utils";

export interface LeadCardProps {
  lead: LeadWithSla;
  now: number;
  onDraft: (id: number) => void;
  onWhatsApp: (id: number) => void;
}

const SLA_HEX = { neutral: "var(--text-tertiary)", amber: "#d29922", red: "#dc2626" } as const;

function waitLabel(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `waiting ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `waiting ${h}h`;
  return `waiting ${Math.floor(h / 24)}d`;
}

/**
 * Presentational board card. Stage is conveyed by the column, so no StageChip
 * here — instead a speed-to-lead timer (uncontacted leads only) + a staleness
 * dot. Quick actions deep-link into the lead; they never send from the board.
 */
export function LeadCard({ lead, now, onDraft, onWhatsApp }: LeadCardProps) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Anonymous";
  const initials = initialsOf(lead.firstName ?? "?", lead.lastName ?? "") || "??";
  const role = lead.stage?.role ?? null;

  const waitingMs = lead.firstOutboundAt == null ? now - lead.createdAt.getTime() : null;
  const tone = waitingMs != null ? slaTone(waitingMs) : null;

  const msInStage = now - lead.updatedAt.getTime();
  const stale = isStale(msInStage, role);
  const staleDays = Math.floor(msInStage / 86_400_000);

  return (
    <div
      style={{
        background: "var(--surface-2, var(--surface-1))",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: "var(--shadow-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            flex: "0 0 auto",
          }}
        >
          {initials}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lead.email ?? lead.phone ?? "—"}
          </span>
        </span>
        {stale && (
          <span
            title={`${staleDays}d in ${lead.stage?.name ?? ""}`}
            style={{ width: 7, height: 7, borderRadius: "50%", background: "#d29922", flex: "0 0 auto" }}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {lead.therapyInterest && <Badge>{lead.therapyInterest}</Badge>}
        {lead.campaign && <Badge>{lead.campaign}</Badge>}
        <Badge tone="neutral">{lead.source}</Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {tone && (
          <span style={{ fontSize: 11, fontWeight: 600, color: SLA_HEX[tone] }}>
            {waitLabel(waitingMs!)}
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          <button
            type="button"
            title="AI draft"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDraft(lead.id);
            }}
            style={iconBtn}
          >
            <Sparkles size={14} />
          </button>
          {lead.phone && (
            <button
              type="button"
              title="WhatsApp"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onWhatsApp(lead.id);
              }}
              style={iconBtn}
            >
              <MessageCircle size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
