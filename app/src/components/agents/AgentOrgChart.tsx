"use client";

import { type CSSProperties } from "react";
import Link from "next/link";
import {
  Bot,
  ClipboardCheck,
  Handshake,
  Megaphone,
  Wallet,
  Workflow,
} from "lucide-react";

import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Reveal } from "@/components/motion/Reveal";
import { formatEur } from "@/lib/utils";
import type { Agent } from "@/lib/db/schema";
import { modelLabel } from "@/lib/ai/modelCatalog";

interface Props {
  agents: Agent[];
  usageByAgent: Record<string, number>;
  usageByModel: { model: string; cents: number }[];
  capCents: number;
  monthCents: number;
}

/**
 * Display copy for the org chart. Mirrors AGENT_CATALOG's `mandate` field in
 * `@/lib/agents/registry` — duplicated (not imported) because that module is
 * `server-only` (DB access) and this component runs on the client.
 */
const MANDATE: Record<string, string> = {
  orchestrator: "Routes work to the right specialist.",
  sales: "Works leads: instant replies + relentless follow-up.",
  marketing: "Runs the Marketing Brain: campaigns + social.",
  operations: "No-shows, class fill, attendance, admin.",
  finance: "Guards the cash: overdue + failed payments.",
};

/** Per-agent icon — purely presentational, keyed by agent key. */
const ICON: Record<string, typeof Bot> = {
  orchestrator: Workflow,
  sales: Handshake,
  marketing: Megaphone,
  operations: ClipboardCheck,
  finance: Wallet,
};

/**
 * The "AI staff org chart": one Orchestrator node on top, five specialist
 * nodes below it in a responsive grid, connected by SVG lines so the whole
 * thing reads as a hierarchy rather than a list or table.
 */
