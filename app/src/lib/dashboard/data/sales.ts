/**
 * Sales preset pure helpers (no DB, no server imports; tested in
 * sales.test.ts). The loaders live in salesQueries.ts.
 */
import { pct } from "./stats";

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
