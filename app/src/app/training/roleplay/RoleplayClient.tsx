"use client";

import { useState, useMemo } from "react";
import { ArrowLeft, Phone, RotateCcw, CheckCircle2, AlertCircle, XCircle, Trophy } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { RoleplayScenario, RoleplayNode, RoleplayChoice } from "@/lib/training/content";
import { useProgress } from "@/lib/training/progress";

interface Props {
  scenarios: RoleplayScenario[];
}

export function RoleplayClient({ scenarios }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = scenarios.find((s) => s.id === activeId) ?? null;

  return active ? (
    <ScenarioPlayer scenario={active} onBack={() => setActiveId(null)} />
  ) : (
    <ScenarioPicker scenarios={scenarios} onPick={setActiveId} />
  );
}

function ScenarioPicker({ scenarios, onPick }: { scenarios: RoleplayScenario[]; onPick: (id: string) => void }) {
  const { progress, hydrated } = useProgress();

  return (
    <div className="pane-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
      {scenarios.map((s) => {
        const result = hydrated ? progress.roleplays[s.id] : null;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            style={{
              textAlign: "left",
              cursor: "pointer",
              padding: 24,
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-1)",
              transition: "border-color 0.18s var(--ease)",
              fontFamily: "inherit",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <DifficultyPill d={s.difficulty} />
              {result && <ResultBadge result={result} />}
            </div>
            <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 19, textTransform: "uppercase", color: "var(--text-primary)", lineHeight: 1.15, marginBottom: 10 }}>
              {s.title}
            </div>
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>{s.setup}</p>
            <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)" }}>
              <Phone size={13} /> Start scenario
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DifficultyPill({ d }: { d: "easy" | "medium" | "hard" }) {
  const map = {
    easy: { label: "Easy", c: "rgba(22, 163, 74, 0.65)" },
    medium: { label: "Medium", c: "rgba(202, 138, 4, 0.7)" },
    hard: { label: "Hard", c: "rgba(220, 38, 38, 0.7)" },
  } as const;
  const { label, c } = map[d];
  return (
    <span style={{
      fontSize: 10.5,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      padding: "3px 10px",
      border: `1px solid ${c}`,
      color: c,
      borderRadius: "var(--radius)",
      fontWeight: 500,
    }}>
      {label}
    </span>
  );
}

function ResultBadge({ result }: { result: "success" | "partial" | "fail" }) {
  const map = {
    success: { Icon: CheckCircle2, c: "#16a34a", label: "Aced" },
    partial: { Icon: AlertCircle, c: "#ca8a04", label: "Partial" },
    fail: { Icon: XCircle, c: "#dc2626", label: "Failed" },
  } as const;
  const { Icon, c, label } = map[result];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: c, fontWeight: 500 }}>
      <Icon size={14} strokeWidth={2} />
      {label}
    </span>
  );
}

interface TranscriptEntry {
  kind: "narrator" | "caller" | "agent";
  text: string;
  tag?: "best" | "ok" | "bad";
}

