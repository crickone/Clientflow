/**
 * Supersets and circuits, the next-weight suggestion, and exercise search.
 * Pure, shared by the coach's builder, the read-only preview and the
 * member's logger.
 */

// ── supersets and circuits ──

/**
 * An exercise "joined" to the one above it is done back to back with it.
 * A run of joined exercises is one group: A1, A2, A3 (a superset of two, a
 * circuit of three or more). An exercise on its own is just its letter.
 */
export function groupLabels(rows: { joined?: boolean }[]): string[] {
  const out: string[] = [];
  let letter = -1;
  let i = 0;
  while (i < rows.length) {
    let end = i;
    while (end + 1 < rows.length && rows[end + 1].joined) end++;
    letter++;
    const L = letterAt(letter);
    if (end === i) out.push(L);
    else for (let k = i; k <= end; k++) out.push(`${L}${k - i + 1}`);
    i = end + 1;
  }
  return out;
}

function letterAt(n: number): string {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return n < 26 ? A[n] : `${A[Math.floor(n / 26) - 1]}${A[n % 26]}`;
}

/** How many exercises are in the group this one belongs to (1 when on its own). */
export function groupSize(rows: { joined?: boolean }[], index: number): number {
  let start = index;
  while (start > 0 && rows[start].joined) start--;
  let end = index;
  while (end + 1 < rows.length && rows[end + 1].joined) end++;
  return end - start + 1;
}

/** Rest after a set of this exercise only if it's the last in its group; mid-group you go straight to the next one. */
export function restsAfter(rows: { joined?: boolean }[], index: number): boolean {
  return !(index + 1 < rows.length && rows[index + 1].joined);
}

/** "Superset" for two, "Circuit" for three or more. */
export function groupName(size: number): string | null {
  return size === 2 ? "Superset" : size > 2 ? "Circuit" : null;
}

// ── next weight ──

/** The rep target as a range: "8-12" -> 8..12, "10" -> 10..10, "AMRAP" -> null. */
export function repRange(text: string | null | undefined): { min: number; max: number } | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)/i);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a > 0 && b > 0 ? { min: Math.min(a, b), max: Math.max(a, b) } : null;
  }
  if (/sec|min|amrap|max|fail/i.test(text)) return null;
  const n = text.match(/^\s*(\d+)\s*(?:reps?)?\s*$/i);
  return n && Number(n[1]) > 0 ? { min: Number(n[1]), max: Number(n[1]) } : null;
}

export interface LoggedSetLike {
  weightKg: number | null;
  reps: number | null;
  done: boolean;
}

export interface NextWeight {
  weightKg: number;
  change: "up" | "same";
  reason: string;
}

/**
 * Double progression: when every set last time reached the top of the rep
 * range at the same weight, go up (2.5 kg, or 1 kg on weights under 20 kg);
 * otherwise stay at that weight and add reps. Null when last time had no
 * weights or the target isn't reps.
 */
export function nextWeight(prev: LoggedSetLike[], targetReps: string | null): NextWeight | null {
  const range = repRange(targetReps);
  const done = prev.filter((s) => s.done && s.weightKg !== null && s.weightKg > 0 && s.reps !== null);
  if (!range || done.length === 0) return null;
  const top = Math.max(...done.map((s) => s.weightKg!));
  const atTop = done.filter((s) => s.weightKg === top);
  const hitAll = atTop.length === done.length && atTop.every((s) => (s.reps ?? 0) >= range.max);
  if (hitAll) {
    const step = top < 20 ? 1 : 2.5;
    return { weightKg: Math.round((top + step) * 4) / 4, change: "up", reason: `You hit ${range.max} reps on every set at ${fmtKg(top)} last time.` };
  }
  return { weightKg: top, change: "same", reason: `Stay at ${fmtKg(top)} and aim for ${range.max} reps on every set.` };
}

function fmtKg(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} kg`;
}

// ── exercise search ──

const SHORTHAND: Record<string, string> = {
  db: "dumbbell",
  dbs: "dumbbell",
  bb: "barbell",
  kb: "kettlebell",
  kbs: "kettlebell",
  ez: "ez bar",
  bw: "bodyweight",
  ohp: "overhead press",
  rdl: "romanian deadlift",
  rdls: "romanian deadlift",
  sldl: "stiff leg deadlift",
  bss: "bulgarian split squat",
  ghr: "glute ham raise",
  hip: "hip",
  pullup: "pull up",
  pullups: "pull up",
  chinup: "chin up",
  chinups: "chin up",
  pushup: "push up",
  pushups: "push up",
  situp: "sit up",
  situps: "sit up",
  pulldown: "pull down",
  pulldowns: "pull down",
  lat: "lat",
  lats: "lat",
  tri: "tricep",
  tris: "tricep",
  bi: "bicep",
  bis: "bicep",
  delt: "deltoid",
  delts: "deltoid",
  quad: "quadricep",
  quads: "quadricep",
  ham: "hamstring",
  hams: "hamstring",
  glute: "glute",
  glutes: "glute",
  abs: "abdominal",
  calves: "calf",
  bench: "bench",
};

/** Lower case, punctuation and hyphens to spaces, shorthand expanded, plurals trimmed. */
export function searchWords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[-_/(),.+]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (SHORTHAND[w] ?? w).split(" "));
  return words.map((w) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") ? w.slice(0, -1) : w));
}

export interface Searchable {
  name: string;
  category?: string | null;
  equipment?: string | null;
  muscleGroups?: string[];
}

/**
 * Exercises matching what was typed, best first. Every typed word must appear
 * somewhere (name, equipment, category or muscles); names that start with it
 * or contain all of it rank first, then shorter names.
 */
export function searchExercises<T extends Searchable>(list: T[], query: string, limit = 25): T[] {
  const q = searchWords(query);
  if (q.length === 0) return [];
  const qJoined = q.join(" ");
  const scored: { item: T; score: number }[] = [];
  for (const item of list) {
    const name = searchWords(item.name);
    const nameJoined = name.join(" ");
    const other = searchWords([item.category ?? "", item.equipment ?? "", ...(item.muscleGroups ?? [])].join(" "));
    const has = (w: string, words: string[]) => words.some((x) => x.startsWith(w));
    if (!q.every((w) => has(w, name) || has(w, other))) continue;
    let score = 0;
    if (nameJoined === qJoined) score += 100;
    if (nameJoined.startsWith(qJoined)) score += 50;
    if (nameJoined.includes(qJoined)) score += 20;
    score += q.filter((w) => has(w, name)).length * 10;
    score -= item.name.length / 10;
    scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}
