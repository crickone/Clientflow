// Run: npm test -- src/lib/content-studio/ideaLibrary.test.ts
//
// The ideas library — the point of which is that a kept idea SURVIVES. Covers:
//   1. saving is idempotent on the hook (the generator repeats itself across
//      runs; without this the library fills with near-duplicates);
//   2. a saved idea is a SNAPSHOT — re-saving the same hook with different
//      wording never rewrites what the operator deliberately kept;
//   3. used ideas are marked, not deleted, and sort behind unused ones —
//      "what have we already covered" is a question the library must answer;
//   4. delete actually removes.
//
// NOTE: plain node:assert/strict via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { deleteIdea, listIdeas, markIdeaUsed, saveIdea, savedHooks } =
    requireLocal("./ideaLibrary") as typeof import("./ideaLibrary");

  const slug = "idea-library-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const abs = path.join(process.cwd(), "data", dbFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Idea Library Test", dbFile) as { id: number };

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });
  };

  try {
    const tdb = getTenantDbById(t.id);

    assert.deepEqual(listIdeas(tdb), [], "a fresh library is empty");

    const one = saveIdea(
      {
        pillar: "Training",
        hook: "Why your deadlift stalls at 12 weeks",
        teaches: "Progressive overload has a ceiling without a deload.",
        basis: "Progressive overload and fatigue management.",
        needsSource: "Typical deload frequency",
      },
      tdb,
    )!;
    assert.ok(one.id > 0);
    assert.equal(one.status, "saved");
    assert.equal(one.needsSource, "Typical deload frequency", "needsSource survives the round trip");

    // ── 1 + 2. idempotent, and a SNAPSHOT ──
    const again = saveIdea(
      {
        pillar: "Different pillar",
        hook: "Why your deadlift stalls at 12 weeks",
        teaches: "Completely different wording.",
        basis: "Something else.",
      },
      tdb,
    )!;
    assert.equal(again.id, one.id, "the same hook is the same idea, not a duplicate");
    assert.equal(listIdeas(tdb).length, 1);
    assert.equal(again.teaches, one.teaches, "re-saving never rewrites what was kept");
    assert.equal(again.pillar, one.pillar);

    assert.equal(saveIdea({ pillar: "", hook: "   ", teaches: "", basis: "" }, tdb), null, "an empty hook is not an idea");

    // ── 3. used ideas are marked, kept, and sort behind unused ones ──
    saveIdea({ pillar: "Nutrition", hook: "Protein timing is mostly noise", teaches: "Daily total dominates.", basis: "Protein intake ranges." }, tdb);
    markIdeaUsed("Why your deadlift stalls at 12 weeks", tdb);

    const after = listIdeas(tdb);
    assert.equal(after.length, 2, "a used idea is kept, not deleted");
    assert.equal(after[0].hook, "Protein timing is mostly noise", "unused ideas come first — they're the ones still to write");
    assert.equal(after[1].status, "used");
    assert.ok(after[1].usedAt, "and it records when");

    markIdeaUsed("Why your deadlift stalls at 12 weeks", tdb);
    assert.equal(listIdeas(tdb).filter((i) => i.status === "used").length, 1, "marking twice is harmless");

    // ── savedHooks powers the bookmark state on the generated list ──
    const hooks = savedHooks(tdb);
    assert.equal(hooks.has("Protein timing is mostly noise"), true);
    assert.equal(hooks.has("Never generated this"), false);

    // ── 4. delete ──
    deleteIdea(one.id, tdb);
    assert.equal(listIdeas(tdb).length, 1);
    assert.equal(listIdeas(tdb)[0].hook, "Protein timing is mostly noise");

    console.log("content-studio/ideaLibrary.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
