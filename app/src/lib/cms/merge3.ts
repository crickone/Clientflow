/**
 * A three-way merge over lines, so two people can change one page without
 * one of them losing.
 *
 * The problem this exists for: a client edits their site in the app, and we
 * ship a fix to the same site from the repo. Today whoever wrote last wins
 * and the other change is either blocked or discarded. But a footer fix on
 * line 270 and a rewritten headline on line 40 do not actually disagree
 * about anything, and a stored page here runs to roughly 280 lines at about
 * 120 characters, so changes really are that local.
 *
 * Three versions go in:
 *   base   — what the repo last published to this page
 *   ours   — the new version in the repo
 *   theirs — what is live now, including anything the client changed
 *
 * Comparing each against the base says who changed what. Where only one side
 * moved, that side is taken. Where both moved the same way, the change is
 * taken once. Where both moved differently, there is no honest answer, so it
 * REFUSES — it never guesses, never interleaves, and never emits conflict
 * markers into a web page.
 *
 * Zero imports, so it loads under the plain tsx test runner (mirrors
 * lib/campaigns/plan.ts and lib/cms/pageBody.ts).
 */

export type Merge3Result =
  | { ok: true; merged: string; tookOurs: number; tookTheirs: number }
  | { ok: false; conflicts: number };

/**
 * Indices of lines common to both inputs, in order — the anchors a merge is
 * built around.
 *
 * Classic longest-common-subsequence table. Inputs here are a few hundred
 * lines, so the quadratic table is a few tens of thousands of small numbers:
 * not worth the complexity of anything cleverer, and easy to be sure of.
 */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // table[i][j] = LCS length of a[i..] and b[j..]
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** base line index -> index of the same line in the other version, where it survived unchanged. */
function matchMap(base: string[], other: string[]): Map<number, number> {
  return new Map(lcsPairs(base, other));
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Merge `ours` and `theirs`, both descended from `base`.
 *
 * Succeeds only when every difference belongs to one side alone (or both
 * sides made the identical change). Any region both sides rewrote
 * differently fails the whole merge — a partly-merged page is worse than no
 * merge at all, because nobody can see which half is which.
 */
export function merge3(base: string, ours: string, theirs: string): Merge3Result {
  if (ours === theirs) return { ok: true, merged: ours, tookOurs: 0, tookTheirs: 0 };
  if (base === ours) return { ok: true, merged: theirs, tookOurs: 0, tookTheirs: 1 };
  if (base === theirs) return { ok: true, merged: ours, tookOurs: 1, tookTheirs: 0 };

  const b = base.split("\n");
  const o = ours.split("\n");
  const t = theirs.split("\n");

  const inOurs = matchMap(b, o);
  const inTheirs = matchMap(b, t);

  // A base line is an ANCHOR when it survived unchanged in both versions.
  // Between two anchors sits one region per side, and each region can be
  // judged on its own.
  const anchors: number[] = [];
  for (let i = 0; i < b.length; i++) {
    if (inOurs.has(i) && inTheirs.has(i)) anchors.push(i);
  }

  const out: string[] = [];
  let conflicts = 0;
  let tookOurs = 0;
  let tookTheirs = 0;

  let bi = 0; // next base line to account for
  let oi = 0;
  let ti = 0;

  const region = (bEnd: number, oEnd: number, tEnd: number) => {
    const bs = b.slice(bi, bEnd);
    const os = o.slice(oi, oEnd);
    const ts = t.slice(ti, tEnd);
    if (same(os, ts)) {
      out.push(...os); // both sides agree (including "neither changed it")
    } else if (same(os, bs)) {
      out.push(...ts); // only they changed it
      tookTheirs++;
    } else if (same(ts, bs)) {
      out.push(...os); // only we changed it
      tookOurs++;
    } else {
      conflicts++; // both changed it, differently
    }
  };

  for (const anchor of anchors) {
    const oAnchor = inOurs.get(anchor)!;
    const tAnchor = inTheirs.get(anchor)!;
    region(anchor, oAnchor, tAnchor);
    out.push(b[anchor]);
    bi = anchor + 1;
    oi = oAnchor + 1;
    ti = tAnchor + 1;
  }
  // Whatever trails the last anchor.
  region(b.length, o.length, t.length);

  if (conflicts > 0) return { ok: false, conflicts };
  return { ok: true, merged: out.join("\n"), tookOurs, tookTheirs };
}

/**
 * Does this still look like a page?
 *
 * A merge can apply cleanly and still produce something wrong, so nothing
 * merged is published without this. It is not a validator of correctness —
 * that is not available to us — but it catches the failures that would be
 * visible to a visitor: markup that no longer closes, or a page that has
 * lost most of itself.
 */
export function mergeLooksSane(
  merged: string,
  reference: string,
): { ok: true } | { ok: false; reason: string } {
  if (!merged.trim()) return { ok: false, reason: "the merged page is empty" };

  // Losing or gaining a third of a page is not an edit, it is an accident.
  const ratio = merged.length / Math.max(1, reference.length);
  if (ratio < 0.67) return { ok: false, reason: `the merged page is ${Math.round((1 - ratio) * 100)}% smaller` };
  if (ratio > 1.5) return { ok: false, reason: `the merged page is ${Math.round((ratio - 1) * 100)}% larger` };

  for (const tag of ["div", "section", "header", "footer", "nav", "a", "p", "ul", "li"]) {
    const open = (merged.match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
    const close = (merged.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    const refOpen = (reference.match(new RegExp(`<${tag}\\b`, "gi")) || []).length;
    const refClose = (reference.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    // Compare against the REFERENCE rather than demanding perfect balance:
    // these pages are hand-written and some already run a self-closing or
    // unclosed tag past a browser happily. The merge must not make that
    // worse, which is a different and answerable question.
    if (open - close !== refOpen - refClose) {
      return { ok: false, reason: `<${tag}> tags no longer balance the way they did` };
    }
  }
  return { ok: true };
}
