"use client";

import { useState } from "react";
import { Lightbulb, Loader2, RefreshCw, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";

export interface PostIdea {
  pillar: string;
  hook: string;
  teaches: string;
  basis: string;
  needsSource?: string;
}

/**
 * "Suggest ideas" under the topic box: in-depth post ideas across the account's
 * content pillars, each showing what it teaches and the established principle
 * it rests on — so the operator can judge an idea before committing to it.
 *
 * `needsSource` is shown deliberately: the generator is forbidden from
 * inventing citations or statistics, so where a hard number would strengthen
 * the post it says what to look up instead. That turns a fabrication risk into
 * a visible task.
 */
export function PostIdeas({ onPick }: { onPick: (hook: string) => void }) {
  const [ideas, setIdeas] = useState<PostIdea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const d = await fetch("/api/content-studio/post-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 6 }),
      }).then((r) => r.json());
      if (!d.ok) {
        setError(d.error ?? "Couldn't get ideas.");
        return;
      }
      if (!Array.isArray(d.ideas) || d.ideas.length === 0) {
        setError("No ideas came back — check the AI cap, or write your own topic.");
        return;
      }
      setIdeas(d.ideas as PostIdea[]);
    } catch {
      setError("Couldn't get ideas.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="outline" size="sm" onClick={load} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Lightbulb size={14} />}
          {busy ? "Thinking…" : ideas ? "New ideas" : "Suggest ideas"}
        </Button>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          In-depth, across your content pillars
        </span>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--danger)" }}>{error}</div>
      )}

      {ideas && ideas.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {ideas.map((idea, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(idea.hook)}
              style={{
                textAlign: "left",
                background: "var(--surface-1)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "12px 14px",
                cursor: "pointer",
                fontFamily: "inherit",
                color: "inherit",
                display: "grid",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                {idea.pillar}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>
                {idea.hook}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {idea.teaches}
              </span>
              {idea.basis && (
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  Rests on: {idea.basis}
                </span>
              )}
              {idea.needsSource && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "flex-start",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--warning)",
                    background: "var(--warning-soft)",
                    borderRadius: "var(--radius-sm)",
                    padding: "6px 9px",
                    lineHeight: 1.45,
                  }}
                >
                  <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                  Find a real source before publishing: {idea.needsSource}
                </span>
              )}
            </button>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-tertiary)" }}>
            <RefreshCw size={11} />
            Ideas are grounded in established principles. No study, journal or statistic
            is cited — anything needing a hard number says so.
          </div>
        </div>
      )}
    </div>
  );
}
