// ONE-OFF production data migration, run 2026-09-14 via `railway ssh`.
// Kept in the repo as the record of what moved; it must never run again
// (it refuses to when the target carries the `merged_from_renova` marker).
//
// WHY: the Optimal Health business existed as TWO tenants — tenant 1 `renova`
// (the original single-tenant app, migrated in place onto the legacy clinic.db,
// with slug-keyed special cases throughout src/) and tenant 1028
// `optimal-health` (provisioned through the admin console on 2026-08-10, where
// the business actually lives: profile + marketing brain, staff, leads, the
// Facebook page, the Mailgun domain, the design system). Every feature landed
// on whichever tenant was active that day, so something was always "missing"
// from Optimal Health. This folds tenant 1's real content into 1028 and
// retires tenant 1 (is_active = 0, reversible — nothing is deleted).
//
// WHAT MOVES (from clinic.db into optimal-health.db):
//   image_library_assets (52) — new ids; files are one flat dir, untouched
//   the `renova` CMS site (id 1) + its pages/content_blocks/seo_meta/blog
//   competitor research (competitors + metrics/reviews/events/ads)
//   clients, leads (+ messages, conversation tags), tags not already present
//   email_messages (+ the Gmail connection row moves in the control plane)
//   settings: whatsapp_config, research_centre
//   package_templates whose therapy exists in the target; block_outs
// WHAT DOES NOT:
//   the duplicate `inspire` site (id 2) — the user meant to delete it anyway
//   carousel_sets/slides — five "Untitled design" test carousels from May/June
//   video_projects/assets — data/uploads/<projectId> is shared across tenants
//     and Inspire's projects 1–4 (Sep) overwrote Renova's 1–6 (May): dead rows
//   pipeline_stages / therapies — the target has its own, configured
//   users / auth_sessions — legacy pre-control-plane tables
//
// Usage on the container:  cd /app && NODE_PATH=/app/node_modules \
//   DRY_RUN=1 node scripts/merge-renova-into-optimal-health.cjs   (report only)
//   node scripts/merge-renova-into-optimal-health.cjs             (for real)

const Database = require("better-sqlite3");

const SRC = "/app/data/clinic.db";
const TGT = "/app/data/tenants/optimal-health/optimal-health.db";
const CTL = "/app/data/control.db";
const SRC_TENANT_ID = 1;
const TGT_TENANT_ID = 1028;
const RENOVA_SITE_ID = 1;
const DRY = process.env.DRY_RUN === "1";

const src = new Database(SRC, { readonly: true });
const tgt = new Database(TGT);
const ctl = new Database(CTL);
tgt.pragma("busy_timeout = 10000");
ctl.pragma("busy_timeout = 10000");
tgt.pragma("foreign_keys = OFF");

const q = (db, sql, ...p) => db.prepare(sql).all(...p);
const one = (db, sql, ...p) => db.prepare(sql).get(...p);
const cols = (db, table) => db.prepare(`pragma table_info("${table}")`).all().map((c) => c.name);
const count = (db, table) => one(db, `select count(*) n from "${table}"`).n;

const marker = one(tgt, "select value from settings where key = 'merged_from_renova'");
if (marker) {
  console.error("REFUSING: target already carries merged_from_renova:", marker.value);
  process.exit(1);
}

const report = {};

/**
 * Insert `rows` into the target `table`, keeping only columns the target has.
 * keepId: reuse the source id (only when the target table is EMPTY, asserted).
 * patch: per-row rewrite of remapped foreign keys. Returns old id -> new id.
 */
function copy(table, rows, { keepId = false, patch = (r) => r } = {}) {
  const map = new Map();
  if (rows.length === 0) {
    report[table] = 0;
    return map;
  }
  if (keepId && count(tgt, table) !== 0) {
    throw new Error(`${table}: expected empty target to keep ids, has ${count(tgt, table)}`);
  }
  const tcols = new Set(cols(tgt, table));
  const use = Object.keys(rows[0]).filter((k) => tcols.has(k) && (keepId || k !== "id"));
  const stmt = tgt.prepare(
    `insert into "${table}" (${use.map((c) => `"${c}"`).join(",")}) values (${use.map((c) => `@${c}`).join(",")})`,
  );
  for (const raw of rows) {
    const r = patch({ ...raw });
    if (r === null) continue;
    const params = {};
    for (const c of use) params[c] = r[c] === undefined ? null : r[c];
    if (!DRY) {
      const info = stmt.run(params);
      map.set(raw.id, keepId ? raw.id : Number(info.lastInsertRowid));
    } else {
      map.set(raw.id, keepId ? raw.id : -1);
    }
  }
  report[table] = map.size;
  return map;
}

