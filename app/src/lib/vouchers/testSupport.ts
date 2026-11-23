// app/src/lib/vouchers/testSupport.ts
/**
 * Scratch business for the voucher DB tests. Require it with requireLocal
 * AFTER installing the react/next shim (see the plan's DB-test shim), and
 * after setting the STRIPE_* and EMAIL_TOKEN_SECRET env the test needs.
 */
import fs from "node:fs";
import path from "node:path";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { therapies } from "@/lib/db/schema";
import { removeStripeConnection, saveStripeConnection } from "@/lib/stripe/connection";

type FlagRow = { key: string; mode: string; percent: number; allow: string; updated_at: number };

/**
 * A fresh tenant with its own DB, the voucher_store flag on for it alone and
 * a test-mode Stripe account connected. Everything is put back afterwards,
 * including the platform flag row as it was.
 */
export async function withVoucherTenant<T>(slug: string, fn: (tid: number, accountId: string) => Promise<T> | T): Promise<T> {
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Glow Clinic", dbFile) as { id: number };
  const before = controlSqlite.prepare("SELECT * FROM platform_flags WHERE key = 'voucher_store'").get() as FlagRow | undefined;
  controlSqlite
    .prepare(
      `INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES ('voucher_store', 'allow', 100, ?, ?)
       ON CONFLICT(key) DO UPDATE SET mode = 'allow', allow = excluded.allow, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify([id]), Date.now());
  const accountId = `acct_test_${slug.replace(/[^a-z0-9]/g, "")}`;
  try {
    getTenantDbById(id); // opens the DB and runs ensureTenantTables
    saveStripeConnection(id, accountId, false, null);
    return await fn(id, accountId);
  } finally {
    removeStripeConnection(id);
    if (before) {
      controlSqlite
        .prepare("UPDATE platform_flags SET mode = ?, percent = ?, allow = ?, updated_at = ? WHERE key = 'voucher_store'")
        .run(before.mode, before.percent, before.allow, before.updated_at);
    } else {
      controlSqlite.prepare("DELETE FROM platform_flags WHERE key = 'voucher_store'").run();
    }
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(id);
    fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
  }
}

export function seedTherapy(tid: number, name: string, priceEur: number): number {
  const [row] = getTenantDbById(tid)
    .insert(therapies)
    .values({ name, colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: priceEur })
    .returning({ id: therapies.id })
    .all();
  return row!.id;
}
