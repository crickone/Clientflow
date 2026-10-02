/**
 * Sales preset pure helpers (no DB, no server imports; tested in
 * sales.test.ts). The loaders live in salesQueries.ts.
 */
import { bucketIndex, pct, type Bucket } from "./stats";

// ---------- pure helpers ----------

export type ConversionRow = { label: string; won: number; total: number; pct: number };

/** Group leads, keep groups of at least `minSize`, sorted by conversion % desc then size. */
export function conversionByGroup(leads: { group: string | null; won: boolean }[], minSize = 3): ConversionRow[] {
  const g = new Map<string, { won: number; total: number }>();
  for (const l of leads) {
    const k = l.group && l.group.trim() ? l.group.trim() : "Not stated";
    const e = g.get(k) ?? { won: 0, total: 0 };
    e.total++;
    if (l.won) e.won++;
    g.set(k, e);
  }
  return [...g.entries()]
    .filter(([, v]) => v.total >= minSize)
    .map(([label, v]) => ({ label, won: v.won, total: v.total, pct: pct(v.won, v.total) ?? 0 }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total);
}

/** Largest `n` rows by value, the rest summed into "Other". */
export function topNWithOther(rows: { label: string; value: number }[], n: number): { label: string; value: number }[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  if (sorted.length <= n) return sorted;
  const rest = sorted.slice(n).reduce((s, r) => s + r.value, 0);
  return [...sorted.slice(0, n), { label: "Other", value: rest }];
}

/** "Therapies" -> "therapy", "Classes" -> "class", "Sessions" -> "session". */
export function singular(word: string): string {
  const w = word.toLowerCase();
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(s|x|ch|sh)es$/.test(w)) return w.replace(/es$/, "");
  return w.replace(/s$/, "");
}

/**
 * Won/lost counts per bucket from stage events. Consistent with the won tile:
 * a move that starts in a won stage (won to repeat) is not a new win, and each
 * lead counts at most once per bucket per series.
 */
export function wonLostCounts(
  events: { leadId: number; fromStageId: number | null; toStageId: number; atMs: number }[],
  wonIds: Set<number>,
  lostIds: Set<number>,
  buckets: Bucket[],
): { label: string; Won: number; Lost: number }[] {
  const out = buckets.map((b) => ({ label: b.label, Won: 0, Lost: 0 }));
  const seen = buckets.map(() => ({ won: new Set<number>(), lost: new Set<number>() }));
  for (const e of events) {
    const i = bucketIndex(buckets, e.atMs);
    if (i < 0) continue;
    if (wonIds.has(e.toStageId)) {
      if (e.fromStageId != null && wonIds.has(e.fromStageId)) continue;
      if (!seen[i].won.has(e.leadId)) {
        seen[i].won.add(e.leadId);
        out[i].Won++;
      }
    } else if (lostIds.has(e.toStageId)) {
      if (!seen[i].lost.has(e.leadId)) {
        seen[i].lost.add(e.leadId);
        out[i].Lost++;
      }
    }
  }
  return out;
}
