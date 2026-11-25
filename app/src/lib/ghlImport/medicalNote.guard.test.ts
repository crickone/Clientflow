// Run: npm test -- src/lib/ghlImport/medicalNote.guard.test.ts
//
// The staff-only medical note from a GoHighLevel import may only be touched
// by the files that store it and the lead and client pages that show it.
// Any other file naming it (an AI tool, the inbox triage, a message, an
// export) fails this test, so a new reader has to be a deliberate change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "src");
const PATTERN = /staffMedicalNote|staff_medical_note|medicalCondition/;
const ALLOWED = new Set(
  [
    "lib/db/schema.ts",
    "lib/db/tenant.ts",
    "lib/ghlImport/csv.ts",
    "lib/ghlImport/plan.ts",
    "lib/ghlImport/apply.ts",
    "lib/ghlImport/store.ts",
    "lib/ghlImport/types.ts",
    "components/people/GhlImportCard.tsx",
  ].map((p) => path.join(SRC, p)),
);
const NEVER = ["lib/ai/", "lib/agents/", "lib/inbox/", "lib/adonisMap/", "lib/leadFlows/", "lib/marketing/", "lib/email", "lib/assistant/", "app/api/agents/"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders = walk(SRC).filter((f) => !ALLOWED.has(f) && PATTERN.test(fs.readFileSync(f, "utf8")));
assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), [], "only the import's own files and the staff card may touch the medical note");
for (const f of ALLOWED) {
  const rel = path.relative(SRC, f);
  assert.ok(!NEVER.some((p) => rel.startsWith(p)), `${rel} is in a folder the medical note must never reach`);
}
console.log("medical note guard: 2 checks passed.");
