import "server-only";

import fs from "node:fs";
import path from "node:path";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById, openTenantDb } from "@/lib/db/tenant";

/**
 * What a business actually holds, and the two things support is asked to do
 * with it: find one person across their records, and remove that person on
 * request.
 *
 * Every read here goes through the tenant's own database, and every write
 * is scoped to one person by id. There is deliberately no "run this SQL"
 * escape hatch: a console that can execute arbitrary statements against a
 * client's data is a console whose audit log means nothing.
 */

export interface DataCount {
  key: string;
  label: string;
  count: number;
}

export interface TenantDataSummary {
  counts: DataCount[];
  dbBytes: number;
  /** Rough size of what this tenant has uploaded, by kind. */
  storage: { key: string; label: string; bytes: number }[];
}

/** One (table, label) pair the Data tab counts. */
const COUNTED: { key: string; label: string; table: string }[] = [
  { key: "clients", label: "Clients and members", table: "clients" },
  { key: "leads", label: "Leads", table: "leads" },
  { key: "appointments", label: "Appointments", table: "appointments" },
  { key: "class_sessions", label: "Class sessions", table: "class_sessions" },
  { key: "sites", label: "Websites", table: "sites" },
  { key: "pages", label: "Pages", table: "pages" },
  { key: "blog_posts", label: "Blog posts", table: "blog_posts" },
  { key: "carousel_sets", label: "Designs", table: "carousel_sets" },
  { key: "campaigns", label: "Campaigns", table: "campaigns" },
  { key: "email_campaigns", label: "Email campaigns", table: "email_campaigns" },
  { key: "forms", label: "Forms", table: "forms" },
  { key: "image_library_assets", label: "Library photos and videos", table: "image_library_assets" },
];

type RawHandle = { prepare: (sql: string) => { get: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[]; run: (...a: unknown[]) => { changes: number } } };

function rawFor(tenantId: number): RawHandle | null {
  try {
    const tdb = getTenantDbById(tenantId);
    return (tdb as unknown as { $client?: RawHandle }).$client ?? null;
  } catch {
    return null;
  }
}

function dbFileFor(tenantId: number): { dbFile: string; absPath: string; slug: string } | null {
  const row = controlSqlite.prepare("SELECT slug, db_file FROM tenants WHERE id = ?").get(tenantId) as
    | { slug: string; db_file: string }
    | undefined;
  if (!row) return null;
  const abs = path.isAbsolute(row.db_file) ? row.db_file : path.join(process.cwd(), "data", row.db_file);
  return { dbFile: row.db_file, absPath: abs, slug: row.slug };
}

export function getTenantData(tenantId: number): TenantDataSummary {
  const raw = rawFor(tenantId);
  const counts: DataCount[] = [];
  for (const c of COUNTED) {
    let n = 0;
    try {
      n = ((raw?.prepare(`SELECT count(*) AS n FROM ${c.table}`).get() as { n: number } | undefined)?.n) ?? 0;
    } catch {
      // A table this tenant's database does not have yet.
      n = 0;
    }
    counts.push({ key: c.key, label: c.label, count: n });
  }

  const file = dbFileFor(tenantId);
  const dbBytes = file && fs.existsSync(file.absPath) ? fs.statSync(file.absPath).size : 0;

  // Uploads are namespaced per tenant on disk. The image library and the
  // renders are single flat folders shared by every tenant, so their per-
  // tenant size has to be summed from THIS tenant's own rows -- see the
  // storage note in the console scope.
  const dataDir = path.join(process.cwd(), "data");
  const uploadsDir = path.join(dataDir, "uploads", String(tenantId));
  const libraryBytes = sumLibraryBytes(raw);

  return {
    counts,
    dbBytes,
    storage: [
      { key: "uploads", label: "Uploads", bytes: dirBytes(uploadsDir) },
      { key: "library", label: "Photo and video library", bytes: libraryBytes },
      { key: "database", label: "Database", bytes: dbBytes },
    ],
  };
}

function dirBytes(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      total += entry.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
    }
  } catch {
    // No such directory: nothing uploaded.
  }
  return total;
}

/**
 * The library is one flat folder shared by every tenant, so a folder
 * measurement would be the fleet's total, not this tenant's. Each row
 * records its own `size_bytes` at upload, which is both this tenant's own
 * figure and one sum rather than a stat() per file.
 */
function sumLibraryBytes(raw: RawHandle | null): number {
  if (!raw) return 0;
  try {
    const row = raw.prepare("SELECT coalesce(sum(size_bytes), 0) AS n FROM image_library_assets").get() as
      | { n: number }
      | undefined;
    return row?.n ?? 0;
  } catch {
    // No library table on this tenant.
    return 0;
  }
}

// ─── Finding one person ──────────────────────────────────────────────────────

export interface PersonHit {
  kind: "client" | "lead";
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: number | null;
}

/**
 * Find someone across clients and leads. For the call that starts "they
 * asked us to delete their data and I cannot find them" -- which is why it
 * searches both, and by any of name, email or phone.
 */
