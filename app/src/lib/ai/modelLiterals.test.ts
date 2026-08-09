// Run: npm test -- src/lib/ai/modelLiterals.test.ts
//
// Batch 3a, C2: regression guard — no hardcoded "claude-opus-4-7" string
// literal may reappear anywhere under src/. Before this batch, 8 call sites
// (draftFollowup.ts, refreshSlides.ts x2, triageMessage.ts, planCut.ts,
// draftBlog.ts, generateCarousel.ts, tools.marketing.ts's MARKETING_MODEL)
// hardcoded this literal directly instead of using MODELS.opus; C2 replaced
// every one ("this intentionally moves 4-7->4-8, audit confirms identically
// priced, newer" — see docs/improvement-plan-2026-08.md Theme C). This test
// greps the actual source tree at test-run time (not a fixed file list) so a
// future contributor reintroducing the literal — e.g. copy-pasting an old
// snippet, or adding a new AI call site the lazy way — fails this test
// immediately instead of silently reopening the cap-bypass / stale-model-id
// problem C2 closed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STALE_LITERAL = "claude-opus-4-7";
const SELF_PATH = fileURLToPath(import.meta.url); // this file mentions the literal in prose above — exclude it, not the string

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

(async () => {
  const srcDir = path.join(process.cwd(), "src");
  const files = walk(srcDir).filter((f) => path.resolve(f) !== path.resolve(SELF_PATH));
  // Sanity: prove the walk actually found the source tree, not an empty/wrong
  // directory (which would make the "zero offenders" assertion below vacuous).
  assert.ok(files.length > 100, `sanity: expected >100 source files under ${srcDir}, found ${files.length}`);

  const offenders: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(STALE_LITERAL)) continue;
    const rel = path.relative(process.cwd(), file);
    text.split("\n").forEach((lineText, i) => {
      if (lineText.includes(STALE_LITERAL)) offenders.push(`${rel}:${i + 1}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `found stray "${STALE_LITERAL}" literal(s) — replace with MODELS.opus (@/lib/ai/client.ts): ${JSON.stringify(offenders)}`,
  );

  console.log("ai/modelLiterals.test.ts: all assertions passed");
})();
