import "server-only";

import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

import { controlSqlite } from "./control";

/**
 * Idempotent boot migration for the tenancy swap. Triggered as a side-effect of
 * importing ./control (so it runs before the first login, which only touches the
 * control plane), and guarded to run at most once per process:
 *
 *  1. Register the `renova` tenant pointing at the existing clinic.db.
 *  2. Copy users + auth_sessions from clinic.db into the control plane, stamped
 *     with the renova tenant id (owner becomes platform admin). Only runs when
 *     the control `users` table is still empty — i.e. exactly once.
 *  3. Fresh install (no legacy users): seed the default control admin.
 *
 * Self-contained: depends only on controlSqlite + a direct clinic.db open, so it
 * introduces no import cycle through the tenant resolver. The legacy clinic.db
 * `users`/`auth_sessions` tables are LEFT IN PLACE (orphaned) for rollback.
 */

const RENOVA = {
  slug: "renova",
  name: "Renova Cellular Health",
  dbFile: "clinic.db",
};
const OWNER_EMAIL = "christopher.walshe1994@gmail.com";
const CLINIC_PATH = path.join(process.cwd(), "data", "clinic.db");

// Mirrors lib/auth.ts hashPassword; inlined to avoid an import cycle at boot.
function seedHashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

interface LegacyUser {
  id: number;
  email: string;
  name: string | null;
  password_hash: string;
  role: string;
  must_change_password: number;
  is_active: number;
  last_login_at: number | null;
  created_at: number;
  updated_at: number;
}

interface LegacySession {
  id: string;
  user_id: number;
  expires_at: number;
  created_at: number;
}

let ran = false;

/**
 * Multi-account identity (phase 0): idempotently derive membership rows and the
 * session active-tenant from the legacy users.tenant_id / users.role. Safe to run
 * on every boot — the INSERT is guarded by the UNIQUE(user_id, tenant_id) index,
 * and the UPDATE only stamps sessions that haven't been resolved yet. This is the
 * bridge that keeps single-clinic users working unchanged after the resolver
 * flips onto memberships in a later phase.
 */
function backfillMemberships(): void {
  controlSqlite.exec(`
    INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, is_active)
    SELECT id, tenant_id, role, is_active
    FROM users
    WHERE tenant_id IS NOT NULL;

    UPDATE auth_sessions
    SET active_tenant_id = (
      SELECT tenant_id FROM users WHERE users.id = auth_sessions.user_id
    )
    WHERE active_tenant_id IS NULL;
  `);
}

export function runBootMigration(): void {
  if (ran) return;
  ran = true;
  try {
    // 1. Register the renova tenant (race-safe; slug is UNIQUE).
    controlSqlite
      .prepare(
        "INSERT OR IGNORE INTO tenants (slug, name, db_file) VALUES (?, ?, ?)",
      )
      .run(RENOVA.slug, RENOVA.name, RENOVA.dbFile);
    const renova = controlSqlite
      .prepare("SELECT id FROM tenants WHERE slug = ?")
      .get(RENOVA.slug) as { id: number };

    // 2. Copy identity into the control plane, once.
    const controlUserCount = (
      controlSqlite.prepare("SELECT COUNT(*) AS c FROM users").get() as {
        c: number;
      }
    ).c;
    if (controlUserCount > 0) {
      // Identity already in the control plane (normal boot). Still (re)derive
      // memberships + session active-tenant — idempotent, and the only step that
      // matters once the one-time identity copy is done.
      backfillMemberships();
      return;
    }

    const clinic = new Database(CLINIC_PATH);
    try {
      // A fresh install's clinic.db has no `users` table (the tenant schema no
      // longer creates one). Only the live, pre-swap clinic.db carries one.
      const hasUsers =
        (
          clinic
            .prepare(
              "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='users'",
            )
            .get() as { c: number }
        ).c > 0;
      const legacyUsers = hasUsers
        ? (clinic.prepare("SELECT * FROM users").all() as LegacyUser[])
        : [];
      const hasSessions =
        (
          clinic
            .prepare(
              "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='auth_sessions'",
            )
            .get() as { c: number }
        ).c > 0;
      const legacySessions = hasSessions
        ? (clinic.prepare("SELECT * FROM auth_sessions").all() as LegacySession[])
        : [];

      const insertUser = controlSqlite.prepare(
        `INSERT INTO users
           (id, email, name, password_hash, role, tenant_id, is_platform_admin,
            must_change_password, is_active, last_login_at, created_at, updated_at)
         VALUES (@id, @email, @name, @password_hash, @role, @tenant_id,
            @is_platform_admin, @must_change_password, @is_active, @last_login_at,
            @created_at, @updated_at)`,
      );
      const insertSession = controlSqlite.prepare(
        `INSERT INTO auth_sessions (id, user_id, expires_at, created_at)
         VALUES (@id, @user_id, @expires_at, @created_at)`,
      );

      const copy = controlSqlite.transaction(() => {
        for (const u of legacyUsers) {
          insertUser.run({
            id: u.id,
            email: u.email,
            name: u.name,
            password_hash: u.password_hash,
            role: u.role,
            tenant_id: renova.id,
            is_platform_admin: u.email.toLowerCase() === OWNER_EMAIL ? 1 : 0,
            must_change_password: u.must_change_password,
            is_active: u.is_active,
            last_login_at: u.last_login_at,
            created_at: u.created_at,
            updated_at: u.updated_at,
          });
        }
        for (const s of legacySessions) {
          insertSession.run({
            id: s.id,
            user_id: s.user_id,
            expires_at: s.expires_at,
            created_at: s.created_at,
          });
        }
        return { users: legacyUsers.length, sessions: legacySessions.length };
      })();

      console.log(
        `[migrate] copied identity to control plane: ${copy.users} users, ${copy.sessions} sessions`,
      );

      // Fresh install: seed the default admin into the control plane.
      const stillEmpty =
        (
          controlSqlite.prepare("SELECT COUNT(*) AS c FROM users").get() as {
            c: number;
          }
        ).c === 0;
      if (stillEmpty) {
        controlSqlite
          .prepare(
            `INSERT INTO users
               (email, name, password_hash, role, tenant_id, is_platform_admin, must_change_password)
             VALUES (?, ?, ?, 'admin', ?, 1, 1)`,
          )
          .run(OWNER_EMAIL, "Christopher", seedHashPassword("Renova2026"), renova.id);
        console.log(
          "[migrate] seeded default control admin (fresh install):",
          OWNER_EMAIL,
        );
      }
    } finally {
      clinic.close();
    }

    // Fresh install / first migrated boot: derive memberships from the identity
    // we just copied or seeded.
    backfillMemberships();
  } catch (err) {
    console.error("[migrate] boot migration failed:", err);
    throw err;
  }
}
