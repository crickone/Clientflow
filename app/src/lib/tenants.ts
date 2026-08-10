import "server-only";

import crypto from "node:crypto";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import { eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { memberships, tenants, users, type Tenant } from "@/lib/db/schema";
import { openTenantDb } from "@/lib/db/tenant";
import { hashPassword } from "@/lib/password";
import { createBillingRow } from "@/lib/billing/engine";

/**
 * Tenant registry + provisioning. A tenant is a business with its own SQLite
 * file. Identity (users) lives in the control plane and points back at a tenant
 * via `users.tenant_id`.
 */

export function listTenants(): Tenant[] {
  return controlDb.select().from(tenants).all();
}

export function getTenantBySlug(slug: string): Tenant | undefined {
  return controlDb.select().from(tenants).where(eq(tenants.slug, slug)).get();
}

/**
 * Seed a tenant's business defaults (therapies, settings, core inbox tags).
 * Idempotent — count/IGNORE guarded. NO user is seeded here; users are
 * control-plane (see createTenantAdmin / the boot migration).
 *
 * `venueType` branches the defaults: a clinic gets the therapy catalogue +
 * therapy-oriented inbox tags; a gym gets NO therapies and membership/class
 * oriented tags. The `venue_type` setting drives venue-aware UI downstream.
 */
export function seedTenant(
  sqlite: BetterSqlite3,
  venueType: "clinic" | "gym" = "clinic",
): void {
  if (venueType === "clinic") {
    const therapyCount = (
      sqlite.prepare("SELECT COUNT(*) AS c FROM therapies").get() as { c: number }
    ).c;
    if (therapyCount === 0) {
      const insert = sqlite.prepare(
        "INSERT INTO therapies (name, colour_hex, default_duration_minutes, default_price_eur, description) VALUES (?, ?, ?, ?, ?)",
      );
      const seed: Array<[string, string, number, number, string]> = [
        [
          "HBOT",
          "#58a6ff",
          60,
          95,
          "Hyperbaric Oxygen Therapy — pressurised oxygen for cellular recovery",
        ],
        [
          "Infrared Therapy",
          "#f0883e",
          15,
          65,
          "Full-body infrared bed for circulation, recovery, and detox",
        ],
        [
          "PEMF Therapy",
          "#a855f7",
          30,
          65,
          "PEMF chair — pulsed electromagnetic field therapy for nervous-system regulation",
        ],
      ];
      for (const row of seed) insert.run(...row);
    }
  }

  const setIf = sqlite.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  setIf.run(
    "opening_hours",
    JSON.stringify([
      { dow: 0, closed: true },
      { dow: 1, closed: false, open: "08:00", close: "20:00" },
      { dow: 2, closed: false, open: "08:00", close: "20:00" },
      { dow: 3, closed: false, open: "08:00", close: "20:00" },
      { dow: 4, closed: false, open: "08:00", close: "20:00" },
      { dow: 5, closed: false, open: "08:00", close: "20:00" },
      { dow: 6, closed: false, open: "09:00", close: "16:00" },
    ]),
  );
  setIf.run("slot_length_minutes", "15");
  setIf.run("multi_therapy_concurrent", "true");
  setIf.run("buffer_minutes", "0");
  setIf.run("venue_type", JSON.stringify(venueType));

  const tagCount = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM tags").get() as { c: number }
  ).c;
  if (tagCount === 0) {
    const insertTag = sqlite.prepare(
      "INSERT INTO tags (label, slug, color, is_core) VALUES (?, ?, ?, 1)",
    );
    const coreTags: Array<[string, string, string]> =
      venueType === "gym"
        ? [
            ["Membership", "membership", "#58a6ff"],
            ["Classes", "classes", "#3fb950"],
            ["PT", "pt", "#a855f7"],
            ["Billing", "billing", "#2ed8c3"],
            ["Hours", "hours", "#8b949e"],
            ["Urgent", "urgent", "#f85149"],
            ["Upset", "upset", "#db61a2"],
            ["VIP", "vip", "#d29922"],
          ]
        : [
            ["HBOT", "hbot", "#58a6ff"],
            ["PEMF", "pemf", "#a855f7"],
            ["Infrared", "infrared", "#f0883e"],
            ["Pricing", "pricing", "#2ed8c3"],
            ["Hours", "hours", "#8b949e"],
            ["Booking", "booking", "#3fb950"],
            ["Urgent", "urgent", "#f85149"],
            ["Upset", "upset", "#db61a2"],
            ["VIP", "vip", "#d29922"],
          ];
    for (const [label, slug, color] of coreTags) insertTag.run(label, slug, color);
  }
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  /** Business kind — branches the seeded defaults (see seedTenant). */
  venueType?: "clinic" | "gym";
  /** Platform billing options for the new tenant's billing row. */
  billing?: { exempt?: boolean };
  /**
   * Optional first admin for the tenant. If the email already belongs to an
   * existing identity, that identity is reused and just granted an admin
   * membership (password ignored). For a brand-new email, a password is required.
   */
  admin?: { email: string; password?: string; name?: string };
}

