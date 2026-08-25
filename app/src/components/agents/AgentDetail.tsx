"use client";

import { type ReactNode, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, CircleCheck, Cpu, Gauge, Lock } from "lucide-react";

import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { formatEur } from "@/lib/utils";
import type { Agent } from "@/lib/db/schema";
import { MODEL_CATALOG, isCatalogModel, type ModelChoice } from "@/lib/ai/modelCatalog";
import { groupToolsByCategory } from "@/lib/agents/toolCategories";
import { saveModel, saveDisabledTools } from "@/app/agents/actions";
import { AgentContextEditor } from "./AgentContextEditor";
import { AgentChatPanel } from "./AgentChatPanel";

interface Layers {
  base: string;
  businessContext: string;
  operator: string;
  rails: string;
}

interface Props {
  agent: Agent;
  /** The catalog entry's one-line mandate (@/lib/agents/registry's AGENT_CATALOG) — shown as the lead line atop the Roles section below. Undefined only if this agent key somehow isn't in the catalog. */
  mandate?: string;
  /** The catalog entry's plain-English responsibilities (AGENT_CATALOG's `roles`) — rendered as the "Roles — what this agent handles" section, complementary to ToolsCard's concrete tool names below. Empty/undefined omits the section entirely rather than rendering an empty box. */
  roles?: string[];
  layers: Layers;
  toolNames: readonly string[];
  /** The agent's OFF list (tool names it may not use) — parsed from agents.disabled_tools in page.tsx via parseDisabledTools. Seeds the tool-access toggles; empty = every tool on. */
  disabledTools: string[];
  usageCents: number;
  capCents: number;
  tenantId: number;
  /** Whether `OPENROUTER_API_KEY` is set — computed server-side (page.tsx) and passed down so a client component never has to guess at env state. Gates the DeepSeek/OpenRouter option in the model picker below. */
  openRouterConfigured: boolean;
  /** Campaign Engine Slice 3: see AssistantChat's `initialInput` doc — threaded straight through to the chat panel. */
  initialInput?: string;
  /** Voice T2: see AssistantChat's `voiceEnabled` doc — computed server-side (page.tsx) via `transcribeConfigured()`, same threading pattern as `openRouterConfigured` above, threaded straight through to the chat panel. */
  voiceEnabled: boolean;
}

/**
 * The Agent detail page body: a Model/Tools/Usage control row, the 4-layer
 * Context panel (in composition order, matching how
 * `composeAgentSystem` — @/lib/agents/context — actually concatenates them
 * for a live run), and the agent's working chat (or a dormant placeholder).
 */
export function AgentDetail({ agent, mandate, roles, layers, toolNames, disabledTools, usageCents, capCents, tenantId, openRouterConfigured, initialInput, voiceEnabled }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <RevealGroup style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <Reveal>
          <ModelCard agent={agent} openRouterConfigured={openRouterConfigured} />
        </Reveal>
        <Reveal>
          <UsageCard usageCents={usageCents} capCents={capCents} />
        </Reveal>
      </RevealGroup>

      <Reveal>
        <ToolAccessSection agentKey={agent.key} toolNames={toolNames} disabledTools={disabledTools} />
      </Reveal>

      <RolesSection mandate={mandate} roles={roles} dormant={agent.status === "dormant"} />

      <Reveal>
        <section>
          <SectionLabel>Context — what this agent knows, in order</SectionLabel>
          <div>
            <LockedLayer index={1} title="Base playbook" text={layers.base} />
            <Connector />
            <LockedLayer index={2} title="Business context" text={layers.businessContext} />
            <Connector />
            <EditableLayer index={3} agentKey={agent.key} initial={layers.operator} />
            <Connector />
            <LockedLayer index={4} title="Safety rails" text={layers.rails} />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section>
          <SectionLabel>{agent.status === "active" ? "Working chat" : "Chat"}</SectionLabel>
          <AgentChatPanel agent={agent} tenantId={tenantId} initialInput={initialInput} voiceEnabled={voiceEnabled} />
        </section>
      </Reveal>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

/**
 * "Roles — what this agent handles": the plain-English responsibilities from
 * AGENT_CATALOG (@/lib/agents/registry), one level up from ToolsCard's
 * concrete tool names — what the agent is FOR, not what it can literally
 * call. Self-contained (owns its own <Reveal>, like ModelCard/ToolsCard/
 * UsageCard own their <Card>) so the call site can render it unconditionally
 * and this component decides whether there's anything worth showing —
 * mirrors ToolsCard's own empty-state handling, except here "empty" means
 * omit the whole section rather than show a placeholder, per spec.
 */
function RolesSection({ mandate, roles, dormant }: { mandate?: string; roles?: string[]; dormant: boolean }) {
  if (!roles || roles.length === 0) return null;
  return (
    <Reveal>
      <section>
        <SectionLabel>Roles — what this agent handles</SectionLabel>
        <Card>
          {mandate && (
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-primary)", fontWeight: 500, margin: "0 0 16px" }}>
              {mandate}
            </p>
          )}
          {dormant && (
            <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--text-tertiary)", marginBottom: 16 }}>
              Not currently running
            </div>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            {roles.map((role) => (
              <li
                key={role}
                style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}
              >
                <CircleCheck size={14} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 2, color: "var(--accent)" }} aria-hidden />
                <span>{role}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </Reveal>
  );
}

/** Purely decorative — signals "these concatenate" between stacked layer cards. */
function Connector() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "4px 0", color: "var(--text-tertiary)" }} aria-hidden>
      <ChevronDown size={16} strokeWidth={1.5} />
    </div>
  );
}