function ScenarioPlayer({ scenario, onBack }: { scenario: RoleplayScenario; onBack: () => void }) {
  const [nodeId, setNodeId] = useState(scenario.start);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(() => initial(scenario));
  const { recordRoleplay } = useProgress();

  const node = scenario.nodes[nodeId] as RoleplayNode;

  function makeChoice(c: RoleplayChoice) {
    const newEntries: TranscriptEntry[] = [{ kind: "agent", text: c.text, tag: c.tag }];
    const nextNode = scenario.nodes[c.next];
    if (nextNode) {
      if (nextNode.narrator) newEntries.push({ kind: "narrator", text: nextNode.narrator });
      if (nextNode.caller) newEntries.push({ kind: "caller", text: nextNode.caller });
    }
    setTranscript((t) => [...t, ...newEntries]);
    setNodeId(c.next);
    if (nextNode?.end) {
      recordRoleplay(scenario.id, nextNode.end.result);
    }
  }

  function restart() {
    setNodeId(scenario.start);
    setTranscript(initial(scenario));
  }

  return (
    <div className="pane-stagger" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={14} /> All scenarios
        </Button>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <DifficultyPill d={scenario.difficulty} />
          <Button variant="outline" size="sm" onClick={restart}>
            <RotateCcw size={13} /> Restart
          </Button>
        </div>
      </div>

      <Card style={{ padding: 28 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500, marginBottom: 8 }}>
          Scenario
        </div>
        <h2 style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase", color: "var(--text-primary)", fontWeight: 400, marginBottom: 10 }}>
          {scenario.title}
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{scenario.setup}</p>
      </Card>

      {/* Transcript */}
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--hairline)", background: "var(--surface-1)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500 }}>
          Call transcript
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
          {transcript.map((e, i) => <TranscriptBubble key={i} entry={e} />)}
        </div>
      </Card>

      {/* Choice panel or end screen */}
      {node.end ? (
        <EndPanel result={node.end.result} feedback={node.end.feedback} onRestart={restart} onBack={onBack} />
      ) : node.choices ? (
        <Card style={{ padding: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500, marginBottom: 14 }}>
            What do you say?
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {node.choices.map((c) => (
              <button
                key={c.label}
                onClick={() => makeChoice(c)}
                style={{
                  textAlign: "left",
                  padding: "16px 18px",
                  background: "var(--bg)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 14.5,
                  color: "var(--text-primary)",
                  lineHeight: 1.55,
                  display: "flex",
                  gap: 14,
                  alignItems: "flex-start",
                  transition: "background 0.15s var(--ease), border-color 0.15s var(--ease)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--hairline-strong)"; e.currentTarget.style.background = "var(--surface-1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--hairline)"; e.currentTarget.style.background = "var(--bg)"; }}
              >
                <span style={{
                  width: 26, height: 26, flexShrink: 0,
                  borderRadius: "50%",
                  border: "1px solid var(--hairline-strong)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  marginTop: 1,
                }}>
                  {c.label}
                </span>
                <span style={{ fontStyle: "italic" }}>"{c.text}"</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function initial(scenario: RoleplayScenario): TranscriptEntry[] {
  const first = scenario.nodes[scenario.start];
  const out: TranscriptEntry[] = [];
  if (first?.narrator) out.push({ kind: "narrator", text: first.narrator });
  if (first?.caller) out.push({ kind: "caller", text: first.caller });
  return out;
}

function TranscriptBubble({ entry }: { entry: TranscriptEntry }) {
  if (entry.kind === "narrator") {
    return (
      <div style={{
        fontSize: 12.5,
        color: "var(--text-tertiary)",
        fontStyle: "italic",
        padding: "4px 0",
        textAlign: "center",
        letterSpacing: "0.02em",
      }}>
        — {entry.text} —
      </div>
    );
  }
  const isCaller = entry.kind === "caller";
  const tagColor = entry.tag === "best" ? "#16a34a" : entry.tag === "bad" ? "#dc2626" : entry.tag === "ok" ? "#ca8a04" : null;
  return (
    <div style={{ display: "flex", justifyContent: isCaller ? "flex-start" : "flex-end" }}>
      <div style={{
        maxWidth: "78%",
        padding: "12px 16px",
        background: isCaller ? "var(--surface-1)" : "var(--text-primary)",
        color: isCaller ? "var(--text-primary)" : "var(--bg)",
        borderRadius: "var(--radius-sm)",
        borderTopLeftRadius: isCaller ? 4 : "var(--radius-sm)",
        borderTopRightRadius: isCaller ? "var(--radius-sm)" : 4,
        fontSize: 14,
        lineHeight: 1.55,
        position: "relative",
      }}>
        <div style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.65, marginBottom: 4 }}>
          {isCaller ? "Caller" : "You"}
        </div>
        <div style={{ fontStyle: "italic" }}>"{entry.text}"</div>
        {tagColor && (
          <div style={{
            position: "absolute",
            top: -8,
            right: isCaller ? "auto" : -8,
            left: isCaller ? -8 : "auto",
            background: tagColor,
            color: "#fff",
            fontSize: 9.5,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: "var(--radius)",
            fontWeight: 600,
          }}>
            {entry.tag === "best" ? "Best" : entry.tag === "ok" ? "OK" : "Risky"}
          </div>
        )}
      </div>
    </div>
  );
}

function EndPanel({ result, feedback, onRestart, onBack }: { result: "success" | "partial" | "fail"; feedback: string; onRestart: () => void; onBack: () => void }) {
  const config = {
    success: { Icon: Trophy, color: "#16a34a", bg: "rgba(22, 163, 74, 0.05)", label: "Aced it" },
    partial: { Icon: AlertCircle, color: "#ca8a04", bg: "rgba(202, 138, 4, 0.05)", label: "Almost there" },
    fail: { Icon: XCircle, color: "#dc2626", bg: "rgba(220, 38, 38, 0.05)", label: "Call lost" },
  } as const;
  const c = config[result];
  return (
    <Card style={{ padding: 28, background: c.bg, borderColor: c.color }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <c.Icon size={26} color={c.color} strokeWidth={2} />
        <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase", color: c.color, fontWeight: 400 }}>
          {c.label}
        </div>
      </div>
      <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--text-primary)", marginBottom: 20 }}>{feedback}</p>
      <div style={{ display: "flex", gap: 12 }}>
        <Button variant="primary" onClick={onRestart}>
          <RotateCcw size={14} /> Run again
        </Button>
        <Button variant="outline" onClick={onBack}>
          Try a different scenario
        </Button>
      </div>
    </Card>
  );
}