/**
 * Provision a brand-new tenant: register it, create + seed its DB, and
 * optionally create its first admin user. Renova is NOT provisioned this way —
 * it is migrated in place by the boot migration (its db_file is the existing
 * clinic.db).
 */
export function createTenant(input: CreateTenantInput): Tenant {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid tenant slug: ${slug}`);
  }
  if (getTenantBySlug(slug)) {
    throw new Error(`Tenant already exists: ${slug}`);
  }

  const dbFile = `tenants/${slug}/${slug}.db`;
  const tenant = controlDb
    .insert(tenants)
    .values({ slug, name: input.name, dbFile })
    .returning()
    .get();

  // Create + seed the tenant DB.
  const { sqlite } = openTenantDb(dbFile);
  seedTenant(sqlite, input.venueType ?? "clinic");

  // Billing: every provisioned tenant gets a billing row (pending_payment unless
  // exempt). Legacy tenants (e.g. Renova, migrated in place) have no row and so
  // are never gated.
  createBillingRow(tenant.id, { exempt: input.billing?.exempt ?? false });

  if (input.admin) {
    createTenantAdmin(tenant.id, input.admin);
  }

  return tenant;
}

/**
 * Ensure an admin for a tenant: reuse the identity if the email already exists
 * (multi-account — one person can admin several clinics), otherwise create it.
 * Then grant an admin membership (idempotent via the UNIQUE(user_id, tenant_id)
 * index). A password is only needed when creating a new identity.
 * `mustChangePassword` only applies to a brand-new identity — an existing one
 * is never touched here (default false preserves prior callers' behaviour).
 */
export function createTenantAdmin(
  tenantId: number,
  admin: { email: string; password?: string; name?: string; mustChangePassword?: boolean },
): void {
  const email = admin.email.trim().toLowerCase();

  let user = controlDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user) {
    if (!admin.password || admin.password.length < 8) {
      throw new Error(
        "A password (at least 8 characters) is required to create a new admin.",
      );
    }
    user = controlDb
      .insert(users)
      .values({
        email,
        name: admin.name ?? null,
        passwordHash: hashPassword(admin.password),
        // legacy column mirror; membership is the source of truth
        role: "admin",
        isPlatformAdmin: false,
        mustChangePassword: admin.mustChangePassword ?? false,
      })
      .returning({ id: users.id })
      .get();
  }

  controlDb
    .insert(memberships)
    .values({ userId: user.id, tenantId, role: "admin", isActive: true })
    .onConflictDoNothing()
    .run();
}

/** ~12-char URL-safe temp password for a brand-new provisioned identity. */
function generateTempPassword(): string {
  return crypto.randomBytes(9).toString("base64url");
}

export interface TenantAdminResult {
  email: string;
  /** Present only when a brand-new identity was created for this admin. */
  tempPassword?: string;
  /** True when this email already had an identity — membership-only grant. */
  existing: boolean;
  /** True for the first entry in the input list — the tenant's primary owner. */
  owner: boolean;
}

/**
 * Create-or-grant admin access for an ORDERED list of admins on a tenant — the
 * FIRST entry is the owner. For each, in order:
 *  - a brand-new email gets a new identity (generated temp password +
 *    must_change_password, so they're forced to set their own on first
 *    sign-in) plus an admin membership;
 *  - an email that already has an identity is simply granted an admin
 *    membership on this tenant (createTenantAdmin's ON CONFLICT DO NOTHING —
 *    idempotent) — its password is never touched, and no temp password is
 *    generated for it.
 *
 * Callers are responsible for validating/deduping the input list (case-
 * insensitively) first — this just create-or-grants each entry as given.
 * Used by the platform provisioning API so a business can be created with
 * several account admins at once (e.g. the agency + the client's own staff).
 */
export function provisionTenantAdmins(
  tenantId: number,
  admins: Array<{ email: string; name?: string }>,
): TenantAdminResult[] {
  return admins.map((admin, i) => {
    const email = admin.email.trim().toLowerCase();
    const alreadyExists = !!controlDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();

    const tempPassword = alreadyExists ? undefined : generateTempPassword();
    createTenantAdmin(tenantId, {
      email,
      password: tempPassword,
      name: admin.name,
      mustChangePassword: !alreadyExists,
    });

    return { email, tempPassword, existing: alreadyExists, owner: i === 0 };
  });
}