function LockedLayer({ index, title, text }: { index: number; title: string; text: string }) {
  return (
    <Card style={{ background: "var(--surface-2)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <CardLabel>
          {index} · {title}
        </CardLabel>
        <Badge style={{ background: "var(--surface-1)", color: "var(--text-tertiary)" }}>
          <Lock size={10} strokeWidth={2} /> Locked
        </Badge>
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {text.trim() ? text.trim() : <em style={{ color: "var(--text-tertiary)" }}>(empty)</em>}
      </div>
    </Card>
  );
}

function EditableLayer({ index, agentKey, initial }: { index: number; agentKey: string; initial: string }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <CardLabel>{index} · Operator instructions</CardLabel>
        <Badge tone="amber">Editable</Badge>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: "0 0 12px", lineHeight: 1.5 }}>
        Extra guidance layered on top of the base playbook and business context — tone, priorities, things to always or
        never do. This is the only layer you can edit; it's still bound by the safety rails below.
      </p>
      <AgentContextEditor agentKey={agentKey} initial={initial} />
    </Card>
  );
}

function ModelCard({ agent, openRouterConfigured }: { agent: Agent; openRouterConfigured: boolean }) {
  const [model, setModel] = useState(agent.model);
  const [pending, startTransition] = useTransition();

  function pick(choice: ModelChoice) {
    if (pending || choice.id === model) return;
    if (choice.needsOpenRouter && !openRouterConfigured) return; // locked — the button below is also `disabled`, this is just belt-and-suspenders
    const prev = model;
    setModel(choice.id); // optimistic
    startTransition(async () => {
      try {
        await saveModel(agent.key, choice.id);
        toast.success(`Model switched to ${choice.label}.`);
      } catch (err) {
        setModel(prev); // revert — saveModel/updateAgentModel rejected it
        toast.error(err instanceof Error ? err.message : "Could not switch model.");
      }
    });
  }

  const known = isCatalogModel(model);

  return (
    <Card>
      <CardLabel>
        <Cpu size={11} style={{ display: "inline", verticalAlign: -1, marginRight: 6 }} />
        Model
      </CardLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {MODEL_CATALOG.map((choice) => {
          const selected = model === choice.id;
          const locked = Boolean(choice.needsOpenRouter) && !openRouterConfigured;
          return (
            <button
              key={choice.id}
              type="button"
              onClick={() => pick(choice)}
              disabled={pending || locked}
              title={locked ? "Requires additional setup" : undefined}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: "var(--radius)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--hairline)"}`,
                background: selected ? "var(--accent-soft)" : "transparent",
                cursor: pending || locked ? "default" : "pointer",
                opacity: locked ? 0.55 : 1,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: selected ? "var(--accent-ink)" : "var(--text-primary)" }}>
                  {choice.label}
                </span>
                {choice.provider === "openrouter" && locked && (
                  <Badge tone="amber">
                    <Lock size={9} strokeWidth={2} /> Needs setup
                  </Badge>
                )}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.4 }}>{choice.note}</span>
            </button>
          );
        })}
      </div>
      {!known && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        >
          Current: {model}
        </div>
      )}
    </Card>
  );
}

/** A small on/off switch. Knob colour flips by state so it stays visible on
 *  both the accent (on) and surface-3 (off) tracks in light AND dark themes —
 *  `--accent-contrast` is the theme-aware ink-on-accent, `--text-secondary`
 *  reads on the muted off-track either way. */
function Toggle({ on, onToggle, pending, label }: { on: boolean; onToggle: () => void; pending: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      disabled={pending}
      style={{
        width: 38,
        height: 22,
        borderRadius: 999,
        background: on ? "var(--accent)" : "var(--surface-3)",
        border: "1px solid var(--hairline)",
        position: "relative",
        cursor: pending ? "default" : "pointer",
        flexShrink: 0,
        padding: 0,
        transition: "background 0.15s var(--ease)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 2,
          left: on ? 17 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: on ? "var(--accent-contrast)" : "var(--text-secondary)",
          transition: "left 0.15s var(--ease)",
        }}
      />
    </button>
  );
}

/**
 * Tool access — a full-width section (not a 1/3 control-row card: 50-odd tools
 * in 10 categories need the room) letting an admin switch each of the agent's
 * tools on or off, grouped by category (@/lib/agents/toolCategories). A tool
 * switched OFF is dropped from the agent's toolkit in the chat route
 * (@/api/agents/[key]/chat) — it can't call it and never sees it. Optimistic,
 * mirroring ModelCard: local state updates immediately, the whole disabled set
 * is persisted via `saveDisabledTools`, and a rejected save reverts + toasts.
 * We store the DISABLED (off) set, so an unchanged tool stays on by default.
 */
function ToolAccessSection({ agentKey, toolNames, disabledTools }: { agentKey: string; toolNames: readonly string[]; disabledTools: string[] }) {
  const [disabled, setDisabled] = useState<Set<string>>(() => new Set(disabledTools));
  const [pending, startTransition] = useTransition();
  const groups = useMemo(() => groupToolsByCategory(toolNames), [toolNames]);
  const enabledCount = toolNames.filter((t) => !disabled.has(t)).length;

  function persist(next: Set<string>) {
    const prev = disabled;
    setDisabled(next); // optimistic
    startTransition(async () => {
      try {
        await saveDisabledTools(agentKey, [...next]);
      } catch (err) {
        setDisabled(prev); // revert — the server rejected it
        toast.error(err instanceof Error ? err.message : "Could not update tool access.");
      }
    });
  }
  function toggleTool(t: string) {
    const next = new Set(disabled);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    persist(next);
  }
  function setCategory(tools: string[], enableAll: boolean) {
    const next = new Set(disabled);
    for (const t of tools) {
      if (enableAll) next.delete(t);
      else next.add(t);
    }
    persist(next);
  }

  if (toolNames.length === 0) {
    return (
      <section>
        <SectionLabel>Tools — what this agent can use</SectionLabel>
        <Card>
          <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", fontStyle: "italic", margin: 0 }}>
            No tools yet — this agent isn&apos;t running.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel>Tools — what this agent can use</SectionLabel>
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5, maxWidth: 620 }}>
            Turn individual tools on or off. A tool switched off is removed from the agent&apos;s toolkit entirely — it can&apos;t use it and won&apos;t know it exists. Sends and other changes still need your approval regardless.
          </p>
          <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
            {enabledCount} / {toolNames.length} on
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {groups.map((g) => {
            const total = g.tools.length;
            const on = g.tools.filter((t) => !disabled.has(t)).length;
            const allOn = on === total;
            return (
              <div
                key={g.key}
                style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 12, background: "var(--surface-2)" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{g.label}</div>
                    <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 2 }}>
                      {on}/{total} on
                    </div>
                  </div>
                  <Toggle
                    on={allOn}
                    pending={pending}
                    label={`Turn all ${g.label} tools ${allOn ? "off" : "on"}`}
                    onToggle={() => setCategory(g.tools, !allOn)}
                  />
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  {g.tools.map((t) => {
                    const isOn = !disabled.has(t);
                    return (
                      <li key={t} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: "1px solid var(--hairline)" }}>
                        <span
                          style={{
                            fontSize: 12.5,
                            color: isOn ? "var(--text-secondary)" : "var(--text-tertiary)",
                            textTransform: "capitalize",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t.replace(/_/g, " ")}
                        </span>
                        <Toggle
                          on={isOn}
                          pending={pending}
                          label={`${isOn ? "Disable" : "Enable"} ${t.replace(/_/g, " ")}`}
                          onToggle={() => toggleTool(t)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}

function UsageCard({ usageCents, capCents }: { usageCents: number; capCents: number }) {
  const pct = capCents > 0 ? Math.min(100, (usageCents / capCents) * 100) : 0;
  return (
    <Card>
      <CardLabel>
        <Gauge size={11} style={{ display: "inline", verticalAlign: -1, marginRight: 6 }} />
        This agent — this month
      </CardLabel>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden", marginBottom: 8 }}
      >
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "var(--accent)" }} />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 12,
          color: "var(--text-tertiary)",
        }}
      >
        <span>{formatEur(usageCents / 100)}</span>
        <span>/ {formatEur(capCents / 100)}</span>
      </div>
    </Card>
  );
}
