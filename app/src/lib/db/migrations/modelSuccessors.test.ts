// Run: npm test -- src/lib/db/migrations/modelSuccessors.test.ts
//
// 0008 and 0009 move stored model ids onto the models that replaced them in
// the picker. Two places hold one: an agent's `model` column, and the
// tenant's campaign build model, a JSON string in the settings KV. Both
// matter for the same reason -- an id the app no longer offers either shows
// an empty selector (agents) or silently falls back to the content model
// (campaigns), and nobody chose that.
//
// What this proves: every superseded id lands on its successor in both
// places, the setting stays valid JSON, and nothing outside the mapped ids
// moves -- not a model a tenant picked that is still offered, and not a
// different settings key that happens to hold the same string.
//
// In-memory better-sqlite3 with just the two tables the migrations touch,
// the same approach seedTherapyResources.test.ts takes.
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { MODELS } from "@/lib/ai/client";
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { isCampaignBuildModelId } from "@/lib/campaigns/buildModel";
import { TENANT_MIGRATIONS } from "./index";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

const m0008 = TENANT_MIGRATIONS.find((m) => m.id === "0008-claude-5-5");
const m0009 = TENANT_MIGRATIONS.find((m) => m.id === "0009-openrouter-successors");
assert.ok(m0008, "0008-claude-5-5 is in TENANT_MIGRATIONS");
assert.ok(m0009, "0009-openrouter-successors is in TENANT_MIGRATIONS");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE agents (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, model TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}
function runBoth(db: Database.Database) {
  m0008!.up(db);
  m0009!.up(db);
}
const agentModel = (db: Database.Database) =>
  (db.prepare("SELECT model FROM agents").get() as { model: string }).model;
const campaignModel = (db: Database.Database) =>
  JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'campaignBuildModel'").get() as { value: string }).value);

// Every superseded id and what it must become.
const SUCCESSOR: Record<string, string> = {
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-opus-5": "claude-opus-5-5",
  "claude-opus-4-8": "claude-opus-5-5",
  "openrouter:deepseek/deepseek-v4-flash-0731": "openrouter:deepseek/deepseek-v4.1-flash",
  "openrouter:moonshotai/kimi-k2-0905": "openrouter:moonshotai/kimi-k2.6",
  "openrouter:qwen/qwen3-235b-a22b-2507": "openrouter:qwen/qwen3.8-flash",
  "openrouter:z-ai/glm-5.2": "openrouter:z-ai/glm-5.3",
  "openrouter:openai/gpt-5": "openrouter:openai/gpt-6.1-sol",
};

// ── 1. Each superseded agent model lands on a model the picker offers ──────
for (const [from, to] of Object.entries(SUCCESSOR)) {
  const db = freshDb();
  db.prepare("INSERT INTO agents (key, model) VALUES ('orchestrator', ?)").run(from);
  runBoth(db);
  check(`agent on ${from} moves to ${to}`, agentModel(db), to);
  check(`${to} is in the picker`, MODEL_CATALOG.some((m) => m.id === to), true);
}

// ── 2. The campaign build model moves too, and stays valid JSON ─────────────
// Includes the Haiku snapshot: the campaign list offers Haiku and its id is
// now the alias, so the dated id would otherwise fall back to Sonnet.
for (const [from, to] of Object.entries({ ...SUCCESSOR, "claude-haiku-4-5-20251001": "claude-haiku-4-5" })) {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('campaignBuildModel', ?)").run(JSON.stringify(from));
  runBoth(db);
  check(`campaign build model ${from} moves to ${to}`, campaignModel(db), to);
  check(`${to} is still a campaign choice`, isCampaignBuildModelId(to), true);
}
check("the Haiku the campaign list offers is the alias", MODELS.haiku, "claude-haiku-4-5");

// ── 3. Nothing outside the mapped ids moves ─────────────────────────────────
{
  const db = freshDb();
  // Still offered, so a tenant's choice stands.
  db.prepare("INSERT INTO agents (key, model) VALUES ('orchestrator', ?)").run("openrouter:google/gemini-3.1-pro-preview");
  // The same string under a different key is not a campaign model.
  db.prepare("INSERT INTO settings (key, value) VALUES ('someOtherKey', ?)").run(JSON.stringify("claude-sonnet-5"));
  db.prepare("INSERT INTO settings (key, value) VALUES ('campaignBuildModel', ?)").run(JSON.stringify(MODELS.haiku));
  runBoth(db);
  check("an agent on a still-offered model is untouched", agentModel(db), "openrouter:google/gemini-3.1-pro-preview");
  check(
    "another settings key holding an old id is untouched",
    JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'someOtherKey'").get() as { value: string }).value),
    "claude-sonnet-5",
  );
  check("a campaign model already current is untouched", campaignModel(db), MODELS.haiku);
}

// ── 4. Re-running changes nothing ───────────────────────────────────────────
{
  const db = freshDb();
  db.prepare("INSERT INTO agents (key, model) VALUES ('orchestrator', 'claude-opus-5')").run();
  runBoth(db);
  runBoth(db);
  check("running twice leaves the agent on the successor", agentModel(db), "claude-opus-5-5");
}

console.log(`migrations/modelSuccessors.test.ts: ${passed} assertions passed`);
