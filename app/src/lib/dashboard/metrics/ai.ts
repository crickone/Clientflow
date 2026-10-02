/**
 * AI & Usage preset pure helpers (no DB, no server imports; tested in
 * ai.test.ts). Spend is `ai_usage.cost_cents` (REAL, fractional cents); round
 * only for display. The loaders live in aiQueries.ts.
 */
import { addDaysIso, dublinIso } from "./stats";

const AGENT_LABELS: Record<string, string> = {
  orchestrator: "Adonis",
  carousel: "Post design",
  blog: "Blog",
  triage: "Inbox triage",
  brief: "Daily brief",
  video: "Video",
  transcribe: "Transcription",
};

/** Human label for an ai_usage agent key; unknown keys are title-cased. */
export function agentLabel(key: string): string {
  const known = AGENT_LABELS[key];
  if (known) return known;
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** A model id trimmed for display: provider prefix, vendor path, "claude-" and a date suffix dropped. */
export function shortModel(model: string): string {
  let m = model.slice(model.lastIndexOf(":") + 1);
  const parts = m.split("/").filter(Boolean);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    m = /^v\d/.test(last) ? parts[parts.length - 2] : last;
  }
  return m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export type MediaKind = "Images" | "Video" | "Transcription";

/** Which media bucket a usage row belongs to, or null for plain text-model spend. */
export function mediaKind(model: string, agent: string): MediaKind | null {
  const m = model.toLowerCase();
  if (agent === "video" || m.includes("kling") || m.includes("runway")) return "Video";
  if (agent === "transcribe") return "Transcription";
  if (m.startsWith("fal:") || m.startsWith("openai:gpt-image")) return "Images";
  return null;
}

export type UsageRow = { agent: string; model: string; cents: number };

/** Media spend per kind (cents), largest first; text-model rows are ignored. */
export function mediaBreakdown(rows: UsageRow[]): { label: string; value: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const k = mediaKind(r.model, r.agent);
    if (k) by.set(k, (by.get(k) ?? 0) + r.cents);
  }
  return [...by].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Month-end spend (cents) at the current pace: spent / elapsed Dublin days * days in the month. */
export function projectedMonthEnd(spentCents: number, nowMs: number): number {
  const [y, mo, d] = dublinIso(nowMs).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return (spentCents / d) * daysInMonth;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * One entry per day of the ledger month `yyyymm`, spend summed per Dublin
 * day. A row whose Dublin day falls outside that month (the ledger buckets by
 * UTC month) is clamped onto the nearest edge day.
 */
export function dailySpendSeries(rows: { ms: number; cents: number }[], yyyymm: string): { day: string; label: string; cents: number }[] {
  const [y, mo] = yyyymm.split("-").map(Number);
  const first = `${yyyymm}-01`;
  const count = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const last = addDaysIso(first, count - 1);
  const totals = new Map<string, number>();
  for (const r of rows) {
    let day = dublinIso(r.ms);
    if (day < first) day = first;
    if (day > last) day = last;
    totals.set(day, (totals.get(day) ?? 0) + r.cents);
  }
  return Array.from({ length: count }, (_, i) => {
    const day = addDaysIso(first, i);
    return { day, label: `${i + 1} ${MONTHS[mo - 1]}`, cents: totals.get(day) ?? 0 };
  });
}

/** Top (feature, model) pairs by spend: label = feature, sub = short model. */
export function topPairs(rows: UsageRow[], limit: number): { label: string; sub: string; value: number }[] {
  const by = new Map<string, { label: string; sub: string; value: number }>();
  for (const r of rows) {
    const k = `${r.agent}\u0000${r.model}`;
    const cur = by.get(k) ?? { label: agentLabel(r.agent), sub: shortModel(r.model), value: 0 };
    cur.value += r.cents;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)).slice(0, limit);
}
