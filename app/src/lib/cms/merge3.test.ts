// Run: npm test -- src/lib/cms/merge3.test.ts
//
// This decides whether a client's edit and ours can both survive. Getting it
// wrong silently corrupts somebody's website, so the cases that matter are
// the ones where it must REFUSE, not the ones where it works.
import assert from "node:assert/strict";

import { merge3, mergeLooksSane } from "./merge3";

const lines = (...l: string[]) => l.join("\n");

// ── the case the whole thing exists for ─────────────────────────────────────
// We fix the footer, the client rewrites a headline. Neither change knows
// about the other, and both should survive.
{
  const base = lines("<header>nav</header>", "<h1>Old headline</h1>", "<p>body</p>", "<footer>old footer</footer>");
  const ours = lines("<header>nav</header>", "<h1>Old headline</h1>", "<p>body</p>", "<footer>NEW footer</footer>");
  const theirs = lines("<header>nav</header>", "<h1>THEIR headline</h1>", "<p>body</p>", "<footer>old footer</footer>");

  const r = merge3(base, ours, theirs);
  assert.ok(r.ok, "two changes in different places merge");
  if (!r.ok) throw new Error("unreachable");
  assert.match(r.merged, /THEIR headline/, "THE CLIENT'S EDIT SURVIVES");
  assert.match(r.merged, /NEW footer/, "…and so does ours");
  assert.ok(!r.merged.includes("Old headline"), "the superseded headline is gone");
  assert.ok(!r.merged.includes("old footer"), "…and so is the superseded footer");
  assert.equal(r.tookOurs, 1);
  assert.equal(r.tookTheirs, 1);
}

// ── the case it must refuse ─────────────────────────────────────────────────
// Both rewrote the same line, differently. There is no honest answer.
{
  const base = lines("<h1>Old</h1>", "<p>body</p>");
  const ours = lines("<h1>Ours</h1>", "<p>body</p>");
  const theirs = lines("<h1>Theirs</h1>", "<p>body</p>");

  const r = merge3(base, ours, theirs);
  assert.equal(r.ok, false, "A REGION BOTH SIDES REWROTE IS A CONFLICT, not a guess");
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.conflicts, 1, "…and it says how many");
}

// A conflict anywhere fails the WHOLE merge. A half-merged page is worse
// than no merge: nobody can tell which half is which.
{
  const base = lines("a", "b", "c", "d", "e");
  const ours = lines("a", "OURS-b", "c", "d", "OURS-e");
  const theirs = lines("a", "THEIRS-b", "c", "d", "e");
  const r = merge3(base, ours, theirs);
  assert.equal(r.ok, false, "one conflict fails everything, even though line e was clean");
}

// ── nothing is invented ─────────────────────────────────────────────────────
{
  const base = lines("x", "y");
  const ours = lines("x", "OURS");
  const theirs = lines("x", "THEIRS");
  const r = merge3(base, ours, theirs);
  assert.equal(r.ok, false);
  // Conflict markers in a web page would be published to real visitors.
  const asAny = r as unknown as { merged?: string };
  assert.equal(asAny.merged, undefined, "a failed merge returns NO content at all");
}

// ── the easy cases still behave ─────────────────────────────────────────────
{
  const base = lines("a", "b");
  assert.deepEqual(
    (() => {
      const r = merge3(base, base, lines("a", "THEIRS"));
      return r.ok ? r.merged : null;
    })(),
    lines("a", "THEIRS"),
    "we changed nothing, so their version stands",
  );
  assert.deepEqual(
    (() => {
      const r = merge3(base, lines("OURS", "b"), base);
      return r.ok ? r.merged : null;
    })(),
    lines("OURS", "b"),
    "they changed nothing, so ours publishes",
  );
  assert.deepEqual(
    (() => {
      const r = merge3(base, lines("SAME", "b"), lines("SAME", "b"));
      return r.ok ? r.merged : null;
    })(),
    lines("SAME", "b"),
    "the identical change on both sides is taken once, not twice",
  );
  const untouched = merge3(base, base, base);
  assert.ok(untouched.ok && untouched.merged === base, "nobody changed anything");
}

// ── insertions and deletions, not just rewrites ─────────────────────────────
{
  const base = lines("<h1>Title</h1>", "<p>one</p>", "<footer>f</footer>");
  const ours = lines("<h1>Title</h1>", "<p>one</p>", "<p>OURS added</p>", "<footer>f</footer>");
  const theirs = lines("<h1>THEIR title</h1>", "<p>one</p>", "<footer>f</footer>");
  const r = merge3(base, ours, theirs);
  assert.ok(r.ok, "an insertion by one side and a rewrite by the other merge");
  if (!r.ok) throw new Error("unreachable");
  assert.match(r.merged, /OURS added/);
  assert.match(r.merged, /THEIR title/);
}
{
  const base = lines("a", "REMOVE ME", "b", "c");
  const ours = lines("a", "b", "c");
  const theirs = lines("a", "REMOVE ME", "b", "THEIR c");
  const r = merge3(base, ours, theirs);
  assert.ok(r.ok, "a deletion by one side and an edit by the other merge");
  if (!r.ok) throw new Error("unreachable");
  assert.ok(!r.merged.includes("REMOVE ME"), "our deletion is honoured");
  assert.match(r.merged, /THEIR c/, "…and their edit is kept");
}

// ── a real page shape ───────────────────────────────────────────────────────
// The stylesheet must survive untouched: it IS the site's design.
{
  const style = "<style>:root{--gold:#c9a227}</style>";
  const base = lines(style, "<header>nav</header>", "<h1>Clonmel gym</h1>", "<p>Open six days.</p>", "<footer>2026</footer>");
  const ours = lines(style, "<header>nav</header>", "<h1>Clonmel gym</h1>", "<p>Open six days.</p>", "<footer>2027</footer>");
  const theirs = lines(style, "<header>nav</header>", "<h1>Clonmel's toughest gym</h1>", "<p>Open six days.</p>", "<footer>2026</footer>");
  const r = merge3(base, ours, theirs);
  assert.ok(r.ok);
  if (!r.ok) throw new Error("unreachable");
  assert.ok(r.merged.startsWith(style), "the stylesheet is untouched");
  assert.match(r.merged, /Clonmel's toughest gym/);
  assert.match(r.merged, /2027/);
}

// ── the sanity check ────────────────────────────────────────────────────────
const reference = "<div><p>a</p><p>b</p><p>c</p><p>d</p><p>e</p><p>f</p></div>";

assert.equal(mergeLooksSane(reference, reference).ok, true, "an unchanged page is sane");
assert.equal(mergeLooksSane("", reference).ok, false, "an empty result is refused");
assert.equal(mergeLooksSane("<div><p>a</p></div>", reference).ok, false, "losing most of a page is refused");

{
  // Markup that no longer closes must not be published.
  const broken = reference.replace("</div>", "");
  const verdict = mergeLooksSane(broken, reference);
  assert.equal(verdict.ok, false, "unbalanced markup is refused");
  if (!verdict.ok) assert.match(verdict.reason, /div/, "…and it names the tag");
}

{
  // These pages are hand-written and some carry an unclosed tag a browser
  // tolerates. The question is whether the MERGE made it worse, not whether
  // the page was ever perfect.
  const alreadyOdd = "<div><p>a<p>b<p>c<p>d<p>e<p>f</div>";
  assert.equal(
    mergeLooksSane(alreadyOdd, alreadyOdd).ok,
    true,
    "a page that was already imperfect is not blamed on the merge",
  );
}

console.log("merge3.test.ts: all assertions passed");