export function findPeople(tenantId: number, query: string): PersonHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const raw = rawFor(tenantId);
  if (!raw) return [];
  const like = `%${q.toLowerCase()}%`;
  const hits: PersonHit[] = [];

  try {
    const rows = raw
      .prepare(
        `SELECT id, first_name, last_name, email, phone, created_at FROM clients
         WHERE lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) LIKE ?
            OR lower(coalesce(email,'')) LIKE ? OR replace(coalesce(phone,''),' ','') LIKE ?
         ORDER BY id DESC LIMIT 25`,
      )
      .all(like, like, like) as Array<{ id: number; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; created_at: number | null }>;
    for (const r of rows) {
      hits.push({
        kind: "client",
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)",
        email: r.email,
        phone: r.phone,
        createdAt: r.created_at,
      });
    }
  } catch {
    // No clients table.
  }

  try {
    const rows = raw
      .prepare(
        `SELECT id, first_name, last_name, email, phone, created_at FROM leads
         WHERE lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) LIKE ?
            OR lower(coalesce(email,'')) LIKE ? OR replace(coalesce(phone,''),' ','') LIKE ?
         ORDER BY id DESC LIMIT 25`,
      )
      .all(like, like, like) as Array<{ id: number; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; created_at: number | null }>;
    for (const r of rows) {
      hits.push({
        kind: "lead",
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "(no name)",
        email: r.email,
        phone: r.phone,
        createdAt: r.created_at,
      });
    }
  } catch {
    // No leads table.
  }

  return hits;
}

export type DataResult = { ok: true; note: string; file?: string } | { ok: false; error: string };

/**
 * Everything this business holds about one person, as JSON. What gets sent
 * when someone exercises a subject access request.
 *
 * Deliberately built from a fixed list of tables with a known person
 * column: a generic "search every table for this id" would happily export
 * another person's row from a table where that number means something else.
 */
const CLIENT_RELATED: { table: string; column: string }[] = [
  { table: "appointments", column: "client_id" },
  { table: "payments", column: "client_id" },
  { table: "sessions", column: "client_id" },
  { table: "session_bookings", column: "client_id" },
  { table: "client_memberships", column: "client_id" },
  { table: "client_packages", column: "client_id" },
  { table: "client_emails", column: "client_id" },
  { table: "client_messages", column: "client_id" },
  { table: "form_submissions", column: "client_id" },
];
const LEAD_RELATED: { table: string; column: string }[] = [
  { table: "lead_messages", column: "lead_id" },
  { table: "voice_call_queue", column: "lead_id" },
  { table: "automation_queue", column: "lead_id" },
];

export function exportPerson(tenantId: number, kind: "client" | "lead", id: number): { ok: true; data: unknown } | { ok: false; error: string } {
  const raw = rawFor(tenantId);
  if (!raw) return { ok: false, error: "Could not reach that database." };
  const table = kind === "client" ? "clients" : "leads";
  let person: unknown;
  try {
    person = raw.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  } catch {
    return { ok: false, error: "Could not read that record." };
  }
  if (!person) return { ok: false, error: "No such person." };

  const related: Record<string, unknown[]> = {};
  for (const r of kind === "client" ? CLIENT_RELATED : LEAD_RELATED) {
    try {
      related[r.table] = raw.prepare(`SELECT * FROM ${r.table} WHERE ${r.column} = ?`).all(id);
    } catch {
      // A table this tenant does not have.
    }
  }
  return { ok: true, data: { exportedAt: new Date().toISOString(), kind, person, related } };
}

/**
 * Remove one person and everything attached to them. Irreversible, so the
 * caller is expected to have taken the export first -- the console offers
 * them in that order for exactly this reason.
 */
export function deletePerson(tenantId: number, kind: "client" | "lead", id: number): DataResult {
  const raw = rawFor(tenantId);
  if (!raw) return { ok: false, error: "Could not reach that database." };
  const table = kind === "client" ? "clients" : "leads";
  const exists = raw.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!exists) return { ok: false, error: "No such person." };

  let removed = 0;
  for (const r of kind === "client" ? CLIENT_RELATED : LEAD_RELATED) {
    try {
      removed += raw.prepare(`DELETE FROM ${r.table} WHERE ${r.column} = ?`).run(id).changes;
    } catch {
      // A table this tenant does not have.
    }
  }
  removed += raw.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes;
  return { ok: true, note: `Deleted the ${kind} and ${removed - 1} related record${removed - 1 === 1 ? "" : "s"}.` };
}

// ─── Backups ─────────────────────────────────────────────────────────────────

/**
 * A consistent copy of the tenant's database, written beside the archives.
 *
 * SQLite's own VACUUM INTO is used rather than a file copy: these databases
 * run in WAL mode, so copying the file alone can catch it mid-transaction
 * and produce a backup that restores to a moment that never existed.
 */
export function backupTenant(tenantId: number): DataResult {
  const file = dbFileFor(tenantId);
  if (!file) return { ok: false, error: "No such business." };
  if (!fs.existsSync(file.absPath)) return { ok: false, error: "That business has no database file." };

  const dir = path.join(process.cwd(), "data", "archive", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(dir, `${file.slug}-${stamp}.db`);

  try {
    const { sqlite } = openTenantDb(file.dbFile);
    // VACUUM INTO refuses to overwrite, which is what we want: a stamped
    // name collides only if two backups start in the same millisecond.
    sqlite.prepare("VACUUM INTO ?").run(out);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The backup failed." };
  }
  const size = fs.existsSync(out) ? fs.statSync(out).size : 0;
  return { ok: true, note: `Backup written (${(size / 1024 / 1024).toFixed(1)} MB).`, file: out };
}

export interface BackupRow {
  name: string;
  bytes: number;
  createdAt: number;
}

/** Backups already taken for this business, newest first. */
export function listBackups(tenantId: number): BackupRow[] {
  const file = dbFileFor(tenantId);
  if (!file) return [];
  const dir = path.join(process.cwd(), "data", "archive", "backups");
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(`${file.slug}-`) && n.endsWith(".db"))
      .map((n) => {
        const st = fs.statSync(path.join(dir, n));
        return { name: n, bytes: st.size, createdAt: st.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}
