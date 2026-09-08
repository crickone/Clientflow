// Seed (or clear) a tenant's design system.
//
//   npx tsx scripts/seed-design-system.ts --slug=optimal-health
//   npx tsx scripts/seed-design-system.ts --slug=optimal-health --preset=optimal-health
//   npx tsx scripts/seed-design-system.ts --slug=optimal-health --clear
//   npx tsx scripts/seed-design-system.ts --list
//
// Writes straight to the tenant's own settings table -- no HTTP, no running
// app -- which is what lets it run against the deployed volume:
//
//   railway run npx tsx scripts/seed-design-system.ts --slug=<slug>
//
// A tenant WITHOUT a design system keeps today's Content Studio behaviour
// exactly: fixed templates only, no composed layouts, no validation notices.
// That is the whole compatibility story, so this script is the ONLY thing that
// turns the composed path on for a tenant, and running it is a deliberate act.
//
// The value written is round-tripped through parseDesignSystem first, so a
// preset that would read back as null can never be stored.
import Database from "better-sqlite3";
import path from "node:path";

import { DESIGN_SYSTEM_PRESETS } from "../src/lib/design/presets";
import { parseDesignSystem } from "../src/lib/design/parse";

const DATA_DIR = path.join(process.cwd(), "data");
const CONTROL_PATH = path.join(DATA_DIR, "control.db");
const KEY = "design_system";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const control = new Database(CONTROL_PATH, { readonly: true });
const tenants = control
  .prepare("SELECT id, slug, name, db_file FROM tenants ORDER BY id")
  .all() as { id: number; slug: string; name: string; db_file: string }[];

if (has("list") || (!arg("slug") && !has("clear"))) {
  console.log("Tenants:");
  for (const t of tenants) console.log(`  ${String(t.id).padStart(5)}  ${t.slug.padEnd(20)} ${t.name}`);
  console.log("\nPresets:");
  for (const key of Object.keys(DESIGN_SYSTEM_PRESETS)) console.log(`  ${key}`);
  console.log(
    '\nUsage: npx tsx scripts/seed-design-system.ts --slug=<slug> [--preset=<preset>] [--clear]',
  );
  process.exit(0);
}

const slug = arg("slug");
const tenant = tenants.find((t) => t.slug === slug);
if (!tenant) {
  console.error(`No tenant with slug "${slug}". Run with --list to see them.`);
  process.exit(1);
}

const dbPath = path.isAbsolute(tenant.db_file)
  ? tenant.db_file
  : path.join(DATA_DIR, tenant.db_file);
const tdb = new Database(dbPath);

if (has("clear")) {
  tdb.prepare("DELETE FROM settings WHERE key = ?").run(KEY);
  console.log(`Cleared the design system for ${tenant.slug}. It is back to templates only.`);
  process.exit(0);
}

const presetKey = arg("preset") ?? "optimal-health";
const preset = DESIGN_SYSTEM_PRESETS[presetKey];
if (!preset) {
  console.error(
    `No preset "${presetKey}". Available: ${Object.keys(DESIGN_SYSTEM_PRESETS).join(", ")}`,
  );
  process.exit(1);
}

// The same parser getDesignSystem() uses, so what is stored is provably what
// will be read back.
const parsed = parseDesignSystem(preset);
if (!parsed) {
  console.error(`Preset "${presetKey}" does not parse. Refusing to store it.`);
  process.exit(1);
}

tdb
  .prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
  .run(KEY, JSON.stringify(parsed));

console.log(
  `Seeded the "${presetKey}" design system into ${tenant.slug} (${tenant.name}).`,
);
console.log(
  `  ${parsed.values.length} values, ${parsed.grounds.length} grounds, ${parsed.grid.columns}-column grid on a ${parsed.grid.field}px field.`,
);
console.log(
  "  Content Studio will now compose layouts for this tenant and check them against these rules.",
);
