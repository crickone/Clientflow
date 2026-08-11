// Run: npm test -- src/lib/marketing/suppress.test.ts
//
// Scratch-tenant test for the hard do-not-email gate (Task 6): a real tenant
// row + a real (temp) tenant SQLite file via getTenantDbById, cleaned up in
// `finally` — same pattern as apiKeys.test.ts / tools.marketing.test.ts.
// Covers: suppressions upsert (case-insensitive, idempotent — a repeat call
// is a no-op, not a duplicate row or an error), the contacts.status mapping
// per reason, unsubscribed_at set only for the 'unsubscribed' status, and
// suppressing an email with no matching contact (still writes the
// suppression, just doesn't touch any contacts row).
//
// ./suppress -> @/lib/db/tenant, which imports `cache` from "react" at
// module scope. Under this runner's `--conditions=react-server` (set so
// `import "server-only"` loads outside Next — see scripts/test.mjs), npm's
// real "react" package resolves to its react-server "shared-subset" entry,
// which throws unconditionally ("This entry point is not yet supported
// outside of experimental channels") — a pre-existing environment gap, not
// specific to this file (see tools.marketing.test.ts / tools.sales.test.ts
// for the same shim, needed for the same reason). Stubbed via a dynamic
// `Module._load` override so `cache` becomes a no-op passthrough; installed
// BEFORE requiring anything in the ./suppress -> @/lib/db/tenant chain,
// via `requireLocal` (a static top-level `import` would be hoisted and
// evaluated before this shim runs). @/lib/db/tenant's OTHER "risky" import,
// `cookies` from "next/headers", does NOT need stubbing — it's only ever
// called lazily inside a function body, never at module scope, so merely
// importing it is harmless here (confirmed by tools.marketing.test.ts
// already exercising the same @/lib/db/tenant import path without stubbing
// next/headers).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx compiles .ts to CJS, where top-level await
// is unsupported (same reasoning as contactImport.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { contacts, suppressions } = requireLocal("../db/schema") as typeof import("../db/schema");
  const { suppress } = requireLocal("./suppress") as typeof import("./suppress");

  const slug = "marketing-suppress-test";
  const dbFile = `tenants/${slug}/${slug}.db`;

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Marketing Suppress Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), {
        recursive: true,
        force: true,
      });
    } catch {
      // best effort
    }
  };

  try {
    // getTenantDbById(tid) opens (and creates, incl. contacts/suppressions
    // tables) a fresh tenant SQLite file for this scratch tenant.
    const tdb = getTenantDbById(tid);

    const alice = tdb
      .insert(contacts)
      .values({ email: "Alice@Example.com", status: "subscribed" })
      .returning()
      .get();
    const bob = tdb
      .insert(contacts)
      .values({ email: "bob@example.com", status: "subscribed" })
      .returning()
      .get();
    const cara = tdb
      .insert(contacts)
      .values({ email: "cara@example.com", status: "subscribed" })
      .returning()
      .get();

    // ── unsubscribe: suppressions row (lowercased) + contact flips status + unsubscribedAt set.
    // Called with a DIFFERENT case than the contact's stored email, to prove
    // the match is case-insensitive both ways. ──
    suppress(tid, "ALICE@example.com", "unsubscribe");

    const supRows1 = tdb.select().from(suppressions).all();
    assert.equal(supRows1.length, 1, "one suppressions row written");
    assert.equal(supRows1[0].email, "alice@example.com", "stored lowercased");
    assert.equal(supRows1[0].reason, "unsubscribe");

    const aliceAfter1 = tdb.select().from(contacts).where(eq(contacts.id, alice.id)).get()!;
    assert.equal(aliceAfter1.status, "unsubscribed");
    assert.ok(aliceAfter1.unsubscribedAt != null, "unsubscribedAt is set for 'unsubscribe'");

    // ── idempotency: unsubscribing an already-unsubscribed contact is a no-op
    // — same suppressions row count, status stays 'unsubscribed', no throw. ──
    assert.doesNotThrow(() => suppress(tid, "alice@example.com", "unsubscribe"));
    const supRows2 = tdb.select().from(suppressions).all();
    assert.equal(supRows2.length, 1, "still exactly one suppressions row after a repeat call");
    const aliceAfter2 = tdb.select().from(contacts).where(eq(contacts.id, alice.id)).get()!;
    assert.equal(aliceAfter2.status, "unsubscribed");

    // ── bounce: different reason -> contacts.status='bounced'; unsubscribedAt
    // is NOT set (only 'unsubscribed'/'manual' set it). ──
    suppress(tid, "bob@example.com", "bounce");
    const bobAfter = tdb.select().from(contacts).where(eq(contacts.id, bob.id)).get()!;
    assert.equal(bobAfter.status, "bounced");
    assert.equal(bobAfter.unsubscribedAt, null, "bounce does not set unsubscribedAt");
    assert.equal(tdb.select().from(suppressions).all().length, 2);

    // ── complaint -> contacts.status='complained' ──
    suppress(tid, "cara@example.com", "complaint");
    const caraAfter = tdb.select().from(contacts).where(eq(contacts.id, cara.id)).get()!;
    assert.equal(caraAfter.status, "complained");
    assert.equal(tdb.select().from(suppressions).all().length, 3);

    // ── manual -> maps to 'unsubscribed' too, and sets unsubscribedAt ──
    suppress(tid, "bob@example.com", "manual");
    const bobAfter2 = tdb.select().from(contacts).where(eq(contacts.id, bob.id)).get()!;
    assert.equal(bobAfter2.status, "unsubscribed", "manual maps to 'unsubscribed'");
    assert.ok(bobAfter2.unsubscribedAt != null);
    // bob's email was already suppressed (reason='bounce', ON CONFLICT DO
    // NOTHING) -> still exactly 3 suppressions rows, first reason preserved.
    const supRows3 = tdb.select().from(suppressions).all();
    assert.equal(supRows3.length, 3, "no duplicate suppressions row for an email suppressed twice");
    assert.equal(
      supRows3.find((r) => r.email === "bob@example.com")?.reason,
      "bounce",
      "the FIRST reason recorded wins on a repeat suppression",
    );

    // ── suppressing an email with no matching contact: suppressions row
    // still written, no throw, no contacts row touched. ──
    assert.doesNotThrow(() => suppress(tid, "nobody@example.com", "manual"));
    assert.equal(tdb.select().from(suppressions).all().length, 4);
    assert.equal(tdb.select().from(contacts).all().length, 3, "no phantom contact created");

    // ── blank/whitespace-only email is a safe no-op (nothing inserted) ──
    suppress(tid, "   ", "manual");
    assert.equal(tdb.select().from(suppressions).all().length, 4, "blank email inserts nothing");

    console.log("suppress.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