export function AgentOrgChart({ agents, usageByAgent, usageByModel, capCents, monthCents }: Props) {
  const orchestrator = agents.find((a) => a.key === "orchestrator");
  const specialists = agents.filter((a) => a.key !== "orchestrator");

  return (
    <div>
      <Card style={{ marginBottom: 40 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <CardLabel style={{ marginBottom: 8 }}>All AI usage — this month</CardLabel>
            <div
              style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: 26,
                color: "var(--text-primary)",
                textTransform: "uppercase",
              }}
            >
              {formatEur(monthCents / 100)}{" "}
              <span
                style={{
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  fontSize: 13,
                  color: "var(--text-tertiary)",
                  textTransform: "none",
                }}
              >
                / {formatEur(capCents / 100)} cap
              </span>
            </div>
          </div>
          <div style={{ flex: "1 1 240px", maxWidth: 380 }}>
            <UsageMeter valueCents={monthCents} capCents={capCents} />
          </div>
        </div>

        {usageByModel.length > 0 && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--hairline)" }}>
            <div
              style={{
                fontFamily: "var(--font-mono), ui-monospace, monospace",
                fontSize: 10.5,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
                marginBottom: 10,
              }}
            >
              By model
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {usageByModel.map((row) => {
                const pct = monthCents > 0 ? Math.min(100, (row.cents / monthCents) * 100) : 0;
                return (
                  <div key={row.model}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 12.5,
                        color: "var(--text-secondary)",
                        marginBottom: 4,
                      }}
                    >
                      <span>{modelLabel(row.model)}</span>
                      <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", color: "var(--text-tertiary)" }}>
                        {formatEur(row.cents / 100)}
                      </span>
                    </div>
                    <div style={{ height: 3, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "var(--accent)" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <div className="agent-orgchart">
        {orchestrator && (
          <AgentCard
            agent={orchestrator}
            usageCents={usageByAgent[orchestrator.key] ?? 0}
            capCents={capCents}
            variant="orchestrator"
          />
        )}

        {/* Decorative connectors: a fan-out SVG at wide viewports (synced to
            the fixed 5-column grid below), collapsing to a single trunk line
            once the grid reflows and per-card x-positions are no longer
            known. Either way it sits behind the cards (z-index 0). */}
        <div className="agent-orgchart-links" aria-hidden="true">
          <svg
            className="agent-orgchart-svg"
            viewBox="0 0 100 48"
            preserveAspectRatio="none"
          >
            {specialists.map((s, i) => {
              const x = ((i + 0.5) / specialists.length) * 100;
              return (
                <path
                  key={s.key}
                  d={`M 50 0 C 50 24, ${x} 20, ${x} 48`}
                  fill="none"
                  stroke="var(--hairline)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          <div className="agent-orgchart-trunk" />
        </div>

        <div className="agent-orgchart-grid" style={{ "--cols": specialists.length } as CSSProperties}>
          {/* Each specialist card is a STANDALONE Reveal (fades/rises on
              scroll-into-view; ones already in view appear on load). Do NOT
              wrap these in a <RevealGroup style={{display:"contents"}}> — a
              display:contents element generates no box, so RevealGroup's
              whileInView IntersectionObserver never fires and every child
              stays hidden (opacity 0). That's the bug this replaces. */}
          {specialists.map((agent) => (
            <Reveal key={agent.key}>
              <AgentCard
                agent={agent}
                usageCents={usageByAgent[agent.key] ?? 0}
                capCents={capCents}
                variant="specialist"
              />
            </Reveal>
          ))}
        </div>
      </div>

      <style jsx>{`
        .agent-orgchart {
          position: relative;
        }
        .agent-orgchart-links {
          position: relative;
          height: 48px;
        }
        .agent-orgchart-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
          display: none;
        }
        .agent-orgchart-trunk {
          position: absolute;
          left: 50%;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--hairline);
          transform: translateX(-50%);
        }
        .agent-orgchart-grid {
          position: relative;
          z-index: 1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }
        @media (min-width: 1300px) {
          .agent-orgchart-svg {
            display: block;
          }
          .agent-orgchart-trunk {
            display: none;
          }
          .agent-orgchart-grid {
            grid-template-columns: repeat(var(--cols, 5), 1fr);
          }
        }
      `}</style>
    </div>
  );
}

function AgentCard({
  agent,
  usageCents,
  capCents,
  variant,
}: {
  agent: Agent;
  usageCents: number;
  capCents: number;
  variant: "orchestrator" | "specialist";
}) {
  const active = agent.status === "active";
  const Icon = ICON[agent.key] ?? Bot;
  const isOrchestrator = variant === "orchestrator";
  const mandate = MANDATE[agent.key] || agent.instructions || "AI specialist.";

  return (
    <Link
      href={`/agents/${agent.key}`}
      style={
        isOrchestrator
          ? {
              display: "block",
              width: "min(360px, 100%)",
              margin: "0 auto",
              textDecoration: "none",
              color: "inherit",
            }
          : { display: "block", height: "100%", textDecoration: "none", color: "inherit" }
      }
    >
      <Card
        interactive
        style={{
          borderColor: isOrchestrator ? "var(--hairline-strong)" : undefined,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "var(--radius)",
                background: active ? "var(--accent-soft)" : "var(--surface-2)",
                color: active ? "var(--accent-ink)" : "var(--text-secondary)",
                flexShrink: 0,
              }}
            >
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <span
              style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: isOrchestrator ? 19 : 16,
                color: "var(--text-primary)",
                textTransform: "uppercase",
                letterSpacing: "-0.005em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agent.name}
            </span>
          </div>
          <StatusPill active={active} />
        </div>

        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.5,
            margin: "0 0 12px",
          }}
        >
          {mandate}
        </p>

        {!active && (
          <div
            style={{
              fontSize: 11,
              fontStyle: "italic",
              color: "var(--text-tertiary)",
              marginBottom: 12,
            }}
          >
            Not yet running
          </div>
        )}

        <div style={{ marginTop: "auto", marginBottom: 10 }}>
          <Badge>{modelLabel(agent.model)}</Badge>
        </div>

        <UsageMeter valueCents={usageCents} capCents={capCents} compact />
      </Card>
    </Link>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 9px",
        borderRadius: "var(--radius)",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        flexShrink: 0,
        background: active ? "var(--accent-soft)" : "var(--surface-2)",
        color: active ? "var(--accent-ink)" : "var(--text-tertiary)",
        boxShadow: active ? "var(--accent-glow)" : "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: active ? "var(--accent)" : "var(--text-tertiary)",
        }}
      />
      {active ? "Active" : "Dormant"}
    </span>
  );
}

function UsageMeter({
  valueCents,
  capCents,
  compact,
}: {
  valueCents: number;
  capCents: number;
  compact?: boolean;
}) {
  const pct = capCents > 0 ? Math.min(100, (valueCents / capCents) * 100) : 0;
  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: compact ? 4 : 6,
          borderRadius: 999,
          background: "var(--surface-2)",
          overflow: "hidden",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 999,
            background: "var(--accent)",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: compact ? 10.5 : 11,
          color: "var(--text-tertiary)",
        }}
      >
        <span>{formatEur(valueCents / 100)}</span>
        <span>/ {formatEur(capCents / 100)}</span>
      </div>
    </div>
  );
}
