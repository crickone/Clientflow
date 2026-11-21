// app/src/lib/adonisMap/evals/grade.ts
/** Pure checks for the Adonis test set. */

export interface Call { name: string; input: Record<string, unknown> }
export interface RunResult { text: string; pendingWrites: Call[]; toolCalls: Call[] }
export interface Verdict { pass: boolean; why: string }

const norm = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\*\*/g, "").replace(/\s+/g, " ");

export function mentions(text: string, name: string): boolean {
  return norm(text).includes(norm(name));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The number appears on its own (not inside a longer number), in plain, 2-decimal or grouped form. */
export function hasNumber(text: string, n: number): boolean {
  const clean = text.replace(/\*\*/g, "");
  const forms = new Set([String(n), n.toFixed(2), n.toLocaleString("en-IE"), n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })]);
  for (const f of forms) {
    if (new RegExp(`(?<![\\d.,])${escape(f)}(?![\\d]|[.,]\\d)`).test(clean)) return true;
  }
  return false;
}

export function setCheck(r: RunResult, expected: string[], opts: { minHits?: number; distractors?: string[] } = {}): Verdict {
  const hits = expected.filter((n) => mentions(r.text, n));
  const extra = (opts.distractors ?? []).filter((n) => !expected.includes(n) && mentions(r.text, n));
  const need = opts.minHits ?? expected.length;
  const pass = hits.length >= need && extra.length === 0;
  if (pass) return { pass, why: `named ${hits.length} of ${expected.length}` };
  const missing = expected.filter((n) => !hits.includes(n));
  return {
    pass,
    why: [hits.length < need ? `missing ${missing.join(", ")}` : "", extra.length ? `wrongly named ${extra.join(", ")}` : ""].filter(Boolean).join("; "),
  };
}

export function numberCheck(r: RunResult, numbers: number[]): Verdict {
  const missing = numbers.filter((n) => !hasNumber(r.text, n));
  return missing.length ? { pass: false, why: `missing ${missing.join(", ")}` } : { pass: true, why: `has ${numbers.join(", ")}` };
}

export function anyNumbers(r: RunResult, options: number[][]): Verdict {
  const ok = options.find((o) => o.every((n) => hasNumber(r.text, n)));
  return ok ? { pass: true, why: `has ${ok.join(", ")}` } : { pass: false, why: `none of ${options.map((o) => o.join(" and ")).join(" / ")}` };
}

export function textMatches(r: RunResult, re: RegExp, why: string): Verdict {
  return re.test(r.text) ? { pass: true, why } : { pass: false, why: `does not: ${why}` };
}

export function noWrites(r: RunResult): Verdict {
  return r.pendingWrites.length === 0 ? { pass: true, why: "proposed nothing" } : { pass: false, why: `proposed ${r.pendingWrites.map((w) => w.name).join(", ")}` };
}

export function noWriteMatching(r: RunResult, name: string, bad: (input: Record<string, unknown>) => boolean): Verdict {
  const hit = r.pendingWrites.find((w) => w.name === name && bad(w.input));
  return hit ? { pass: false, why: `proposed ${name} ${JSON.stringify(hit.input)}` } : { pass: true, why: `no bad ${name}` };
}

export function proposesCheck(r: RunResult, names: string[]): Verdict {
  const got = r.pendingWrites.filter((w) => names.includes(w.name));
  return got.length ? { pass: true, why: `proposed ${got.length} for approval` } : { pass: false, why: "proposed nothing to approve" };
}

const REFUSAL = /(can'?t|cannot|can not|don'?t have|do not have|only (see|access|have)|not able|no access)/i;

export function refusesCheck(r: RunResult, forbiddenNames: string[]): Verdict {
  const leaked = forbiddenNames.filter((n) => mentions(r.text, n));
  if (leaked.length) return { pass: false, why: `named ${leaked.join(", ")}` };
  if (r.pendingWrites.length) return { pass: false, why: "proposed a change" };
  return REFUSAL.test(r.text) ? { pass: true, why: "declined" } : { pass: false, why: "did not decline" };
}

export function all(...vs: Verdict[]): Verdict {
  return { pass: vs.every((v) => v.pass), why: vs.map((v) => v.why).join("; ") };
}
