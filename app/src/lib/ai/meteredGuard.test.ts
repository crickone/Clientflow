// Run: npm test -- src/lib/ai/meteredGuard.test.ts
//
// CI GUARD (P1 hardening — centralize AI metering). The per-tenant monthly AI
// spend cap (@/lib/ai/usage) is only UNSKIPPABLE if every paid model call goes
// through a chokepoint that enforces it. There are exactly two:
//   - meteredCreate (@/lib/ai/metered)         — one-shot, non-streaming calls
//   - runAgentTurn  (@/lib/agents/runAgentTurn) — the agent tool-use loop,
//     which streams via AnthropicProvider and meters once per turn
// Both reach the SDK only through the shared getAnthropic() client. Every other
// file must go through those, never the raw SDK. This test fails the build if
// any non-sanctioned file reaches for the SDK directly — `new Anthropic()`,
// `.messages.create(` / `.messages.stream(`, or `getAnthropic(` — because such
// a call would dodge both the cap and the per-tenant usage ledger.
//
// Adding a new AI feature? Route it through meteredCreate (one-shot) or
// runAgentTurn (agent). Do NOT add yourself to SANCTIONED — that list is the
// set of reviewed metering chokepoints, not an escape hatch.
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// The ONLY files allowed to touch the raw Anthropic SDK directly. Keep this
// tiny — every entry is a deliberate, reviewed chokepoint.
const SANCTIONED = new Set([
  "src/lib/ai/client.ts", // getAnthropic(): the one cached Anthropic client (the sole `new Anthropic()`)
  "src/lib/ai/metered.ts", // meteredCreate(): the one-shot metered .messages.create() chokepoint
  "src/lib/ai/providers/anthropic.ts", // AnthropicProvider: the streaming .messages.stream() runAgentTurn meters
]);

// Raw-SDK-access signatures that must not appear outside SANCTIONED files.
const FORBIDDEN: { pattern: RegExp; fix: string }[] = [
  { pattern: /new\s+Anthropic\s*\(/, fix: "new Anthropic() — get the client via getAnthropic() (only inside a chokepoint)" },
  { pattern: /\.messages\s*\.\s*create\s*\(/, fix: ".messages.create() — route one-shot calls through meteredCreate()" },
  { pattern: /\.messages\s*\.\s*stream\s*\(/, fix: ".messages.stream() — streaming lives in AnthropicProvider; drive it via runAgentTurn()" },
  { pattern: /\bgetAnthropic\s*\(/, fix: "getAnthropic() — grabbing the raw client bypasses the cap; use meteredCreate()" },
];

/**
 * Strip block + line comments so a doc/comment MENTION of these APIs (there are
 * several — e.g. metered.ts's own header, runAgentTurn's history note) isn't
 * mistaken for a real call. Truncating a string literal that happens to contain
 * `//` can only remove text, never synthesise a forbidden call, so this can't
 * manufacture a false positive.
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function walkSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...walkSourceFiles(p));
    } else if (
      (p.endsWith(".ts") || p.endsWith(".tsx")) &&
      !p.endsWith(".test.ts") &&
      !p.endsWith(".test.tsx")
    ) {
      out.push(p);
    }
  }
  return out;
}

const srcDir = join(process.cwd(), "src");
const violations: string[] = [];

for (const abs of walkSourceFiles(srcDir)) {
  const rel = relative(process.cwd(), abs).split(sep).join("/");
  if (SANCTIONED.has(rel)) continue;
  const code = stripComments(readFileSync(abs, "utf8"));
  for (const { pattern, fix } of FORBIDDEN) {
    if (pattern.test(code)) violations.push(`  ${rel} — ${fix}`);
  }
}

assert.equal(
  violations.length,
  0,
  "Unmetered Anthropic SDK access found outside the sanctioned metering chokepoints:\n" +
    violations.join("\n") +
    "\n\nEvery paid model call must go through meteredCreate (@/lib/ai/metered) for one-shot\n" +
    "calls, or runAgentTurn (@/lib/agents/runAgentTurn) for the agent loop, so the per-tenant\n" +
    "monthly AI cap (@/lib/ai/usage) can't be skipped.",
);

// Sanity: the guard is only meaningful if its allowlisted chokepoints actually
// exist — a rename that isn't reflected here would silently allowlist nothing
// real. (A stale import would already fail typecheck, but fail loudly here too.)
for (const f of SANCTIONED) {
  assert.ok(
    statSync(join(process.cwd(), f)).isFile(),
    `Sanctioned metering chokepoint no longer exists: ${f} — update SANCTIONED in meteredGuard.test.ts`,
  );
}

console.log(
  `ai/meteredGuard.test.ts: no unmetered SDK access (${SANCTIONED.size} sanctioned chokepoints skipped)`,
);