const run = tgt.transaction(() => {
  // 1. Photographs: new ids, same filenames (one flat data/image-library dir).
  const imgMap = copy("image_library_assets", q(src, "select * from image_library_assets order by id"));

  // 2. The old Renova website, verbatim, ids preserved (target has no sites).
  const site = one(src, "select * from sites where id = ?", RENOVA_SITE_ID);
  copy("sites", [site], {
    keepId: true,
    patch: (r) => ({ ...r, name: "Renova Cellular Health (old site)" }),
  });
  copy("pages", q(src, "select * from pages where site_id = ? order by id", RENOVA_SITE_ID), { keepId: true });
  copy("content_blocks", q(src, "select * from content_blocks where site_id = ? order by id", RENOVA_SITE_ID), {
    keepId: true,
    patch: (r) => ({ ...r, media_asset_id: null }),
  });
  copy("seo_meta", q(src, "select * from seo_meta where site_id = ? order by id", RENOVA_SITE_ID), {
    keepId: true,
    patch: (r) => ({ ...r, og_image_asset_id: null }),
  });
  copy("blog_posts", q(src, "select * from blog_posts where site_id = ? order by id", RENOVA_SITE_ID), {
    keepId: true,
    patch: (r) => ({ ...r, source_therapy_id: null, source_video_project_id: null, og_image_asset_id: null }),
  });

  // 3. Competitor research: ids preserved (target empty); source-only columns
  //    (content_scanned_at / content_topics_json / website_uri) fall away.
  copy("competitors", q(src, "select * from competitors order by id"), { keepId: true });
  for (const t of ["competitor_metrics", "competitor_reviews", "competitor_events", "competitor_ads"]) {
    copy(t, q(src, `select * from "${t}" order by id`), { keepId: true });
  }

  // 4. People: the one client, the leads and what hangs off them.
  const clientMap = copy("clients", q(src, "select * from clients order by id"), { keepId: true });

  const tgtTagBySlug = new Map(q(tgt, "select id, slug from tags").map((r) => [r.slug, r.id]));
  const tagMap = new Map();
  const missingTags = [];
  for (const tag of q(src, "select * from tags order by id")) {
    if (tgtTagBySlug.has(tag.slug)) tagMap.set(tag.id, tgtTagBySlug.get(tag.slug));
    else missingTags.push(tag);
  }
  for (const [oldId, newId] of copy("tags", missingTags)) tagMap.set(oldId, newId);

  // Stage ids are identical in both tenants (same 9 roles, same order) — checked.
  const srcStages = q(src, "select id, role from pipeline_stages order by id");
  const tgtStages = q(tgt, "select id, role from pipeline_stages order by id");
  if (JSON.stringify(srcStages) !== JSON.stringify(tgtStages)) throw new Error("pipeline_stages differ");

  const leadMap = copy("leads", q(src, "select * from leads order by id"), {
    patch: (r) => ({ ...r, client_id: r.client_id == null ? null : clientMap.get(r.client_id) ?? null }),
  });
  copy("lead_messages", q(src, "select * from lead_messages order by id"), {
    patch: (r) => (leadMap.has(r.lead_id) ? { ...r, lead_id: leadMap.get(r.lead_id) } : null),
  });
  copy("conversation_tags", q(src, "select * from conversation_tags order by id"), {
    patch: (r) => {
      if (r.owner_type !== "lead" || !leadMap.has(r.owner_id) || !tagMap.has(r.tag_id)) return null;
      return { ...r, owner_id: leadMap.get(r.owner_id), tag_id: tagMap.get(r.tag_id) };
    },
  });

  // 5. The Gmail inbox history (the connection row itself moves in the control plane).
  copy("email_messages", q(src, "select * from email_messages order by id"), {
    keepId: true,
    patch: (r) => ({ ...r, client_id: r.client_id == null ? null : clientMap.get(r.client_id) ?? null }),
  });

  // 6. Settings that only the old tenant had.
  for (const key of ["whatsapp_config", "research_centre"]) {
    const row = one(src, "select value from settings where key = ?", key);
    const exists = one(tgt, "select 1 from settings where key = ?", key);
    if (row && !exists) {
      if (!DRY) tgt.prepare("insert into settings (key, value) values (?, ?)").run(key, row.value);
      report[`settings.${key}`] = 1;
    } else report[`settings.${key}`] = 0;
  }

  // 7. Session bundles, only where the therapy exists under the same name.
  const tgtTherapyByName = new Map(q(tgt, "select id, name from therapies").map((r) => [r.name, r.id]));
  const srcTherapyById = new Map(q(src, "select id, name from therapies").map((r) => [r.id, r.name]));
  const skippedTemplates = [];
  copy("package_templates", q(src, "select * from package_templates order by id"), {
    patch: (r) => {
      const tid = tgtTherapyByName.get(srcTherapyById.get(r.therapy_id));
      if (!tid) {
        skippedTemplates.push(r.name);
        return null;
      }
      return { ...r, therapy_id: tid };
    },
  });
  report.skipped_package_templates = skippedTemplates;
  copy("block_outs", q(src, "select * from block_outs order by id"));

  // 8. The marker that makes this refuse to run twice.
  if (!DRY) {
    tgt
      .prepare("insert into settings (key, value) values ('merged_from_renova', ?)")
      .run(JSON.stringify({ at: new Date().toISOString(), from: SRC, report }));
  }
  report.image_ids_remapped = imgMap.size;
});

const runControl = ctl.transaction(() => {
  const gmail = ctl.prepare("update gmail_connections set tenant_id = ? where tenant_id = ?");
  const domain = ctl.prepare("update site_domains set tenant_id = ? where tenant_id = ? and site_id = ?");
  const retire = ctl.prepare("update tenants set is_active = 0, name = ? where id = ?");
  if (!DRY) {
    report.control_gmail_moved = gmail.run(TGT_TENANT_ID, SRC_TENANT_ID).changes;
    report.control_domains_moved = domain.run(TGT_TENANT_ID, SRC_TENANT_ID, RENOVA_SITE_ID).changes;
    report.control_tenant_retired = retire.run(
      "Renova Cellular Health (retired 2026-09-14, merged into Optimal Health)",
      SRC_TENANT_ID,
    ).changes;
  } else {
    report.control_gmail_moved = one(ctl, "select count(*) n from gmail_connections where tenant_id = ?", SRC_TENANT_ID).n;
    report.control_domains_moved = one(ctl, "select count(*) n from site_domains where tenant_id = ? and site_id = ?", SRC_TENANT_ID, RENOVA_SITE_ID).n;
    report.control_tenant_retired = 1;
  }
});

run();
runControl();
console.log(DRY ? "DRY RUN — nothing written" : "MIGRATED");
console.log(JSON.stringify(report, null, 1));
