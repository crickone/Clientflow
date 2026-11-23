# Voucher Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each business gets a branded online store at `/vouchers` on its own site where customers buy digital gift vouchers (money or one treatment), paid into the business's own Stripe account, delivered as a branded reveal card by email (now or at 09:00 Irish time on a chosen day), and redeemed by staff at booking with balances and a redemption history, behind the `voucher_store` flag.

**Architecture:** A new module `app/src/lib/vouchers/` with one job per file: a pure `model.ts` (rules, dates, money, colourways), `store.ts` (reads and writes), `checkout.ts` (pending order + Stripe Checkout on the connected account), `fulfil.ts` (one conditional-UPDATE claim shared by the webhook and the return page), `email.ts` + `deliver.ts` (branded receipt and gift emails, the ticker's due-gift pass), and `redeem.ts` (taking a voucher at the desk in one transaction). Two public site routes (`/vouchers`, `/v/[token]`) render inside the business's own site chrome; the Stripe webhook routes `kind=voucher` events to the new module and leaves offers untouched.

**Tech Stack:** Next.js 15 App Router, TypeScript, better-sqlite3 + drizzle (hand-written DDL in `lib/db/tenant.ts`), raw-fetch Stripe Connect (`lib/stripe/api.ts`), Resend / Gmail / SMTP via `lib/email.ts`, `node:assert/strict` test scripts run by `npm test -- <file>` from `app/`.

**Spec:** `docs/superpowers/specs/2026-11-23-voucher-store-design.md`

### Deviations from the spec (decided while planning)

1. **Public checkout route path.** The Pay button posts to `/api/voucher-store/checkout`, not `/api/vouchers/checkout`. The middleware opens public API routes by PREFIX (`PUBLIC_API_PREFIXES`, `startsWith`), and `/api/vouchers/<code>` is the staff-only code lookup; a separate prefix keeps the public surface explicit.
2. **`gift_vouchers.kind`** (`amount` | `treatment`, default `amount`) is added alongside the spec's new columns, so the desk can tell a treatment voucher from a money voucher without joining its order. Every existing and desk-made voucher stays `amount`.
3. **`voucher_orders` gains `site_id`, `site_url` and status `failed`.** `site_url` is the site root the buyer was on (their own domain in production), so emails the ticker sends weeks later link to the right place; `failed` marks a checkout Stripe would not open, as `offer_orders` does.
4. **`voucher_store` setting gains `bookUrl`** (optional). "Book with this voucher" goes there; blank means the business's phone (Optimal Health) and then its email.
5. **The card's colourway is stored as JSON colours**, not an id, on the order and the voucher, so a voucher never changes colour when the brand palette changes.
6. **Delivery status is automatic.** "Mark delivery failed/resent" is shown as the order's state (sent, scheduled, failed with the reason); staff actions are Resend and Change recipient email. A failed gift is NOT retried by the ticker (no email a minute to a bad address); staff press Resend.
7. **Platform-sender fallback also covers a failing business sender**, not only a missing one, so a paid voucher is never left undelivered. Limited to these two emails.
8. **Package sales.** Selling a package with a voucher also writes a `voucher_redemptions` row (keeps balance = value - redemptions true) and refuses cancelled and treatment vouchers. Its existing "expired" refusal is left as it is; the expired-is-a-warning rule applies at booking, which is what the spec names.
9. **`/vouchers/[code]` becomes the staff voucher detail page** (it was already behind the staff login, styled as a Renova reveal page). Its demo-code path is removed.
10. **No Stripe mock exists in the repo** (only the `STRIPE_API_BASE` hook). Tests stub `globalThis.fetch` and point `STRIPE_API_BASE` at a dead host.
11. **Staff-made vouchers** get the business's own code prefix (was a hard-coded `RCH-`) and a 5-year default expiry (was 1 year, below the legal floor).

## Global Constraints

- **NO emojis.** Never in UI, code, comments, copy, logs, commits or docs. Use a `lucide-react` icon where a glyph is needed.
- **Site chrome rule:** every page the platform renders for a tenant wears THAT tenant's own chrome: its stylesheet, navbar and footer via `src/lib/cms/siteChrome.ts`, never a hardcoded palette. `/vouchers` and `/v/<token>` render `getSiteChrome(...)` head, header, footer and tail; the only colours the platform sets there are the card's and the Pay/Book buttons', taken from the business's own colourway.
- **5-year minimum expiry:** expiry = purchase date + the business's setting, which can never be below 5 years (Consumer Rights Act 2022). Enforced in `validateStoreSettings`, `parseStoreSettings` and `expiryDate`.
- **No platform fee:** no `application_fee_amount` (or any `application_fee*` field) on any Checkout Session. The business keeps everything except Stripe's own fee.
- **One voucher per checkout:** one line item, `quantity: 1`.
- **Delivery time:** a dated gift email goes at 09:00 Europe/Dublin on the chosen day (DST-safe, `dublinTimeToUtc`), or at once when no date is chosen.
- **Flag:** `voucher_store` in `MODULE_CATALOG` with `defaultRollout: "none"` and `paths: ["/vouchers/store"]`.
- **Plain copy:** short factual sentences, sentence case, no filler. Copy is word for word as written in this plan.
- **Controls never cramped:** dropdowns have at least 36px right padding with the chevron 12px from the edge; buttons at least 16px horizontal padding; tap targets at least 44px tall on the public pages.
- **Explicit tenant on public paths:** public routes resolve the site from the host (`resolvePublicSite`) and enter `runWithTenant(site.tenantId, ...)` before any `db` read. Never trust a tenant from the request body; the store token is signed.
- **Tests:** plain `node:assert/strict` scripts, run from `app/` with `npm test -- <file>`. DB tests install the `react` / `next/navigation` `Module._load` shim before any `requireLocal(...)`, use a scratch tenant via `withVoucherTenant`, and never touch the network.
- **Git:** never `git add -A` or `git add .`. Add the named files only. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Production:** deploy with `voucher_store` off. Switching it on for Optimal Health (tenant 1028), the live EUR 25 purchase and refund, and repointing their site links happen only after the user says yes (Task 11).

## File map

| File | Responsibility |
|---|---|
| `app/src/lib/vouchers/model.ts` | Pure rules: settings, amounts, Irish dates, money split, codes, colourways, order validation, labels |
| `app/src/lib/vouchers/store.ts` | Settings, orders, vouchers, redemptions, delivery claims (ambient `db`) |
| `app/src/lib/vouchers/storeToken.ts` | Signed store token, site root URL |
| `app/src/lib/vouchers/checkout.ts` | `startVoucherCheckout` |
| `app/src/lib/vouchers/email.ts` | Brand, renderers, `sendVoucherEmail` with the platform fallback |
| `app/src/lib/vouchers/deliver.ts` | `deliverGift`, `sendReceipt`, `dispatchDueVoucherGifts`, `resendVoucherEmails` |
| `app/src/lib/vouchers/fulfil.ts` | `fulfilVoucherCheckout`, `expireVoucherOrder`, `refundVoucherOrder` |
| `app/src/lib/vouchers/redeem.ts` | `lookupVoucher`, `recordVoucherUse`, `redeemAtBooking` |
| `app/src/lib/vouchers/testSupport.ts` | Scratch business for DB tests |
| `app/src/app/api/voucher-store/checkout/route.ts` | Public Pay button endpoint |
| `app/src/app/site/[siteSlug]/vouchers/page.tsx` | Public store + thank-you |
| `app/src/app/site/[siteSlug]/v/[token]/page.tsx` | Public gift page + print |
| `app/src/components/vouchers/RevealCard.tsx` | The foil card (generalised from `HolographicCard`) |
| `app/src/components/vouchers/VoucherBuilder.tsx` | The store's builder (client) |
| `app/src/components/vouchers/PrintButton.tsx` | Print on the gift page |
| `app/src/app/vouchers/store/page.tsx`, `actions.ts` | Admin: Products > Vouchers > Online store |
| `app/src/components/vouchers/StoreSettingsForm.tsx` | The settings form |
| `app/src/app/vouchers/[code]/page.tsx`, `actions.ts` | Staff voucher detail, Resend, change email |
| `app/src/components/vouchers/VoucherDeliveryActions.tsx` | Resend + change email controls |

Modified: `lib/features.ts`, `lib/db/schema.ts`, `lib/db/tenant.ts`, `middleware.ts`, `middleware.test.ts`, `app/api/stripe/webhook/route.ts`, `lib/dispatch/ticker.ts`, `app/api/appointments/route.ts`, `app/appointments/actions.ts`, `app/packages/actions.ts`, `app/api/vouchers/[code]/route.ts`, `components/appointments/BookingForm.tsx`, `components/vouchers/VoucherList.tsx`, `components/vouchers/NewVoucherForm.tsx`, `app/vouchers/page.tsx`, `app/vouchers/actions.ts`, `app/vouchers/[code]/CopyButton.tsx`, `app/vouchers/[code]/email/route.ts`. Deleted: `app/vouchers/[code]/HolographicCard.tsx`, `lib/voucherEmail.ts`. Site source (Task 11, after the user agrees): `sites/optimal-health/build.mjs`, `sites/optimal-health/pages/pricing.html`.

### The DB-test shim (every DB test in this plan starts with it)

```ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
```

---

### Task 1: Flag `voucher_store` and the data

**Files:**
- Modify: `app/src/lib/features.ts` (the `MODULE_CATALOG` array, after the `adonis_map` entry)
- Modify: `app/src/lib/db/schema.ts` (`giftVouchers`, and after `export type OfferOrder`)
- Modify: `app/src/lib/db/tenant.ts` (`ensureTenantTables`, right after the DIY-training `addColumn` block)
- Create: `app/src/lib/vouchers/testSupport.ts`
- Test: `app/src/lib/vouchers/schema.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - Flag key `"voucher_store"`, path `/vouchers/store`.
  - Drizzle tables `voucherOrders`, `voucherRedemptions`; types `VoucherOrder`, `VoucherRedemption`.
  - New `giftVouchers` fields: `source: "staff" | "online"`, `kind: "amount" | "treatment"`, `voucherOrderId: number | null`, `message: string | null`, `colourway: string | null` (JSON), `viewToken: string | null` (unique when set), `cancelledAt: number | null`.
  - `withVoucherTenant<T>(slug: string, fn: (tid: number, accountId: string) => Promise<T> | T): Promise<T>` and `seedTherapy(tid: number, name: string, priceEur: number): number` (testSupport.ts).

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/vouchers/schema.test.ts`:

```ts
// Run: npm test -- src/lib/vouchers/schema.test.ts
//
// The voucher store's data: the flag (off for everyone until switched on),
// the two new tables, and the new gift_vouchers columns with the unique
// gift-page token.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { MODULE_CATALOG, moduleForPath } = requireLocal("../features") as typeof import("../features");
  const { listPlatformFlags } = requireLocal("../platform/flags") as typeof import("../platform/flags");
  const { getTenantDbById, openTenantDb } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { withVoucherTenant } = requireLocal("./testSupport") as typeof import("./testSupport");

  const flag = MODULE_CATALOG.find((m) => m.key === "voucher_store");
  assert.ok(flag, "voucher_store is in the module catalog");
  assert.equal(flag.defaultRollout, "none", "off for every business until switched on");
  assert.deepEqual(flag.paths, ["/vouchers/store"]);
  assert.equal(moduleForPath("/vouchers/store")?.key, "voucher_store", "the store settings page is the store's");
  assert.equal(moduleForPath("/vouchers")?.key, "products", "the voucher list stays with products");

  await withVoucherTenant("voucher-schema-test", (tid) => {
    const on = listPlatformFlags().find((f) => f.key === "voucher_store");
    assert.ok(on && on.mode === "allow" && on.allow.includes(tid), "the test switched it on for this business only");

    const tdb = getTenantDbById(tid);
    const { sqlite } = openTenantDb("tenants/voucher-schema-test/voucher-schema-test.db");
    const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ["source", "kind", "voucher_order_id", "message", "colourway", "view_token", "cancelled_at"]) {
      assert.ok(cols("gift_vouchers").includes(c), `gift_vouchers.${c}`);
    }
    for (const c of ["kind", "value_cents", "deliver_to", "deliver_on", "stripe_session_id", "site_url", "delivered_at", "delivery_error", "gift_voucher_id"]) {
      assert.ok(cols("voucher_orders").includes(c), `voucher_orders.${c}`);
    }
    assert.deepEqual(cols("voucher_redemptions"), ["id", "voucher_id", "amount_eur", "appointment_id", "payment_id", "redeemed_by_user_id", "created_at"]);

    const v = { purchaserName: "Sean", valueEur: 50, balanceEur: 50, purchaseDate: "2026-11-23", expiryDate: "2031-11-23" };
    const [a] = tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-AAAA" }).returning().all();
    assert.equal(a!.source, "staff", "an existing or desk-made voucher is a staff one");
    assert.equal(a!.kind, "amount");
    tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-BBBB", viewToken: "tok_1" }).run();
    assert.throws(() => tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-CCCC", viewToken: "tok_1" }).run(), /UNIQUE/, "a gift-page token is never reused");
    tdb.insert(schema.giftVouchers).values({ ...v, code: "GC-2026-DDDD" }).run(); // many without a token is fine
  });

  console.log("vouchers schema: flag, tables and columns in place");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/vouchers/schema.test.ts`
Expected: FAIL with `Cannot find module './testSupport'`.

- [ ] **Step 3: Add the flag**

In `app/src/lib/features.ts`, replace:

```ts
  { key: "adonis_map", label: "Adonis business map", blurb: "Adonis reads people, bookings, memberships, packages, orders and messages as one connected map.", paths: [], defaultRollout: "none" },
```

with:

```ts
  { key: "adonis_map", label: "Adonis business map", blurb: "Adonis reads people, bookings, memberships, packages, orders and messages as one connected map.", paths: [], defaultRollout: "none" },
  { key: "voucher_store", label: "Online voucher store", blurb: "Gift vouchers sold on the business's own website, paid into its own Stripe.", paths: ["/vouchers/store"], defaultRollout: "none" },
```

- [ ] **Step 4: Add the schema**

In `app/src/lib/db/schema.ts`, replace:

```ts
  purchaseDate: text("purchase_date").notNull(),
  expiryDate: text("expiry_date").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const payments = sqliteTable(
```

with:

```ts
  purchaseDate: text("purchase_date").notNull(),
  expiryDate: text("expiry_date").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  /** "staff" = made at the desk; "online" = bought in the voucher store (lib/vouchers). */
  source: text("source", { enum: ["staff", "online"] }).notNull().default("staff"),
  /** "amount" = money with a balance; "treatment" = one session of therapy_id, then used up. */
  kind: text("kind", { enum: ["amount", "treatment"] }).notNull().default("amount"),
  voucherOrderId: integer("voucher_order_id"),
  message: text("message"),
  /** The card's colours (lib/vouchers/model Colourway) as JSON. */
  colourway: text("colourway"),
  /** The unguessable /v/<token> link. Unique when set (partial index in tenant.ts). */
  viewToken: text("view_token"),
  cancelledAt: integer("cancelled_at"),
});

export const payments = sqliteTable(
```

Then:

In `app/src/lib/db/schema.ts`, replace:

```ts
export type OfferOrder = typeof offerOrders.$inferSelect;
```

with:

```ts
export type OfferOrder = typeof offerOrders.$inferSelect;

/**
 * A gift voucher bought in the business's online store (lib/vouchers). One
 * voucher per order. `colourway` is the card's colours as JSON, kept so a
 * voucher never changes colour when the brand palette does. `site_url` is
 * the site the buyer was on (its own domain in production), so emails sent
 * later by the ticker link back to the right place.
 */
export const voucherOrders = sqliteTable("voucher_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["amount", "treatment"] }).notNull(),
  valueCents: integer("value_cents").notNull(),
  therapyId: integer("therapy_id").references(() => therapies.id, { onDelete: "set null" }),
  buyerName: text("buyer_name").notNull(),
  buyerEmail: text("buyer_email").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientEmail: text("recipient_email"),
  fromName: text("from_name").notNull(),
  message: text("message"),
  colourway: text("colourway").notNull(),
  deliverTo: text("deliver_to", { enum: ["buyer", "recipient"] }).notNull(),
  /** YYYY-MM-DD (sent at 09:00 Irish time that day), or null for at once. */
  deliverOn: text("deliver_on"),
  status: text("status", { enum: ["pending", "paid", "expired", "refunded", "failed"] }).notNull().default("pending"),
  stripeAccountId: text("stripe_account_id").notNull(),
  stripeSessionId: text("stripe_session_id").unique(),
  paymentIntentId: text("payment_intent_id"),
  giftVoucherId: integer("gift_voucher_id").references(() => giftVouchers.id, { onDelete: "set null" }),
  siteId: integer("site_id"),
  siteUrl: text("site_url").notNull(),
  deliveredAt: integer("delivered_at"),
  deliveryError: text("delivery_error"),
  createdAt: integer("created_at").notNull(),
  paidAt: integer("paid_at"),
});
export type VoucherOrder = typeof voucherOrders.$inferSelect;

/** One use of a voucher. balance_eur on the voucher is its value less the sum of these. */
export const voucherRedemptions = sqliteTable("voucher_redemptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  voucherId: integer("voucher_id").notNull().references(() => giftVouchers.id, { onDelete: "cascade" }),
  amountEur: real("amount_eur").notNull(),
  appointmentId: integer("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
  paymentId: integer("payment_id").references(() => payments.id, { onDelete: "set null" }),
  redeemedByUserId: integer("redeemed_by_user_id"),
  createdAt: integer("created_at").notNull(),
});
export type VoucherRedemption = typeof voucherRedemptions.$inferSelect;
```

- [ ] **Step 5: Add the DDL**

The new block goes right after the DIY-training `addColumn` block and before the `// Dashboard slice 2` comment. It is deliberately not wrapped in a swallowing try/catch.

In `app/src/lib/db/tenant.ts`, replace:

```ts
    addColumn("program_enrolments", "assigned_at", "assigned_at INTEGER");
  }
```

with:

```ts
    addColumn("program_enrolments", "assigned_at", "assigned_at INTEGER");
  }

  // The online voucher store (lib/vouchers). Not wrapped in a swallowing
  // try/catch, for the reason given above the DIY training block: every
  // drizzle select on gift_vouchers names the new columns, so a failed ALTER
  // must fail the open rather than leave a cached connection without them.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS voucher_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('amount', 'treatment')),
      value_cents INTEGER NOT NULL,
      therapy_id INTEGER REFERENCES therapies(id) ON DELETE SET NULL,
      buyer_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      recipient_email TEXT,
      from_name TEXT NOT NULL,
      message TEXT,
      colourway TEXT NOT NULL,
      deliver_to TEXT NOT NULL CHECK (deliver_to IN ('buyer', 'recipient')),
      deliver_on TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      stripe_account_id TEXT NOT NULL,
      stripe_session_id TEXT UNIQUE,
      payment_intent_id TEXT,
      gift_voucher_id INTEGER REFERENCES gift_vouchers(id) ON DELETE SET NULL,
      site_id INTEGER,
      site_url TEXT NOT NULL,
      delivered_at INTEGER,
      delivery_error TEXT,
      created_at INTEGER NOT NULL,
      paid_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_voucher_orders_pi ON voucher_orders(payment_intent_id);
    CREATE INDEX IF NOT EXISTS idx_voucher_orders_delivery ON voucher_orders(status, deliver_to, delivered_at);
    CREATE TABLE IF NOT EXISTS voucher_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL REFERENCES gift_vouchers(id) ON DELETE CASCADE,
      amount_eur REAL NOT NULL,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
      redeemed_by_user_id INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_voucher ON voucher_redemptions(voucher_id, created_at);
  `);
  {
    const giftCols = sqlite.prepare("PRAGMA table_info(gift_vouchers)").all() as Array<{ name: string }>;
    const addGiftColumn = (column: string, ddl: string) => {
      if (giftCols.length && !giftCols.some((c) => c.name === column)) sqlite.exec(`ALTER TABLE gift_vouchers ADD COLUMN ${ddl}`);
    };
    addGiftColumn("source", "source TEXT NOT NULL DEFAULT 'staff'");
    addGiftColumn("kind", "kind TEXT NOT NULL DEFAULT 'amount'");
    addGiftColumn("voucher_order_id", "voucher_order_id INTEGER");
    addGiftColumn("message", "message TEXT");
    addGiftColumn("colourway", "colourway TEXT");
    addGiftColumn("view_token", "view_token TEXT");
    addGiftColumn("cancelled_at", "cancelled_at INTEGER");
    sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_vouchers_view_token ON gift_vouchers(view_token) WHERE view_token IS NOT NULL");
  }
```

- [ ] **Step 6: Write the test support**

Create `app/src/lib/vouchers/testSupport.ts`:

```ts
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
```

- [ ] **Step 7: Run the tests and make sure they pass**

Run: `cd app && npm test -- src/lib/vouchers/schema.test.ts`
Expected: PASS, printing `vouchers schema: flag, tables and columns in place`.

Run: `cd app && npm test -- src/lib/features.test.ts` and `cd app && npm test -- src/lib/platform/flags.test.ts`
Expected: both PASS (the new module owns a path, so the "no pages" check is untouched).

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/features.ts app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/vouchers/testSupport.ts app/src/lib/vouchers/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(vouchers): voucher_store flag, voucher_orders, voucher_redemptions, gift voucher columns

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The pure model

**Files:**
- Create: `app/src/lib/vouchers/model.ts`
- Test: `app/src/lib/vouchers/model.test.ts`

**Interfaces:**
- Consumes: nothing (no imports at all; the client builder imports this file).
- Produces (exact names used by later tasks):
  - Constants: `MIN_EXPIRY_YEARS = 5`, `MAX_EXPIRY_YEARS`, `MIN_VOUCHER_EUR`, `MAX_VOUCHER_EUR`, `MAX_PRESET_AMOUNTS`, `MAX_INTRO`, `MAX_MESSAGE`, `MAX_NAME`, `DELIVERY_HOUR = 9`, `CODE_ALPHABET`, `DEFAULT_STORE_SETTINGS`.
  - Types: `VoucherKind = "amount" | "treatment"`, `DeliverTo = "buyer" | "recipient"`, `VoucherStoreSettings { enabled; amounts: number[]; allowCustom; customMin; customMax; therapyIds: number[]; intro; expiryYears; bookUrl }`, `Checked<T>`, `PaymentSplit { voucherEur; remainderEur; redemptionEur }`, `VoucherState = "active" | "part_used" | "used" | "expired" | "cancelled"`, `Colourway { id; name; base; base2; foil: [string, string, string]; ink }`, `OrderDraft`, `OrderDraftField = keyof OrderDraft`, `ValidOrder`, `StoreTreatment { id; name; priceEur }`, `OrderContext`, `OrderCheck`, `DeliveryInfo { label; tone: "green" | "amber" | "red" }`.
  - Functions: `parseStoreSettings(raw: unknown): VoucherStoreSettings`, `parseAmountList(text: string): number[] | null`, `validateStoreSettings(draft: VoucherStoreSettings): Checked<VoucherStoreSettings>`, `checkAmount(s, euros: number | null): string | null`, `isYmd`, `dublinDate(ms): string`, `addMonths`, `addYears`, `expiryDate(purchaseDate, years): string`, `latestDeliveryDate(today): string`, `dublinTimeToUtc(date, hour): number`, `deliveryTime(deliverOn, paidAtMs): number`, `isDeliveryDue(deliverOn, now): boolean`, `formatLongDate(date): string`, `toCents`, `formatEuro(eur): string`, `balanceFrom(valueEur, redemptionsEur): number`, `splitPayment(v: { kind; balanceEur }, priceEur, treatmentPriceEur?): PaymentSplit`, `voucherState(v, today): VoucherState`, `codePrefix(businessName): string`, `formatCode(prefix, year, picks): string`, `normaliseCode(input): string`, `contrast(a, b): number`, `colourways(palette: readonly string[]): Colourway[]`, `findColourway(list, id)`, `parseColourway(json)`, `parseOrderDraft(raw: unknown): OrderDraft`, `isEmail(s)`, `validateOrder(draft: OrderDraft, ctx: OrderContext): OrderCheck`, `voucherTitle({ kind, valueEur, therapyName }): string`, `balanceLabel({ kind, valueEur, balanceEur }): string`, `deliveryStatus(order): DeliveryInfo`.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/vouchers/model.test.ts`:

```ts
// Run: npm test -- src/lib/vouchers/model.test.ts
import assert from "node:assert/strict";

import {
  DEFAULT_STORE_SETTINGS,
  addMonths,
  balanceFrom,
  balanceLabel,
  checkAmount,
  codePrefix,
  colourways,
  contrast,
  deliveryStatus,
  deliveryTime,
  dublinDate,
  dublinTimeToUtc,
  expiryDate,
  findColourway,
  formatCode,
  formatEuro,
  formatLongDate,
  isDeliveryDue,
  latestDeliveryDate,
  normaliseCode,
  parseAmountList,
  parseColourway,
  parseOrderDraft,
  parseStoreSettings,
  splitPayment,
  validateOrder,
  validateStoreSettings,
  voucherState,
  voucherTitle,
  type OrderDraft,
  type VoucherStoreSettings,
} from "./model";

// ── settings: the 5-year floor and the amount bounds ──────────────────────
const base: VoucherStoreSettings = { ...DEFAULT_STORE_SETTINGS, enabled: true, amounts: [50, 25, 100, 50], therapyIds: [3] };
const saved = validateStoreSettings(base);
assert.ok(saved.ok);
assert.deepEqual(saved.ok && saved.value.amounts, [25, 50, 100], "sorted, no repeats");
for (const years of [0, 1, 4]) {
  const r = validateStoreSettings({ ...base, expiryYears: years });
  assert.ok(!r.ok && /at least 5 years/.test(r.error), `${years} years is refused`);
}
assert.ok(validateStoreSettings({ ...base, expiryYears: 5 }).ok, "5 years is the floor");
assert.ok(!validateStoreSettings({ ...base, expiryYears: 4.5 }).ok, "whole years only");
assert.equal(parseStoreSettings({ expiryYears: 2 }).expiryYears, 5, "a stored value under the floor reads back as 5");
assert.equal(parseStoreSettings({ expiryYears: 7 }).expiryYears, 7);
assert.equal(parseStoreSettings(null).enabled, false, "unset means off");
assert.deepEqual(parseStoreSettings({ amounts: [10, "x", 3, 10, 5000] }).amounts, [10], "junk amounts are dropped");
assert.ok(!validateStoreSettings({ ...base, amounts: [25.5] }).ok, "whole euros");
assert.ok(!validateStoreSettings({ ...base, amounts: [1] }).ok, "not under EUR 5");
assert.ok(!validateStoreSettings({ ...base, customMin: 100, customMax: 50 }).ok, "max under min");
assert.ok(!validateStoreSettings({ ...base, intro: "x".repeat(201) }).ok, "intro is capped");
assert.ok(!validateStoreSettings({ ...base, bookUrl: "javascript:alert(1)" }).ok, "booking link must be http(s)");
assert.ok(!validateStoreSettings({ ...base, amounts: [], allowCustom: false, therapyIds: [] }).ok, "nothing for sale cannot be switched on");
assert.ok(validateStoreSettings({ ...base, enabled: false, amounts: [], allowCustom: false, therapyIds: [] }).ok, "but can be saved switched off");
assert.deepEqual(parseAmountList("25, 50 €100"), [25, 50, 100]);
assert.equal(parseAmountList("25, fifty"), null);

const s = parseStoreSettings({ amounts: [25, 50], allowCustom: true, customMin: 30, customMax: 300 });
assert.equal(checkAmount(s, 25), null, "a preset is fine even under the custom minimum");
assert.equal(checkAmount(s, 30), null);
assert.equal(checkAmount(s, 300), null);
assert.match(checkAmount(s, 29) ?? "", /lowest amount is €30/);
assert.match(checkAmount(s, 301) ?? "", /highest amount is €300/);
assert.match(checkAmount(s, 40.5) ?? "", /whole euros/);
assert.match(checkAmount({ ...s, allowCustom: false }, 40) ?? "", /one of the amounts/);
assert.match(checkAmount(s, null) ?? "", /Choose an amount/);

// ── dates ─────────────────────────────────────────────────────────────────
assert.equal(expiryDate("2026-11-23", 5), "2031-11-23");
assert.equal(expiryDate("2026-11-23", 2), "2031-11-23", "never under 5 years");
assert.equal(expiryDate("2028-02-29", 5), "2033-02-28", "29 February becomes the 28th");
assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
assert.equal(latestDeliveryDate("2026-11-23"), "2027-11-23");
assert.equal(formatLongDate("2031-11-23"), "23 November 2031");
assert.equal(dublinDate(Date.UTC(2026, 6, 1, 23, 30)), "2026-07-02", "half eleven UTC in July is past midnight in Ireland");

// 09:00 Irish time, either side of the clock changes.
assert.equal(dublinTimeToUtc("2027-01-15", 9), Date.UTC(2027, 0, 15, 9), "winter: 09:00 is 09:00 UTC");
assert.equal(dublinTimeToUtc("2027-07-15", 9), Date.UTC(2027, 6, 15, 8), "summer: 09:00 is 08:00 UTC");
assert.equal(dublinTimeToUtc("2027-03-28", 9), Date.UTC(2027, 2, 28, 8), "the morning the clocks go forward");
assert.equal(dublinTimeToUtc("2027-03-27", 9), Date.UTC(2027, 2, 27, 9), "the day before");
assert.equal(dublinTimeToUtc("2027-10-31", 9), Date.UTC(2027, 9, 31, 9), "the morning the clocks go back");
assert.equal(dublinTimeToUtc("2027-10-30", 9), Date.UTC(2027, 9, 30, 8), "the day before");
assert.equal(deliveryTime(null, 1234), 1234, "no date: at once");
assert.equal(deliveryTime("2027-07-15", 1234), Date.UTC(2027, 6, 15, 8));
assert.equal(isDeliveryDue("2027-07-15", Date.UTC(2027, 6, 15, 7, 59)), false);
assert.equal(isDeliveryDue("2027-07-15", Date.UTC(2027, 6, 15, 8)), true);
assert.equal(isDeliveryDue(null, 0), true);

// ── money: balance and the split at the desk ──────────────────────────────
assert.equal(formatEuro(50), "€50");
assert.equal(formatEuro(12.5), "€12.50");
assert.equal(balanceFrom(50, [20, 10.1]), 19.9);
assert.equal(balanceFrom(50, [60]), 0, "never below nothing");
assert.deepEqual(splitPayment({ kind: "amount", balanceEur: 50 }, 80), { voucherEur: 50, remainderEur: 30, redemptionEur: 50 }, "money voucher short of the price");
assert.deepEqual(splitPayment({ kind: "amount", balanceEur: 50 }, 30), { voucherEur: 30, remainderEur: 0, redemptionEur: 30 }, "money voucher keeps its change");
assert.deepEqual(splitPayment({ kind: "amount", balanceEur: 0.1 + 0.2 }, 0.3), { voucherEur: 0.3, remainderEur: 0, redemptionEur: 0.3 }, "cents, not floats");
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: 70 }, 80, 80), { voucherEur: 80, remainderEur: 0, redemptionEur: 70 }, "treatment at today's price, voucher used up");
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: 70 }, 110, 80), { voucherEur: 80, remainderEur: 30, redemptionEur: 70 }, "an extra on the same booking is paid separately");

const today = "2026-11-23";
assert.equal(voucherState({ valueEur: 50, balanceEur: 50, expiryDate: "2031-11-23", cancelledAt: null }, today), "active");
assert.equal(voucherState({ valueEur: 50, balanceEur: 20, expiryDate: "2031-11-23", cancelledAt: null }, today), "part_used");
assert.equal(voucherState({ valueEur: 50, balanceEur: 0, expiryDate: "2031-11-23", cancelledAt: null }, today), "used");
assert.equal(voucherState({ valueEur: 50, balanceEur: 50, expiryDate: "2026-11-22", cancelledAt: null }, today), "expired");
assert.equal(voucherState({ valueEur: 50, balanceEur: 50, expiryDate: "2031-11-23", cancelledAt: 1 }, today), "cancelled");
assert.equal(voucherTitle({ kind: "amount", valueEur: 50, therapyName: null }), "€50");
assert.equal(voucherTitle({ kind: "treatment", valueEur: 80, therapyName: "Swedish massage" }), "Swedish massage");
assert.equal(balanceLabel({ kind: "amount", valueEur: 50, balanceEur: 20 }), "€20 left");
assert.equal(balanceLabel({ kind: "treatment", valueEur: 80, balanceEur: 80 }), "Not used yet");
assert.equal(balanceLabel({ kind: "treatment", valueEur: 80, balanceEur: 0 }), "Used");

// ── codes ─────────────────────────────────────────────────────────────────
assert.equal(codePrefix("Optimal Health & Recovery at Inspire"), "OH");
assert.equal(codePrefix("Inspire Health and Fitness"), "IH");
assert.equal(codePrefix("Renova"), "RG");
assert.equal(codePrefix(""), "GV");
assert.equal(formatCode("OH", 2026, [3, 17, 0, 31]), "OH-2026-DTA9");
assert.equal(normaliseCode("  oh-2026-dta9 "), "OH-2026-DTA9");

// ── colourways: pure, deterministic, readable ────────────────────────────
const oh = ["#2f4a3a", "#f4efe6", "#c9a24c", "#1b1b1b"];
const a = colourways(oh);
assert.deepEqual(colourways(oh), a, "same palette, same cards");
assert.deepEqual(a.map((c) => c.id), ["signature", "night", "pale", "duo"], "a second colour far round the wheel adds a two-tone card");
assert.equal(colourways(["#2f4a3a"]).length, 3, "one colour: three cards");
assert.equal(colourways([]).length, 3, "no palette still gives cards");
assert.notDeepEqual(colourways(["#c0392b"])[0], colourways(["#2980b9"])[0], "every business gets its own");
for (const palette of [oh, ["#ff6a32"], ["#ffffff"], ["#000000"], ["#ffeb3b", "#00bcd4"], []]) {
  for (const c of colourways(palette)) {
    assert.ok(contrast(c.ink, c.base) >= 4.5, `${palette.join(",")} ${c.id}: text on base ${contrast(c.ink, c.base).toFixed(2)}`);
    assert.ok(contrast(c.ink, c.base2) >= 4.5, `${palette.join(",")} ${c.id}: text on base2 ${contrast(c.ink, c.base2).toFixed(2)}`);
  }
}
assert.equal(findColourway(a, "night")?.name, "Night");
assert.equal(findColourway(a, "nope"), null);
assert.deepEqual(parseColourway(JSON.stringify(a[0])), a[0]);
assert.equal(parseColourway("{\"id\":\"x\"}"), null);
assert.equal(parseColourway("not json"), null);

// ── the buyer's order ─────────────────────────────────────────────────────
const ctx = {
  settings: parseStoreSettings({ enabled: true, amounts: [25, 50], allowCustom: true, customMin: 25, customMax: 500, therapyIds: [3] }),
  treatments: [{ id: 3, name: "Swedish massage", priceEur: 80 }, { id: 4, name: "Facial", priceEur: 60 }],
  colourwayIds: a.map((c) => c.id),
  today,
};
const draft: OrderDraft = {
  kind: "amount",
  amountEur: 50,
  therapyId: null,
  toName: "  Aoife ",
  fromName: "Sean",
  message: "Happy birthday",
  colourwayId: "signature",
  deliverTo: "recipient",
  recipientEmail: "Aoife@Example.ie",
  deliverOn: "2026-12-24",
  buyerName: "Sean Walsh",
  buyerEmail: "sean@example.ie",
};
const ok = validateOrder(draft, ctx);
assert.ok(ok.ok);
if (ok.ok) {
  assert.equal(ok.order.valueCents, 5000);
  assert.equal(ok.order.toName, "Aoife");
  assert.equal(ok.order.recipientEmail, "aoife@example.ie");
  assert.equal(ok.order.deliverOn, "2026-12-24");
}
const t = validateOrder({ ...draft, kind: "treatment", amountEur: null, therapyId: 3 }, ctx);
assert.ok(t.ok && t.order.valueCents === 8000 && t.order.therapyName === "Swedish massage", "treatment at its list price");
const fail = (d: Partial<OrderDraft>) => {
  const r = validateOrder({ ...draft, ...d }, ctx);
  return r.ok ? null : r.field;
};
assert.equal(fail({ kind: "treatment", therapyId: 4 }), "therapyId", "a treatment not ticked for sale");
assert.equal(fail({ amountEur: 501 }), "amountEur");
assert.equal(fail({ toName: "   " }), "toName");
assert.equal(fail({ fromName: "" }), "fromName");
assert.equal(fail({ message: "x".repeat(201) }), "message");
assert.equal(fail({ colourwayId: "gold" }), "colourwayId");
assert.equal(fail({ recipientEmail: "aoife" }), "recipientEmail");
assert.equal(fail({ deliverOn: "2026-11-22" }), "deliverOn", "not in the past");
assert.equal(fail({ deliverOn: "2027-11-24" }), "deliverOn", "not over 12 months ahead");
assert.equal(fail({ deliverOn: "2027-11-23" }), null, "12 months ahead exactly is fine");
assert.equal(fail({ deliverOn: "2026-02-30" }), "deliverOn", "a real date");
assert.equal(fail({ buyerEmail: "x@y" }), "buyerEmail");
assert.equal(fail({ buyerName: "" }), "buyerName");
const toMe = validateOrder({ ...draft, deliverTo: "buyer", recipientEmail: "", deliverOn: "2026-12-24" }, ctx);
assert.ok(toMe.ok && toMe.order.recipientEmail === null && toMe.order.deliverOn === null, "sent to me: no recipient email, no date");

const parsed = parseOrderDraft({ kind: "treatment", amountEur: "50", therapyId: 3, toName: 7, deliverTo: "elsewhere", deliverOn: "" });
assert.equal(parsed.kind, "treatment");
assert.equal(parsed.amountEur, 50, "numbers from strings");
assert.equal(parsed.toName, "", "a non-string name is empty");
assert.equal(parsed.deliverTo, "buyer", "anything else means send it to me");
assert.equal(parsed.deliverOn, null, "no date means now");
assert.deepEqual(parseOrderDraft(null).kind, "amount");

// ── delivery status for staff ─────────────────────────────────────────────
const ds = (o: Partial<Parameters<typeof deliveryStatus>[0]>) =>
  deliveryStatus({ deliverTo: "recipient", deliverOn: null, deliveredAt: null, deliveryError: null, status: "paid", ...o });
assert.deepEqual(ds({ deliveredAt: 1 }), { label: "Emailed to the recipient", tone: "green" });
assert.deepEqual(ds({ deliverTo: "buyer", deliveredAt: 1 }), { label: "Sent to the buyer", tone: "green" });
assert.deepEqual(ds({ deliverOn: "2026-12-24" }), { label: "Sends 24 December 2026 at 9am", tone: "amber" });
assert.deepEqual(ds({ deliveryError: "bounced" }), { label: "Email failed: bounced", tone: "red" });
assert.equal(ds({ status: "refunded", deliveredAt: 1 }).label, "Refunded in Stripe");
assert.equal(ds({}).label, "Not sent yet");

console.log("vouchers model: all assertions passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/vouchers/model.test.ts`
Expected: FAIL with `Cannot find module './model'`.

- [ ] **Step 3: Write the model**

Create `app/src/lib/vouchers/model.ts`:

```ts
// app/src/lib/vouchers/model.ts
/**
 * The voucher store's rules, pure. No imports: the public builder (a client
 * component) runs the same checks the server runs, so a buyer sees the same
 * message in the browser that the checkout route would give.
 *
 * Money is held in cents wherever it is added or compared, and euros only at
 * the edges (the gift_vouchers columns are REAL euros, as they always were).
 */

// ---- limits ------------------------------------------------------------------

/** Consumer Rights Act 2022: a gift voucher must be valid for at least 5 years. */
export const MIN_EXPIRY_YEARS = 5;
export const MAX_EXPIRY_YEARS = 20;
export const MIN_VOUCHER_EUR = 5;
export const MAX_VOUCHER_EUR = 2000;
export const MAX_PRESET_AMOUNTS = 8;
export const MAX_INTRO = 200;
export const MAX_MESSAGE = 200;
export const MAX_NAME = 60;
/** A dated gift is emailed at this hour, Irish time. */
export const DELIVERY_HOUR = 9;

export type VoucherKind = "amount" | "treatment";
export type DeliverTo = "buyer" | "recipient";

// ---- store settings ------------------------------------------------------------

export interface VoucherStoreSettings {
  enabled: boolean;
  /** Whole euros, ascending, no repeats. */
  amounts: number[];
  allowCustom: boolean;
  customMin: number;
  customMax: number;
  /** Active therapies sold as one-session vouchers, at their list price. */
  therapyIds: number[];
  intro: string;
  expiryYears: number;
  /** Where "Book with this voucher" goes. Blank means the business's phone. */
  bookUrl: string;
}

export const DEFAULT_STORE_SETTINGS: VoucherStoreSettings = {
  enabled: false,
  amounts: [25, 50, 100],
  allowCustom: true,
  customMin: 25,
  customMax: 500,
  therapyIds: [],
  intro: "",
  expiryYears: MIN_EXPIRY_YEARS,
  bookUrl: "",
};

const isWholeEuro = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= MIN_VOUCHER_EUR && n <= MAX_VOUCHER_EUR;

function cleanAmounts(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(isWholeEuro))].sort((a, b) => a - b).slice(0, MAX_PRESET_AMOUNTS);
}

function cleanIds(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0))];
}

/**
 * Read the stored setting, forgiving: anything unreadable falls back to the
 * default, and the expiry can never come back below the legal floor whatever
 * was stored.
 */
export function parseStoreSettings(raw: unknown): VoucherStoreSettings {
  const d = DEFAULT_STORE_SETTINGS;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d, amounts: [...d.amounts], therapyIds: [] };
  const r = raw as Record<string, unknown>;
  const customMin = isWholeEuro(r.customMin) ? r.customMin : d.customMin;
  const customMax = isWholeEuro(r.customMax) && r.customMax >= customMin ? r.customMax : Math.max(customMin, d.customMax);
  const years = typeof r.expiryYears === "number" && Number.isFinite(r.expiryYears) ? Math.floor(r.expiryYears) : d.expiryYears;
  return {
    enabled: r.enabled === true,
    amounts: Array.isArray(r.amounts) ? cleanAmounts(r.amounts) : [...d.amounts],
    allowCustom: typeof r.allowCustom === "boolean" ? r.allowCustom : d.allowCustom,
    customMin,
    customMax,
    therapyIds: cleanIds(r.therapyIds),
    intro: typeof r.intro === "string" ? r.intro.trim().slice(0, MAX_INTRO) : "",
    expiryYears: Math.min(MAX_EXPIRY_YEARS, Math.max(MIN_EXPIRY_YEARS, years)),
    bookUrl: typeof r.bookUrl === "string" && /^https?:\/\/\S+$/.test(r.bookUrl.trim()) ? r.bookUrl.trim() : "",
  };
}

/** "25, 50, €100" -> [25, 50, 100]. Null when any part is not a number. */
export function parseAmountList(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).map((p) => p.replace(/[€]/g, "").trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return null;
    out.push(Number(p));
  }
  return out;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** What the settings form saves. Strict: every problem is a sentence for the owner. */
export function validateStoreSettings(draft: VoucherStoreSettings): Checked<VoucherStoreSettings> {
  if (draft.amounts.some((a) => !isWholeEuro(a))) {
    return { ok: false, error: `Amounts must be whole euros from €${MIN_VOUCHER_EUR} to €${MAX_VOUCHER_EUR}.` };
  }
  const amounts = cleanAmounts(draft.amounts);
  if (amounts.length > MAX_PRESET_AMOUNTS || new Set(draft.amounts).size > MAX_PRESET_AMOUNTS) {
    return { ok: false, error: `Use up to ${MAX_PRESET_AMOUNTS} amounts.` };
  }
  if (draft.allowCustom) {
    if (!isWholeEuro(draft.customMin)) return { ok: false, error: `The lowest other amount must be whole euros from €${MIN_VOUCHER_EUR} to €${MAX_VOUCHER_EUR}.` };
    if (!isWholeEuro(draft.customMax)) return { ok: false, error: `The highest other amount must be whole euros from €${MIN_VOUCHER_EUR} to €${MAX_VOUCHER_EUR}.` };
    if (draft.customMax < draft.customMin) return { ok: false, error: "The highest other amount must be at least the lowest." };
  }
  if (!Number.isInteger(draft.expiryYears) || draft.expiryYears < MIN_EXPIRY_YEARS) {
    return { ok: false, error: `Vouchers must last at least ${MIN_EXPIRY_YEARS} years. That is the law in Ireland.` };
  }
  if (draft.expiryYears > MAX_EXPIRY_YEARS) return { ok: false, error: `Vouchers can last at most ${MAX_EXPIRY_YEARS} years.` };
  const intro = draft.intro.trim();
  if (intro.length > MAX_INTRO) return { ok: false, error: `Keep the intro to ${MAX_INTRO} characters.` };
  const bookUrl = draft.bookUrl.trim();
  if (bookUrl && !/^https?:\/\/\S+$/.test(bookUrl)) return { ok: false, error: "The booking link must start with https://" };
  const therapyIds = cleanIds(draft.therapyIds);
  if (draft.enabled && amounts.length === 0 && !draft.allowCustom && therapyIds.length === 0) {
    return { ok: false, error: "Add an amount or a treatment before you switch the store on." };
  }
  return {
    ok: true,
    value: {
      enabled: draft.enabled,
      amounts,
      allowCustom: draft.allowCustom,
      customMin: draft.allowCustom ? draft.customMin : DEFAULT_STORE_SETTINGS.customMin,
      customMax: draft.allowCustom ? draft.customMax : DEFAULT_STORE_SETTINGS.customMax,
      therapyIds,
      intro,
      expiryYears: draft.expiryYears,
      bookUrl,
    },
  };
}

/** Null when a buyer may choose this amount, else the reason. */
export function checkAmount(s: VoucherStoreSettings, euros: number | null): string | null {
  if (euros === null || !Number.isFinite(euros)) return "Choose an amount.";
  if (s.amounts.includes(euros)) return null;
  if (!s.allowCustom) return "Choose one of the amounts.";
  if (!Number.isInteger(euros)) return "Enter whole euros.";
  if (euros < s.customMin) return `The lowest amount is €${s.customMin}.`;
  if (euros > s.customMax) return `The highest amount is €${s.customMax}.`;
  return null;
}

// ---- dates (Irish time) ----------------------------------------------------------

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = YMD.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The calendar date in Ireland at this instant, YYYY-MM-DD. */
export function dublinDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Calendar months later; the 31st becomes the last day of a shorter month. */
export function addMonths(date: string, months: number): string {
  const m = YMD.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  const total = +m[1] * 12 + (+m[2] - 1) + months;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return ymd(y, mo, Math.min(+m[3], daysInMonth(y, mo)));
}

export function addYears(date: string, years: number): string {
  return addMonths(date, years * 12);
}

/** The expiry printed on a voucher: purchase date plus the setting, never under 5 years. */
export function expiryDate(purchaseDate: string, years: number): string {
  return addYears(purchaseDate, Math.max(MIN_EXPIRY_YEARS, Math.floor(years)));
}

/** The latest day a buyer may choose for the gift email: 12 months ahead. */
export function latestDeliveryDate(today: string): string {
  return addMonths(today, 12);
}

/** Minutes Ireland is ahead of UTC at this instant: 0 in winter, 60 in summer. */
function dublinOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** The instant it is `hour`:00 on `date` in Ireland, whichever side of a clock change. */
export function dublinTimeToUtc(date: string, hour: number): number {
  const m = YMD.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], hour);
  const first = dublinOffsetMinutes(guess);
  let t = guess - first * 60000;
  const second = dublinOffsetMinutes(t);
  if (second !== first) t = guess - second * 60000;
  return t;
}

/** When the gift email goes: at once with no date, else 09:00 Irish time that day. */
export function deliveryTime(deliverOn: string | null, paidAtMs: number): number {
  return deliverOn === null ? paidAtMs : dublinTimeToUtc(deliverOn, DELIVERY_HOUR);
}

export function isDeliveryDue(deliverOn: string | null, now: number): boolean {
  return deliverOn === null || dublinTimeToUtc(deliverOn, DELIVERY_HOUR) <= now;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2031-11-23" -> "23 November 2031". */
export function formatLongDate(date: string): string {
  const m = YMD.exec(date);
  if (!m) return date;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

// ---- money ---------------------------------------------------------------------

export const toCents = (eur: number): number => Math.round(eur * 100);

/** "€50" for whole euros, "€12.50" otherwise. */
export function formatEuro(eur: number): string {
  const cents = toCents(eur);
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

/** What a voucher has left: its value less every use, never below nothing. */
export function balanceFrom(valueEur: number, redemptionsEur: readonly number[]): number {
  const left = toCents(valueEur) - redemptionsEur.reduce((s, r) => s + toCents(r), 0);
  return Math.max(0, left) / 100;
}

export interface PaymentSplit {
  /** Paid by the voucher: the "voucher" payment row. */
  voucherEur: number;
  /** Still to pay by another method: the second payment row. */
  remainderEur: number;
  /** Taken off the voucher's balance: the voucher_redemptions row. */
  redemptionEur: number;
}

/**
 * How a booking is paid with a voucher.
 *  - Money voucher: it pays up to its balance; the rest is a second payment.
 *  - Treatment voucher: it pays for one session of its treatment at today's
 *    price, whatever it cost when bought, and is then used up.
 */
export function splitPayment(
  v: { kind: VoucherKind; balanceEur: number },
  priceEur: number,
  treatmentPriceEur: number | null = null,
): PaymentSplit {
  const price = Math.max(0, toCents(priceEur));
  const balance = Math.max(0, toCents(v.balanceEur));
  if (v.kind === "treatment") {
    const covers = Math.min(price, Math.max(0, toCents(treatmentPriceEur ?? priceEur)));
    return { voucherEur: covers / 100, remainderEur: (price - covers) / 100, redemptionEur: balance / 100 };
  }
  const covers = Math.min(price, balance);
  return { voucherEur: covers / 100, remainderEur: (price - covers) / 100, redemptionEur: covers / 100 };
}

export type VoucherState = "active" | "part_used" | "used" | "expired" | "cancelled";

/** Cancelled and used-up vouchers can't be taken; an expired one still can, with a warning. */
export function voucherState(
  v: { valueEur: number; balanceEur: number; expiryDate: string; cancelledAt: number | null },
  today: string,
): VoucherState {
  if (v.cancelledAt) return "cancelled";
  if (toCents(v.balanceEur) <= 0) return "used";
  if (v.expiryDate < today) return "expired";
  if (toCents(v.balanceEur) < toCents(v.valueEur)) return "part_used";
  return "active";
}

// ---- codes ---------------------------------------------------------------------

/** No 0/O or 1/I, so a code read out over the phone survives. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SMALL_WORDS = new Set(["and", "at", "the", "of", "for", "in", "on", "by", "a"]);

/** "Optimal Health & Recovery at Inspire" -> "OH". Two letters from the first two real words. */
export function codePrefix(businessName: string): string {
  const words = businessName
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return letters.length === 2 ? letters : (letters + "GV").slice(0, 2);
}

/** "OH", 2026, [3, 17, 0, 30] -> "OH-2026-DTA8". Indexes pick from CODE_ALPHABET. */
export function formatCode(prefix: string, year: number, picks: readonly number[]): string {
  const tail = picks.map((i) => CODE_ALPHABET[((i % CODE_ALPHABET.length) + CODE_ALPHABET.length) % CODE_ALPHABET.length]).join("");
  return `${prefix}-${year}-${tail}`;
}

/** How staff type a code at the desk: any case, stray spaces. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

// ---- colourways ----------------------------------------------------------------

export interface Colourway {
  id: string;
  name: string;
  /** The card's ground, top-left to bottom-right. */
  base: string;
  base2: string;
  /** The foil sheen, three stops. */
  foil: [string, string, string];
  /** Text on the card. Always readable on both base colours. */
  ink: string;
}

const HEX = /^#[0-9a-f]{6}$/;
const GOLD = "#e8c98a";
const SILVER = "#dfe3ea";

interface Hsl { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Three or four foil colourways from a business's own colours. Pure and
 * deterministic: the same palette always gives the same cards, so a voucher
 * bought today looks the same in the email, on the gift page and at the desk.
 * The brand colour is the most vivid mid-tone in the palette; a second colour
 * far enough round the wheel from it adds a two-tone card.
 */
export function colourways(palette: readonly string[]): Colourway[] {
  const hexes = [...new Set(palette.map((p) => p.trim().toLowerCase()).filter((p) => HEX.test(p)))];
  const list = hexes.length ? hexes : ["#3d4a5c"];
  const hsl = list.map(hexToHsl);
  const vivid = (c: Hsl) => c.s * (1 - Math.abs(c.l - 0.5) * 1.2);
  let brand = hsl[0]!;
  for (const c of hsl) if (vivid(c) > vivid(brand)) brand = c;
  const second = hsl.find((c) => c !== brand && c.s >= 0.15 && hueGap(c.h, brand.h) >= 40) ?? null;
  const bs = clamp(brand.s, 0.35, 0.75);
  const out: Colourway[] = [
    {
      id: "signature",
      name: "Signature",
      base: hslToHex(brand.h, bs, 0.22),
      base2: hslToHex(brand.h, bs, 0.12),
      foil: [hslToHex(brand.h, 0.8, 0.72), GOLD, hslToHex(brand.h + 40, 0.7, 0.75)],
      ink: "#fdf8f0",
    },
    {
      id: "night",
      name: "Night",
      base: hslToHex(brand.h, 0.18, 0.11),
      base2: hslToHex(brand.h, 0.12, 0.05),
      foil: [GOLD, hslToHex(brand.h, 0.6, 0.7), SILVER],
      ink: "#f6f1e7",
    },
    {
      id: "pale",
      name: "Pale",
      base: hslToHex(brand.h, 0.35, 0.93),
      base2: hslToHex(brand.h, 0.3, 0.84),
      foil: [hslToHex(brand.h, 0.7, 0.6), SILVER, GOLD],
      ink: hslToHex(brand.h, 0.45, 0.16),
    },
  ];
  if (second) {
    out.push({
      id: "duo",
      name: "Two-tone",
      base: hslToHex(second.h, clamp(second.s, 0.35, 0.75), 0.24),
      base2: hslToHex(brand.h, bs, 0.14),
      foil: [hslToHex(second.h, 0.8, 0.72), hslToHex(brand.h, 0.8, 0.72), GOLD],
      ink: "#fdf8f0",
    });
  }
  return out;
}

export function findColourway(list: readonly Colourway[], id: string): Colourway | null {
  return list.find((c) => c.id === id) ?? null;
}

/** A colourway saved on an order or voucher (JSON), or null when unreadable. */
export function parseColourway(json: string | null | undefined): Colourway | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as Partial<Colourway>;
    const ok =
      typeof c.id === "string" &&
      typeof c.name === "string" &&
      [c.base, c.base2, c.ink].every((x) => typeof x === "string" && HEX.test(x)) &&
      Array.isArray(c.foil) &&
      c.foil.length === 3 &&
      c.foil.every((x) => typeof x === "string" && HEX.test(x));
    return ok ? (c as Colourway) : null;
  } catch {
    return null;
  }
}

// ---- the buyer's order ---------------------------------------------------------

export interface OrderDraft {
  kind: VoucherKind;
  amountEur: number | null;
  therapyId: number | null;
  toName: string;
  fromName: string;
  message: string;
  colourwayId: string;
  deliverTo: DeliverTo;
  recipientEmail: string;
  /** YYYY-MM-DD, or null for "now". Only for deliverTo "recipient". */
  deliverOn: string | null;
  buyerName: string;
  buyerEmail: string;
}

export type OrderDraftField = keyof OrderDraft;

/** A draft from a request body, every field coerced to its type (validateOrder judges it). */
export function parseOrderDraft(raw: unknown): OrderDraft {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    kind: r.kind === "treatment" ? "treatment" : "amount",
    amountEur: num(r.amountEur),
    therapyId: num(r.therapyId),
    toName: str(r.toName),
    fromName: str(r.fromName),
    message: str(r.message),
    colourwayId: str(r.colourwayId),
    deliverTo: r.deliverTo === "recipient" ? "recipient" : "buyer",
    recipientEmail: str(r.recipientEmail),
    deliverOn: typeof r.deliverOn === "string" && r.deliverOn ? r.deliverOn : null,
    buyerName: str(r.buyerName),
    buyerEmail: str(r.buyerEmail),
  };
}

export interface ValidOrder {
  kind: VoucherKind;
  valueCents: number;
  therapyId: number | null;
  therapyName: string | null;
  toName: string;
  fromName: string;
  message: string | null;
  colourwayId: string;
  deliverTo: DeliverTo;
  recipientEmail: string | null;
  deliverOn: string | null;
  buyerName: string;
  buyerEmail: string;
}

export interface StoreTreatment {
  id: number;
  name: string;
  priceEur: number;
}

export interface OrderContext {
  settings: VoucherStoreSettings;
  /** The treatments on sale (already filtered to active and ticked). */
  treatments: readonly StoreTreatment[];
  colourwayIds: readonly string[];
  today: string;
}

export type OrderCheck = { ok: true; order: ValidOrder } | { ok: false; field: OrderDraftField; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(s: string): boolean {
  return s.length <= 254 && EMAIL.test(s);
}

/** Trim, fold control characters to spaces and squash runs of spaces. */
function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ {2,}/g, " ").trim() : "";
}

export function validateOrder(draft: OrderDraft, ctx: OrderContext): OrderCheck {
  let valueCents: number;
  let therapyId: number | null = null;
  let therapyName: string | null = null;
  if (draft.kind === "treatment") {
    const t = ctx.treatments.find((x) => x.id === draft.therapyId && ctx.settings.therapyIds.includes(x.id));
    if (!t) return { ok: false, field: "therapyId", error: "Choose a treatment." };
    if (toCents(t.priceEur) <= 0) return { ok: false, field: "therapyId", error: "This treatment can't be bought online yet." };
    valueCents = toCents(t.priceEur);
    therapyId = t.id;
    therapyName = t.name;
  } else if (draft.kind === "amount") {
    const why = checkAmount(ctx.settings, draft.amountEur);
    if (why) return { ok: false, field: "amountEur", error: why };
    valueCents = toCents(draft.amountEur!);
  } else {
    return { ok: false, field: "kind", error: "Choose an amount or a treatment." };
  }

  const toName = clean(draft.toName);
  if (!toName) return { ok: false, field: "toName", error: "Add who it is for." };
  if (toName.length > MAX_NAME) return { ok: false, field: "toName", error: `Keep the name to ${MAX_NAME} characters.` };
  const fromName = clean(draft.fromName);
  if (!fromName) return { ok: false, field: "fromName", error: "Add who it is from." };
  if (fromName.length > MAX_NAME) return { ok: false, field: "fromName", error: `Keep the name to ${MAX_NAME} characters.` };
  const message = typeof draft.message === "string" ? draft.message.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim() : "";
  if (message.length > MAX_MESSAGE) return { ok: false, field: "message", error: `Keep the message to ${MAX_MESSAGE} characters.` };
  if (!ctx.colourwayIds.includes(draft.colourwayId)) return { ok: false, field: "colourwayId", error: "Choose a colour." };

  let recipientEmail: string | null = null;
  let deliverOn: string | null = null;
  if (draft.deliverTo === "recipient") {
    recipientEmail = clean(draft.recipientEmail).toLowerCase();
    if (!isEmail(recipientEmail)) return { ok: false, field: "recipientEmail", error: "Add their email address." };
    if (draft.deliverOn !== null) {
      if (!isYmd(draft.deliverOn) || draft.deliverOn < ctx.today || draft.deliverOn > latestDeliveryDate(ctx.today)) {
        return { ok: false, field: "deliverOn", error: "Choose a date in the next 12 months." };
      }
      deliverOn = draft.deliverOn;
    }
  } else if (draft.deliverTo !== "buyer") {
    return { ok: false, field: "deliverTo", error: "Choose how the voucher is sent." };
  }

  const buyerEmail = clean(draft.buyerEmail).toLowerCase();
  if (!isEmail(buyerEmail)) return { ok: false, field: "buyerEmail", error: "Add your email address." };
  const buyerName = clean(draft.buyerName);
  if (!buyerName) return { ok: false, field: "buyerName", error: "Add your name." };
  if (buyerName.length > MAX_NAME) return { ok: false, field: "buyerName", error: `Keep the name to ${MAX_NAME} characters.` };

  return {
    ok: true,
    order: {
      kind: draft.kind,
      valueCents,
      therapyId,
      therapyName,
      toName,
      fromName,
      message: message || null,
      colourwayId: draft.colourwayId,
      deliverTo: draft.deliverTo,
      recipientEmail,
      deliverOn,
      buyerName,
      buyerEmail,
    },
  };
}

/** The big line on the card: "€50", or the treatment's name. */
export function voucherTitle(v: { kind: VoucherKind; valueEur: number; therapyName: string | null }): string {
  return v.kind === "treatment" ? v.therapyName || "Treatment" : formatEuro(v.valueEur);
}

/** What is left, in words: "€20 left", "Not used yet", "Used". */
export function balanceLabel(v: { kind: VoucherKind; valueEur: number; balanceEur: number }): string {
  if (toCents(v.balanceEur) <= 0) return "Used";
  if (v.kind === "treatment") return "Not used yet";
  return `${formatEuro(v.balanceEur)} left`;
}

export interface DeliveryInfo {
  label: string;
  tone: "green" | "amber" | "red";
}

/** How an online voucher's email stands, for the staff list and detail page. */
export function deliveryStatus(o: {
  deliverTo: DeliverTo;
  deliverOn: string | null;
  deliveredAt: number | null;
  deliveryError: string | null;
  status: string;
}): DeliveryInfo {
  if (o.status === "refunded") return { label: "Refunded in Stripe", tone: "red" };
  if (o.deliveryError) return { label: `Email failed: ${o.deliveryError}`, tone: "red" };
  if (o.deliveredAt) return { label: o.deliverTo === "buyer" ? "Sent to the buyer" : "Emailed to the recipient", tone: "green" };
  if (o.deliverTo === "recipient" && o.deliverOn) return { label: `Sends ${formatLongDate(o.deliverOn)} at 9am`, tone: "amber" };
  return { label: "Not sent yet", tone: "amber" };
}
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd app && npm test -- src/lib/vouchers/model.test.ts`
Expected: PASS, printing `vouchers model: all assertions passed`. The 09:00 checks cover both clock changes of 2027 (28 March, 31 October) and the day before each.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/vouchers/model.ts app/src/lib/vouchers/model.test.ts
git commit -m "$(cat <<'EOF'
feat(vouchers): pure store rules (5-year floor, amounts, Irish 9am, split, colourways)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Store, store token, checkout and the public checkout route

**Files:**
- Create: `app/src/lib/vouchers/store.ts`
- Create: `app/src/lib/vouchers/storeToken.ts`
- Create: `app/src/lib/vouchers/checkout.ts`
- Create: `app/src/app/api/voucher-store/checkout/route.ts`
- Modify: `app/src/middleware.ts` (`PUBLIC_API_PREFIXES`)
- Modify: `app/src/middleware.test.ts`
- Test: `app/src/lib/vouchers/checkout.test.ts`

**Interfaces:**
- Consumes: Task 1 tables and `withVoucherTenant`/`seedTherapy`; Task 2 `model.ts`. Existing: `createCheckoutSession(account, params, idempotencyKey)` and `getCheckoutSession` from `lib/stripe/api.ts`; `getStripeConnection`, `canTakePayments` from `lib/stripe/connection.ts`; `signTokenPayload`/`readTokenPayload` from `lib/signedToken.ts`; `siteUrl`, `PublicSite` from `lib/cms/resolveHost.ts`; `getDesignSystemForTenant` from `lib/design/system.ts`; `getFeatureFlagsForTenant`, `getThemeForTenant`, `readKey`, `setKey` from `lib/settings.ts`.
- Produces:
  - store.ts: `VOUCHER_STORE_KEY = "voucher_store"`, `storeFlagOn(tenantId): boolean`, `getStoreSettings(): VoucherStoreSettings`, `saveStoreSettings(s): void`, `listSellableTherapies(): StoreTreatment[]`, `storeTreatments(ids): StoreTreatment[]`, `therapyName(id: number | null): string | null`, `brandPaletteForTenant(tenantId): string[]`, `createPendingVoucherOrder(o: ValidOrder, extra: { colourway: Colourway; stripeAccountId: string; siteId: number | null; siteUrl: string }): VoucherOrder`, `getVoucherOrder(id)`, `voucherOrderForSession(sessionId)`, `voucherOrderForPaymentIntent(pi)`, `setVoucherOrderSession(orderId, sessionId)`, `setVoucherOrderStatus(orderId, status, onlyFrom?): boolean`, `newVoucherCode(prefix, year?): string`, `newViewToken(): string`, `getVoucherById(id)`, `getVoucherByViewToken(token)`, `getVoucherByCode(code)`, `orderForVoucher(v)`, `VoucherRow` + `listVoucherRows(): VoucherRow[]`, `listRedemptions(voucherId)`, `cancelVoucher(voucherId, now?)`, `claimDelivery(orderId, now?): boolean`, `failDelivery(orderId, error)`, `markDelivered(orderId, now?)`, `resetDelivery(orderId)`, `setRecipientEmail(orderId, email)`, `pendingGiftOrders(): VoucherOrder[]`. All on the ambient `db`: call inside a staff request or `runWithTenant`.
  - storeToken.ts: `VoucherStoreClaim { tenantId; siteId; siteUrl }`, `signVoucherStoreToken(c): string | null`, `verifyVoucherStoreToken(token): VoucherStoreClaim | null`, `siteRootUrl(site: PublicSite, host: string | null): string`.
  - checkout.ts: `CheckoutStart = { ok: true; url: string } | { ok: false; error: string; field?: OrderDraftField }`, `startVoucherCheckout(claim, draft: OrderDraft, now?): Promise<CheckoutStart>`.
  - Route: `POST /api/voucher-store/checkout` with JSON `{ token, order }`, answers `CheckoutStart` (200 or 409; 400 for a bad token; 429 when rate-limited).

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/vouchers/checkout.test.ts`:

```ts
// Run: npm test -- src/lib/vouchers/checkout.test.ts
//
// Opening Stripe Checkout for a voucher, against a scratch business with a
// test-mode Stripe account and Stripe itself stubbed (globalThis.fetch):
//   - the signed store token round-trips and refuses tampering;
//   - a valid order writes one pending order and opens Checkout on the
//     business's own account, with kind=voucher metadata and NO platform fee;
//   - a bad order is refused with its field and writes nothing;
//   - Stripe failing marks the order failed and says nothing was charged;
//   - the store switched off, or the flag off, opens nothing.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

process.env.EMAIL_TOKEN_SECRET = "voucher-test-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_vouchers";
process.env.STRIPE_API_BASE = "http://stripe.test";
delete process.env.RESEND_API_KEY;

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

type Call = { url: string; method: string; headers: Record<string, string>; body: URLSearchParams };
const calls: Call[] = [];
let stripeFails = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: new URLSearchParams(String(init?.body ?? "")) });
  if (stripeFails) return new Response(JSON.stringify({ error: { message: "Stripe is down" } }), { status: 500 });
  if (url.endsWith("/v1/checkout/sessions")) {
    const id = `cs_test_v${calls.length}`;
    return new Response(JSON.stringify({ id, url: `https://checkout.stripe.test/${id}` }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { withVoucherTenant, seedTherapy } = requireLocal("./testSupport") as typeof import("./testSupport");
  const store = requireLocal("./store") as typeof import("./store");
  const { startVoucherCheckout } = requireLocal("./checkout") as typeof import("./checkout");
  const { signVoucherStoreToken, verifyVoucherStoreToken } = requireLocal("./storeToken") as typeof import("./storeToken");
  const { DEFAULT_STORE_SETTINGS } = requireLocal("./model") as typeof import("./model");

  await withVoucherTenant("voucher-checkout-test", async (tid, accountId) => {
    const claim = { tenantId: tid, siteId: 1, siteUrl: "https://www.glow.ie" };
    const token = signVoucherStoreToken(claim)!;
    assert.deepEqual(verifyVoucherStoreToken(token), claim, "the token carries the business and its site");
    assert.equal(verifyVoucherStoreToken(token.slice(0, -2) + "xx"), null, "a tampered token is refused");
    assert.equal(verifyVoucherStoreToken(signVoucherStoreToken({ ...claim, siteUrl: "https://www.glow.ie/" })!), null, "no trailing slash");

    const massage = seedTherapy(tid, "Swedish massage", 80);
    const tdb = getTenantDbById(tid);
    const orders = () => tdb.select().from(schema.voucherOrders).all();
    const draft = {
      kind: "amount" as const,
      amountEur: 50,
      therapyId: null,
      toName: "Aoife",
      fromName: "Sean",
      message: "Happy birthday",
      colourwayId: "signature",
      deliverTo: "recipient" as const,
      recipientEmail: "aoife@example.ie",
      deliverOn: null,
      buyerName: "Sean Walsh",
      buyerEmail: "sean@example.ie",
    };

    // Switched off in settings: nothing opens.
    runWithTenant(tid, () => store.saveStoreSettings({ ...DEFAULT_STORE_SETTINGS, enabled: false }));
    let r = await startVoucherCheckout(claim, draft);
    assert.ok(!r.ok && /aren't on sale/.test(r.error));
    assert.equal(orders().length, 0);

    runWithTenant(tid, () => store.saveStoreSettings({ ...DEFAULT_STORE_SETTINGS, enabled: true, therapyIds: [massage] }));

    // A bad order: refused with its field, nothing written, Stripe not called.
    r = await startVoucherCheckout(claim, { ...draft, amountEur: 9999 });
    assert.ok(!r.ok && r.field === "amountEur");
    assert.equal(orders().length, 0);
    assert.equal(calls.length, 0);

    // A good one.
    r = await startVoucherCheckout(claim, draft);
    assert.ok(r.ok && r.url === "https://checkout.stripe.test/cs_test_v1", "the Checkout address comes back");
    const [order] = orders();
    assert.equal(order!.status, "pending");
    assert.equal(order!.stripeSessionId, "cs_test_v1");
    assert.equal(order!.valueCents, 5000);
    assert.equal(order!.siteUrl, "https://www.glow.ie");
    assert.equal(JSON.parse(order!.colourway).id, "signature", "the card's colours are kept on the order");
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, "http://stripe.test/v1/checkout/sessions");
    assert.equal(call.headers["Stripe-Account"], accountId, "on the business's own Stripe account");
    assert.equal(call.headers["Idempotency-Key"], `voucher-order-${tid}-${order!.id}`);
    assert.equal(call.body.get("line_items[0][quantity]"), "1", "one voucher per checkout");
    assert.equal(call.body.get("line_items[0][price_data][unit_amount]"), "5000");
    assert.equal(call.body.get("line_items[0][price_data][currency]"), "eur");
    assert.equal(call.body.get("metadata[kind]"), "voucher");
    assert.equal(call.body.get("metadata[voucher_order_id]"), String(order!.id));
    assert.equal(call.body.get("payment_intent_data[metadata][kind]"), "voucher");
    assert.equal(call.body.get("success_url"), `https://www.glow.ie/vouchers?paid=${order!.id}&session_id={CHECKOUT_SESSION_ID}`);
    assert.equal(call.body.get("customer_email"), "sean@example.ie");
    assert.ok(![...call.body.keys()].some((k) => k.includes("application_fee")), "no platform fee");

    // A treatment voucher is sold at the treatment's list price.
    r = await startVoucherCheckout(claim, { ...draft, kind: "treatment", amountEur: null, therapyId: massage });
    assert.ok(r.ok);
    assert.equal(calls[1]!.body.get("line_items[0][price_data][unit_amount]"), "8000");
    assert.equal(calls[1]!.body.get("line_items[0][price_data][product_data][name]"), "Gift voucher: Swedish massage");

    // Stripe failing: the order is marked failed and the buyer is told nothing was charged.
    stripeFails = true;
    r = await startVoucherCheckout(claim, draft);
    assert.ok(!r.ok && /Nothing was charged/.test(r.error));
    const failed = tdb.select().from(schema.voucherOrders).where(eq(schema.voucherOrders.status, "failed")).all();
    assert.equal(failed.length, 1);
    stripeFails = false;

    // The flag off for this business: nothing opens.
    controlSqlite.prepare("UPDATE platform_flags SET allow = '[]' WHERE key = 'voucher_store'").run();
    r = await startVoucherCheckout(claim, draft);
    assert.ok(!r.ok);
  });

  console.log("vouchers checkout: token, order, Stripe call, refusals; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the middleware test cases**

In `app/src/middleware.test.ts`, replace:

```ts
  console.log("middleware: mapped-domain rewrite and public-route checks passed.");
```

with:

```ts
  {
    // The voucher store and the gift page live on the client's own domain,
    // and the Pay button posts to the platform's checkout route from there.
    for (const [path, expected] of [
      ["/vouchers", "/site/example/vouchers"],
      ["/v/AbCdEfGhIjKlMnOpQrStUvWx", "/site/example/v/AbCdEfGhIjKlMnOpQrStUvWx"],
    ] as const) {
      const res = middleware(new NextRequest(`https://www.example-client.ie${path}`, { headers: { host: "www.example-client.ie" } }));
      assert.ok(res.headers.get("x-middleware-rewrite")?.endsWith(expected), `${path}: rewritten to ${expected}`);
      assert.equal(res.headers.get("location"), null, `${path}: no login redirect`);
    }
    const proxied = middleware(
      new NextRequest(`${railway}/vouchers?paid=4&session_id=cs_test_1`, {
        headers: { host: "clientflow-production-ee94.up.railway.app", "x-adonis-site-host": "www.optimalhealthatinspire.ie", "x-adonis-proxy-key": "a-test-secret-of-some-length" },
      }),
    );
    assert.ok(proxied.headers.get("x-middleware-rewrite")?.includes("/site/_host/vouchers"), "proxied: the store is served from the site");
    for (const host of ["www.example-client.ie", "app.adonisagent.ie"]) {
      const res = middleware(new NextRequest(`https://${host}/api/voucher-store/checkout`, { method: "POST", headers: { host } }));
      assert.equal(res.headers.get("location"), null, `${host}: the checkout route is reachable without a session`);
      assert.equal(res.headers.get("x-middleware-rewrite"), null, `${host}: the checkout route is not rewritten into the site`);
    }
    const staff = middleware(new NextRequest("https://app.adonisagent.ie/vouchers/store", { headers: { host: "app.adonisagent.ie" } }));
    assert.equal(staff.headers.get("location"), "https://app.adonisagent.ie/login", "on the app host /vouchers is still the signed-in staff page");
  }
  console.log("middleware: mapped-domain rewrite and public-route checks passed.");
```

- [ ] **Step 3: Run both to make sure they fail**

Run: `cd app && npm test -- src/lib/vouchers/checkout.test.ts`
Expected: FAIL with `Cannot find module './store'`.

Run: `cd app && npm test -- src/middleware.test.ts`
Expected: FAIL on `www.example-client.ie: the checkout route is reachable without a session` (the route is not public yet, so it 307s to /login).

- [ ] **Step 4: Write the store**

Create `app/src/lib/vouchers/store.ts`:

```ts
import "server-only";
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  appointments,
  giftVouchers,
  therapies,
  voucherOrders,
  voucherRedemptions,
  type Voucher,
  type VoucherOrder,
  type VoucherRedemption,
} from "@/lib/db/schema";
import { isModuleOn } from "@/lib/features";
import { getFeatureFlagsForTenant, getThemeForTenant, readKey, setKey } from "@/lib/settings";
import { getDesignSystemForTenant } from "@/lib/design/system";
import {
  CODE_ALPHABET,
  formatCode,
  parseStoreSettings,
  type Colourway,
  type StoreTreatment,
  type ValidOrder,
  type VoucherStoreSettings,
} from "./model";

/**
 * Reads and writes for the voucher store, on the CURRENT tenant (the ambient
 * `db`: a staff request, or a public route / job inside runWithTenant).
 */

export const VOUCHER_STORE_KEY = "voucher_store";

/** The module flag for this business, failing closed. */
export function storeFlagOn(tenantId: number): boolean {
  try {
    return isModuleOn(getFeatureFlagsForTenant(tenantId), "voucher_store");
  } catch (err) {
    console.error("[vouchers] module flags unreadable:", err);
    return false;
  }
}

export function getStoreSettings(): VoucherStoreSettings {
  return parseStoreSettings(readKey<unknown>(VOUCHER_STORE_KEY, null));
}

export function saveStoreSettings(s: VoucherStoreSettings): void {
  setKey(VOUCHER_STORE_KEY, s);
}

/** Active therapies with a price, for the settings page. */
export function listSellableTherapies(): StoreTreatment[] {
  return db
    .select({ id: therapies.id, name: therapies.name, priceEur: therapies.defaultPriceEur })
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .orderBy(asc(therapies.name))
    .all()
    .filter((t) => t.priceEur > 0);
}

/** The ticked treatments that are still active and priced, in the order ticked. */
export function storeTreatments(ids: readonly number[]): StoreTreatment[] {
  if (ids.length === 0) return [];
  const rows = db
    .select({ id: therapies.id, name: therapies.name, priceEur: therapies.defaultPriceEur })
    .from(therapies)
    .where(and(inArray(therapies.id, [...ids]), eq(therapies.isActive, true)))
    .all();
  return ids.map((id) => rows.find((r) => r.id === id)).filter((t): t is StoreTreatment => !!t && t.priceEur > 0);
}

export function therapyName(id: number | null): string | null {
  if (!id) return null;
  return db.select({ name: therapies.name }).from(therapies).where(eq(therapies.id, id)).get()?.name ?? null;
}

/**
 * The business's own colours, for the card colourways: its design system's
 * values when it has one, else its brand accent.
 */
export function brandPaletteForTenant(tenantId: number): string[] {
  const system = getDesignSystemForTenant(tenantId);
  const fromSystem = system ? system.values.filter((v) => v.role !== "reserved").map((v) => v.hex) : [];
  return fromSystem.length ? fromSystem : [getThemeForTenant(tenantId).accent];
}

// ---- orders --------------------------------------------------------------------

export function createPendingVoucherOrder(
  o: ValidOrder,
  extra: { colourway: Colourway; stripeAccountId: string; siteId: number | null; siteUrl: string },
): VoucherOrder {
  const [row] = db
    .insert(voucherOrders)
    .values({
      kind: o.kind,
      valueCents: o.valueCents,
      therapyId: o.therapyId,
      buyerName: o.buyerName,
      buyerEmail: o.buyerEmail,
      recipientName: o.toName,
      recipientEmail: o.recipientEmail,
      fromName: o.fromName,
      message: o.message,
      colourway: JSON.stringify(extra.colourway),
      deliverTo: o.deliverTo,
      deliverOn: o.deliverOn,
      status: "pending",
      stripeAccountId: extra.stripeAccountId,
      siteId: extra.siteId,
      siteUrl: extra.siteUrl,
      createdAt: Date.now(),
    })
    .returning()
    .all();
  return row!;
}

export function getVoucherOrder(id: number): VoucherOrder | null {
  return db.select().from(voucherOrders).where(eq(voucherOrders.id, id)).get() ?? null;
}

export function voucherOrderForSession(sessionId: string): VoucherOrder | null {
  return db.select().from(voucherOrders).where(eq(voucherOrders.stripeSessionId, sessionId)).get() ?? null;
}

export function voucherOrderForPaymentIntent(pi: string): VoucherOrder | null {
  return db.select().from(voucherOrders).where(eq(voucherOrders.paymentIntentId, pi)).get() ?? null;
}

export function setVoucherOrderSession(orderId: number, sessionId: string): void {
  db.update(voucherOrders).set({ stripeSessionId: sessionId }).where(eq(voucherOrders.id, orderId)).run();
}

export function setVoucherOrderStatus(orderId: number, status: VoucherOrder["status"], onlyFrom?: VoucherOrder["status"][]): boolean {
  const where = onlyFrom ? and(eq(voucherOrders.id, orderId), inArray(voucherOrders.status, onlyFrom)) : eq(voucherOrders.id, orderId);
  return db.update(voucherOrders).set({ status }).where(where).run().changes > 0;
}

// ---- vouchers ------------------------------------------------------------------

/** A code no voucher in this business has yet, e.g. "OH-2026-DTA9". */
export function newVoucherCode(prefix: string, year = new Date().getFullYear()): string {
  for (;;) {
    const code = formatCode(prefix, year, [0, 1, 2, 3].map(() => crypto.randomInt(CODE_ALPHABET.length)));
    if (!db.select({ id: giftVouchers.id }).from(giftVouchers).where(eq(giftVouchers.code, code)).get()) return code;
  }
}

/** The /v/<token> secret: 18 random bytes, unrelated to the short code. */
export function newViewToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function getVoucherById(id: number): Voucher | null {
  return db.select().from(giftVouchers).where(eq(giftVouchers.id, id)).get() ?? null;
}

export function getVoucherByViewToken(token: string): Voucher | null {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return db.select().from(giftVouchers).where(eq(giftVouchers.viewToken, token)).get() ?? null;
}

/** By code, the way staff type it (any case, stray spaces). */
export function getVoucherByCode(code: string): Voucher | null {
  const c = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  return db.select().from(giftVouchers).where(sql`upper(${giftVouchers.code}) = ${c}`).get() ?? null;
}

export function orderForVoucher(v: Pick<Voucher, "voucherOrderId">): VoucherOrder | null {
  return v.voucherOrderId ? getVoucherOrder(v.voucherOrderId) : null;
}

export interface VoucherRow extends Voucher {
  order: Pick<VoucherOrder, "id" | "buyerName" | "buyerEmail" | "recipientEmail" | "deliverTo" | "deliverOn" | "deliveredAt" | "deliveryError" | "status"> | null;
}

/** Every voucher, newest first, with its online order when it has one. */
export function listVoucherRows(): VoucherRow[] {
  return db
    .select({ v: giftVouchers, o: voucherOrders })
    .from(giftVouchers)
    .leftJoin(voucherOrders, eq(voucherOrders.id, giftVouchers.voucherOrderId))
    .orderBy(desc(giftVouchers.createdAt))
    .all()
    .map(({ v, o }) => ({
      ...v,
      order: o
        ? {
            id: o.id,
            buyerName: o.buyerName,
            buyerEmail: o.buyerEmail,
            recipientEmail: o.recipientEmail,
            deliverTo: o.deliverTo,
            deliverOn: o.deliverOn,
            deliveredAt: o.deliveredAt,
            deliveryError: o.deliveryError,
            status: o.status,
          }
        : null,
    }));
}

export function listRedemptions(voucherId: number): (VoucherRedemption & { appointmentDate: string | null })[] {
  return db
    .select({ r: voucherRedemptions, date: appointments.date })
    .from(voucherRedemptions)
    .leftJoin(appointments, eq(appointments.id, voucherRedemptions.appointmentId))
    .where(eq(voucherRedemptions.voucherId, voucherId))
    .orderBy(asc(voucherRedemptions.createdAt), asc(voucherRedemptions.id))
    .all()
    .map(({ r, date }) => ({ ...r, appointmentDate: date ?? null }));
}

export function cancelVoucher(voucherId: number, now = Date.now()): void {
  db.update(giftVouchers).set({ balanceEur: 0, isRedeemed: true, cancelledAt: now }).where(eq(giftVouchers.id, voucherId)).run();
}

// ---- delivery --------------------------------------------------------------------

/**
 * Take the gift email for sending: stamps delivered_at only if nobody has
 * (and no failure is waiting for staff). The ticker and the purchase can
 * both try; only one gets true.
 */
export function claimDelivery(orderId: number, now = Date.now()): boolean {
  return (
    db
      .update(voucherOrders)
      .set({ deliveredAt: now })
      .where(and(eq(voucherOrders.id, orderId), isNull(voucherOrders.deliveredAt), isNull(voucherOrders.deliveryError)))
      .run().changes === 1
  );
}

/** The send failed: back to not delivered, with the reason for staff. */
export function failDelivery(orderId: number, error: string): void {
  db.update(voucherOrders).set({ deliveredAt: null, deliveryError: error.slice(0, 300) }).where(eq(voucherOrders.id, orderId)).run();
}

export function markDelivered(orderId: number, now = Date.now()): void {
  db.update(voucherOrders).set({ deliveredAt: now, deliveryError: null }).where(eq(voucherOrders.id, orderId)).run();
}

/** Staff asked to send it again: clear the last attempt so it can be claimed. */
export function resetDelivery(orderId: number): void {
  db.update(voucherOrders).set({ deliveredAt: null, deliveryError: null }).where(eq(voucherOrders.id, orderId)).run();
}

export function setRecipientEmail(orderId: number, email: string): void {
  db.update(voucherOrders).set({ recipientEmail: email }).where(eq(voucherOrders.id, orderId)).run();
}

/** Paid gifts for a recipient that have not gone and have not failed. The caller checks the time. */
export function pendingGiftOrders(): VoucherOrder[] {
  return db
    .select()
    .from(voucherOrders)
    .where(
      and(
        eq(voucherOrders.status, "paid"),
        eq(voucherOrders.deliverTo, "recipient"),
        isNull(voucherOrders.deliveredAt),
        isNull(voucherOrders.deliveryError),
        sql`${voucherOrders.giftVoucherId} is not null`,
      ),
    )
    .all();
}
```

- [ ] **Step 5: Write the store token**

Create `app/src/lib/vouchers/storeToken.ts`:

```ts
import "server-only";

import { siteUrl, type PublicSite } from "@/lib/cms/resolveHost";
import { readTokenPayload, signTokenPayload } from "@/lib/signedToken";

/**
 * Signed by the /vouchers page at render time, verified by the public
 * checkout route: which business and site the Pay button is for, and the
 * site address Stripe returns the buyer to and emails link to. Nothing in
 * the request body can choose a tenant or an address (the offer checkout's
 * pattern, lib/offers/checkoutToken.ts).
 */
export interface VoucherStoreClaim {
  tenantId: number;
  siteId: number;
  /** The site's root, no trailing slash: "https://www.example.ie" or "http://localhost:3000/site/example". */
  siteUrl: string;
}

export function signVoucherStoreToken(c: VoucherStoreClaim): string | null {
  return signTokenPayload({ k: "voucher-store", t: c.tenantId, s: c.siteId, u: c.siteUrl });
}

export function verifyVoucherStoreToken(token: string): VoucherStoreClaim | null {
  const p = readTokenPayload(token);
  if (!p || p.k !== "voucher-store") return null;
  const tenantId = Number(p.t);
  const siteId = Number(p.s);
  const url = String(p.u ?? "");
  if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(siteId) || siteId <= 0) return null;
  if (!/^https?:\/\/\S+$/.test(url) || url.endsWith("/")) return null;
  return { tenantId, siteId, siteUrl: url };
}

/**
 * The site's root for links. On a connected domain that's https://domain; on
 * the platform mount it keeps the request's port, which siteUrl drops (local
 * dev). Mirrors the campaign landing page's landingReturnUrl.
 */
export function siteRootUrl(site: PublicSite, host: string | null): string {
  if (!site.primaryHost && host && /:\d+$/.test(host)) {
    const proto = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https";
    return `${proto}://${host}/site/${site.site.slug}`;
  }
  return siteUrl(site, "/", host).replace(/\/$/, "");
}
```

- [ ] **Step 6: Write the checkout**

Create `app/src/lib/vouchers/checkout.ts`:

```ts
import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { createCheckoutSession } from "@/lib/stripe/api";
import { canTakePayments, getStripeConnection } from "@/lib/stripe/connection";
import {
  colourways,
  dublinDate,
  expiryDate,
  findColourway,
  formatEuro,
  formatLongDate,
  validateOrder,
  type OrderDraft,
  type OrderDraftField,
} from "./model";
import {
  brandPaletteForTenant,
  createPendingVoucherOrder,
  getStoreSettings,
  setVoucherOrderSession,
  setVoucherOrderStatus,
  storeFlagOn,
  storeTreatments,
} from "./store";
import type { VoucherStoreClaim } from "./storeToken";

export type CheckoutStart = { ok: true; url: string } | { ok: false; error: string; field?: OrderDraftField };

/**
 * Open Stripe Checkout for one voucher on the business's own connected
 * account. A pending order is written first; the webhook or the buyer's
 * return turns it into a voucher (fulfil.ts). No application fee: the
 * business keeps everything except Stripe's own fee.
 */
export async function startVoucherCheckout(claim: VoucherStoreClaim, draft: OrderDraft, now = Date.now()): Promise<CheckoutStart> {
  const conn = getStripeConnection(claim.tenantId);
  if (!conn || !canTakePayments(conn)) return { ok: false, error: "This business isn't taking payments online yet." };
  if (!storeFlagOn(claim.tenantId)) return { ok: false, error: "Gift vouchers aren't on sale online yet." };

  return runWithTenant(claim.tenantId, async (): Promise<CheckoutStart> => {
    const settings = getStoreSettings();
    if (!settings.enabled) return { ok: false, error: "Gift vouchers aren't on sale online yet." };
    const palette = colourways(brandPaletteForTenant(claim.tenantId));
    const today = dublinDate(now);
    const check = validateOrder(draft, {
      settings,
      treatments: storeTreatments(settings.therapyIds),
      colourwayIds: palette.map((c) => c.id),
      today,
    });
    if (!check.ok) return { ok: false, error: check.error, field: check.field };
    const o = check.order;

    const order = createPendingVoucherOrder(o, {
      colourway: findColourway(palette, o.colourwayId)!,
      stripeAccountId: conn.accountId,
      siteId: claim.siteId,
      siteUrl: claim.siteUrl,
    });
    const what = o.kind === "treatment" ? `${o.therapyName}` : formatEuro(o.valueCents / 100);
    const meta = { kind: "voucher", tenant_id: String(claim.tenantId), voucher_order_id: String(order.id) };
    const r = await createCheckoutSession(
      conn.accountId,
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: o.valueCents,
              product_data: {
                name: `Gift voucher: ${what}`,
                description: `For ${o.toName}, from ${o.fromName}. Valid until ${formatLongDate(expiryDate(today, settings.expiryYears))}.`,
              },
            },
          },
        ],
        customer_email: o.buyerEmail,
        success_url: `${claim.siteUrl}/vouchers?paid=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${claim.siteUrl}/vouchers`,
        client_reference_id: String(order.id),
        metadata: meta,
        payment_intent_data: { metadata: meta, description: `Gift voucher ${what}` },
        expires_at: Math.floor(now / 1000) + 31 * 60,
        locale: "auto",
      },
      `voucher-order-${claim.tenantId}-${order.id}`,
    );
    if (!r.ok || !r.data.url) {
      setVoucherOrderStatus(order.id, "failed");
      console.error("[vouchers] checkout failed", r.ok ? "no url" : r.error);
      return { ok: false, error: "Payments aren't working right now. Nothing was charged. Please try again shortly." };
    }
    setVoucherOrderSession(order.id, r.data.id);
    return { ok: true, url: r.data.url };
  });
}
```

- [ ] **Step 7: Write the public route and open it in the middleware**

Create `app/src/app/api/voucher-store/checkout/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { startVoucherCheckout } from "@/lib/vouchers/checkout";
import { parseOrderDraft } from "@/lib/vouchers/model";
import { verifyVoucherStoreToken } from "@/lib/vouchers/storeToken";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Public: the voucher store's Pay button. The signed token (minted by the
 * /vouchers page) names the business and its site; the body carries the
 * buyer's choices, which are checked again here. Answers with the Stripe
 * Checkout URL to go to, or the reason and the field it is about.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`voucher-checkout:${clientIp(req)}`, 20, 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many tries. Please wait a minute." }, { status: 429 });
  let body: { token?: unknown; order?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const claim = verifyVoucherStoreToken(String(body.token ?? ""));
  if (!claim) return NextResponse.json({ ok: false, error: "This page is out of date. Please refresh and try again." }, { status: 400 });
  const r = await startVoucherCheckout(claim, parseOrderDraft(body.order));
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
```

In `app/src/middleware.ts`, replace:

```ts
  "/api/offers/checkout", // landing-page Buy button → Stripe Checkout; signed-token-verified inside the route handler, rate-limited
```

with:

```ts
  "/api/offers/checkout", // landing-page Buy button → Stripe Checkout; signed-token-verified inside the route handler, rate-limited
  "/api/voucher-store/checkout", // the voucher store's Pay button → Stripe Checkout; signed-token-verified inside the route handler, rate-limited
```

- [ ] **Step 8: Run the tests and make sure they pass**

Run: `cd app && npm test -- src/lib/vouchers/checkout.test.ts`
Expected: PASS, printing `vouchers checkout: token, order, Stripe call, refusals; all passed` (and one expected `[vouchers] checkout failed Stripe is down` log line).

Run: `cd app && npm test -- src/middleware.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/vouchers/store.ts app/src/lib/vouchers/storeToken.ts app/src/lib/vouchers/checkout.ts app/src/lib/vouchers/checkout.test.ts app/src/app/api/voucher-store/checkout/route.ts app/src/middleware.ts app/src/middleware.test.ts
git commit -m "$(cat <<'EOF'
feat(vouchers): voucher checkout on the business's own Stripe, no platform fee

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Branded emails and gift delivery

**Files:**
- Create: `app/src/lib/vouchers/email.ts`
- Create: `app/src/lib/vouchers/deliver.ts`
- Test: `app/src/lib/vouchers/email.test.ts`

**Interfaces:**
- Consumes: Task 2 model; Task 3 store (`claimDelivery`, `failDelivery`, `markDelivered`, `resetDelivery`, `getVoucherOrder`, `getVoucherById`, `pendingGiftOrders`, `therapyName`). Existing: `sendEmailForTenant`, `sendPlatformEmail({ to, subject, html, fromName, replyTo })`, `getEmailProviderForTenant`, `renderEmailShell`, `escapeHtml`, `textToParagraphs`, `SendResult` from `lib/email.ts`; `getBusinessProfileForTenant` from `lib/businessProfile.ts`; `getSiteChrome`, `headerLogoSrc` from `lib/cms/siteChrome.ts`.
- Produces:
  - email.ts: `VoucherMail { to; subject; html }`, `VoucherMailer = (tenantId: number, mail: VoucherMail) => Promise<SendResult>`, `VoucherBrand { businessName; email; phone; website; logoUrl: string | null }`, `absoluteLogoUrl(src, siteUrl): string | null`, `voucherBrand(tenantId, siteId, siteUrl): VoucherBrand`, `sendVoucherEmail: VoucherMailer`, `GiftEmailInput`, `renderGiftEmail(i): { subject; html }`, `ReceiptEmailInput`, `renderReceiptEmail(i): { subject; html }`.
  - deliver.ts: `deliverGift(tenantId, orderId, send?, now?): Promise<"sent" | "failed" | "skipped">`, `dispatchDueVoucherGifts(tenantId, now?, send?): Promise<number>`, `resendVoucherEmails(tenantId, orderId, send?): Promise<SendResult>`, `sendReceipt(tenantId, order: VoucherOrder, voucher: Voucher, send?): Promise<SendResult>`.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/vouchers/email.test.ts`:

```ts
// Run: npm test -- src/lib/vouchers/email.test.ts
//
// The receipt and the gift email (branded per business, escaped), the logo
// rule for inboxes, the platform-sender fallback, and gift delivery from a
// seeded paid order: sent once, a failure kept for staff, Resend.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

process.env.EMAIL_TOKEN_SECRET = "voucher-test-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_vouchers";
process.env.STRIPE_API_BASE = "http://stripe.test";
delete process.env.RESEND_API_KEY;

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { withVoucherTenant } = requireLocal("./testSupport") as typeof import("./testSupport");
  const email = requireLocal("./email") as typeof import("./email");
  const deliver = requireLocal("./deliver") as typeof import("./deliver");
  const { colourways } = requireLocal("./model") as typeof import("./model");

  const colourway = colourways(["#2f4a3a"])[0]!;
  const brand = { businessName: "Glow & Co", email: "hello@glow.ie", phone: "083 000 0000", website: "glow.ie", logoUrl: null };

  // ── rendering ───────────────────────────────────────────────────────────
  const gift = email.renderGiftEmail({
    brand,
    colourway,
    fromName: "Sean <b>",
    toName: "Aoife",
    message: "Enjoy <script>alert(1)</script>",
    title: "€50",
    code: "GC-2026-DTA9",
    expiry: "2031-11-23",
    revealUrl: "https://www.glow.ie/v/tok",
  });
  assert.equal(gift.subject, "Sean <b> sent you a gift from Glow & Co", "subjects are plain text");
  assert.ok(gift.html.includes("Sean &lt;b&gt; sent you a gift"), "names are escaped in the body");
  assert.ok(!gift.html.includes("<script>"), "the message is escaped");
  assert.ok(gift.html.includes('href="https://www.glow.ie/v/tok"'), "one button to the gift page");
  assert.ok(gift.html.includes(colourway.base), "the card wears the chosen colourway");
  assert.ok(gift.html.includes("Glow &amp; Co"), "the business's own name");
  assert.ok(gift.html.includes("call 083 000 0000"), "how to book");
  assert.ok(gift.html.includes("23 November 2031"));
  assert.ok(!/Renova|renovacellular/i.test(gift.html), "nothing from another business");

  const receipt = (deliverTo: "buyer" | "recipient", deliverOn: string | null) =>
    email.renderReceiptEmail({
      brand,
      colourway,
      buyerName: "Sean Walsh",
      toName: "Aoife",
      title: "€50",
      paidEur: 50,
      code: "GC-2026-DTA9",
      expiry: "2031-11-23",
      revealUrl: "https://www.glow.ie/v/tok",
      deliverTo,
      recipientEmail: deliverTo === "recipient" ? "aoife@example.ie" : null,
      deliverOn,
    });
  assert.equal(receipt("buyer", null).subject, "Your Glow & Co gift voucher");
  assert.ok(receipt("buyer", null).html.includes("Thanks, Sean. You paid €50"));
  assert.ok(receipt("buyer", null).html.includes("Here is your voucher."));
  assert.ok(receipt("recipient", null).html.includes("We have emailed it to Aoife at aoife@example.ie."));
  assert.ok(receipt("recipient", "2026-12-24").html.includes("on 24 December 2026 at 9am"));
  assert.ok(receipt("buyer", null).html.includes("https://www.glow.ie/v/tok"), "the receipt always carries the voucher link");

  // ── the logo an inbox can show ─────────────────────────────────────────
  assert.equal(email.absoluteLogoUrl("/sites/glow/assets/logo.png", "https://www.glow.ie"), "https://www.glow.ie/sites/glow/assets/logo.png");
  assert.equal(email.absoluteLogoUrl("/sites/glow/logo.png", "http://localhost:3000/site/glow"), "http://localhost:3000/sites/glow/logo.png");
  assert.equal(email.absoluteLogoUrl("https://cdn.glow.ie/l.jpg", null), "https://cdn.glow.ie/l.jpg");
  assert.equal(email.absoluteLogoUrl("/logo.svg", "https://www.glow.ie"), null, "Gmail drops SVG");
  assert.equal(email.absoluteLogoUrl("data:image/png;base64,xx", "https://www.glow.ie"), null);
  assert.equal(email.absoluteLogoUrl(null, "https://www.glow.ie"), null);

  await withVoucherTenant("voucher-email-test", async (tid, accountId) => {
    // ── the fallback: no business sender, so the platform sender is tried ──
    const r = await runWithTenant(tid, () => email.sendVoucherEmail(tid, { to: "a@b.ie", subject: "s", html: "<p>h</p>" }));
    assert.ok(!r.ok && /Platform email isn't configured/.test(r.error), "it reached the platform sender");

    // ── delivering a seeded paid gift ──────────────────────────────────────
    const tdb = getTenantDbById(tid);
    const [v] = tdb
      .insert(schema.giftVouchers)
      .values({ code: "GC-2026-AAAA", purchaserName: "Sean", recipientName: "Aoife", valueEur: 50, balanceEur: 50, purchaseDate: "2026-11-23", expiryDate: "2031-11-23", source: "online", colourway: JSON.stringify(colourway), viewToken: "t".repeat(24) })
      .returning()
      .all();
    const [o] = tdb
      .insert(schema.voucherOrders)
      .values({
        kind: "amount", valueCents: 5000, buyerName: "Sean Walsh", buyerEmail: "sean@example.ie", recipientName: "Aoife", recipientEmail: "aoife@example.ie",
        fromName: "Sean", colourway: JSON.stringify(colourway), deliverTo: "recipient", deliverOn: "2026-12-24", status: "paid",
        stripeAccountId: accountId, giftVoucherId: v!.id, siteUrl: "https://www.glow.ie", createdAt: Date.now(),
      })
      .returning()
      .all();
    const sent: string[] = [];
    let fails = false;
    const mailer = async (_t: number, m: { to: string }) => {
      sent.push(m.to);
      return fails ? { ok: false as const, error: "bounced" } : { ok: true as const, id: "x" };
    };
    const at9 = Date.UTC(2026, 11, 24, 9); // winter: 09:00 Irish time is 09:00 UTC
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, at9 - 60_000, mailer), 0, "not before nine");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, at9, mailer), 1);
    assert.equal(await deliver.deliverGift(tid, o!.id, mailer, at9), "skipped", "a delivered gift is not sent again");
    assert.deepEqual(sent, ["aoife@example.ie"]);

    fails = true;
    const res = await deliver.resendVoucherEmails(tid, o!.id, mailer);
    assert.ok(!res.ok && res.error === "bounced");
    const row = () => tdb.select().from(schema.voucherOrders).where(eq(schema.voucherOrders.id, o!.id)).get()!;
    assert.equal(row().deliveryError, "bounced", "staff see why");
    assert.equal(row().deliveredAt, null);
    fails = false;
    assert.ok((await deliver.resendVoucherEmails(tid, o!.id, mailer)).ok, "Resend works once the address is fixed");
    assert.equal(row().deliveryError, null);

    tdb.update(schema.giftVouchers).set({ cancelledAt: Date.now() }).where(eq(schema.giftVouchers.id, v!.id)).run();
    tdb.update(schema.voucherOrders).set({ deliveredAt: null }).where(eq(schema.voucherOrders.id, o!.id)).run();
    assert.equal(await deliver.deliverGift(tid, o!.id, mailer, at9), "skipped", "a cancelled voucher is never sent");
  });

  console.log("vouchers email: rendering, logo rule, fallback, delivery; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/vouchers/email.test.ts`
Expected: FAIL with `Cannot find module './email'`.

- [ ] **Step 3: Write the emails**

Create `app/src/lib/vouchers/email.ts`:

```ts
import "server-only";

import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getSiteChrome, headerLogoSrc } from "@/lib/cms/siteChrome";
import { getTenantDbById } from "@/lib/db/tenant";
import {
  escapeHtml,
  getEmailProviderForTenant,
  renderEmailShell,
  sendEmailForTenant,
  sendPlatformEmail,
  textToParagraphs,
  type SendResult,
} from "@/lib/email";
import { formatEuro, formatLongDate, type Colourway, type DeliverTo } from "./model";

/**
 * The two voucher emails, branded per business: the buyer's receipt and the
 * recipient's gift. Sent from the business's own sender (Gmail, SMTP or its
 * Resend domain); a business with none, or whose sender fails, falls back to
 * the platform sender as "<Business> via AdonisAgent" with replies going to
 * the business. That fallback is a deliberate exception to "platform email
 * is for account notices", limited to these two emails, so a paid voucher is
 * never left undelivered.
 */

export interface VoucherMail {
  to: string;
  subject: string;
  html: string;
}

export type VoucherMailer = (tenantId: number, mail: VoucherMail) => Promise<SendResult>;

export interface VoucherBrand {
  businessName: string;
  email: string;
  phone: string;
  website: string;
  /** An absolute raster logo URL, or null (Gmail drops SVG and data: images). */
  logoUrl: string | null;
}

/** The site header's logo as an absolute URL an inbox can load, or null. */
export function absoluteLogoUrl(src: string | null, siteUrl: string | null): string | null {
  if (!src || src.startsWith("data:") || /\.svg(\?|$)/i.test(src)) return null;
  if (/^https?:\/\//.test(src)) return src;
  if (!src.startsWith("/") || !siteUrl) return null;
  try {
    return `${new URL(siteUrl).origin}${src}`;
  } catch {
    return null;
  }
}

export function voucherBrand(tenantId: number, siteId: number | null, siteUrl: string | null): VoucherBrand {
  const p = getBusinessProfileForTenant(tenantId);
  let logoUrl: string | null = null;
  if (siteId) {
    try {
      logoUrl = absoluteLogoUrl(headerLogoSrc(getSiteChrome(getTenantDbById(tenantId), siteId).header), siteUrl);
    } catch {
      logoUrl = null;
    }
  }
  return { businessName: p.businessName, email: p.email, phone: p.phone, website: p.website, logoUrl };
}

export async function sendVoucherEmail(tenantId: number, mail: VoucherMail): Promise<SendResult> {
  if (getEmailProviderForTenant(tenantId) !== "none") {
    const r = await sendEmailForTenant(tenantId, mail);
    if (r.ok) return r;
    console.error(`[vouchers] tenant ${tenantId} sender failed, trying the platform sender:`, r.error);
  }
  const p = getBusinessProfileForTenant(tenantId);
  return sendPlatformEmail({ ...mail, fromName: `${p.businessName} via AdonisAgent`, replyTo: p.email || undefined });
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The card, as an email can draw it: no foil, the colourway's ground and ink. */
function cardHtml(c: Colourway, businessName: string, title: string, forName: string, code: string, expiry: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:380px;margin:0 auto;border-collapse:separate;border-radius:18px;background:${c.base};background-image:linear-gradient(135deg,${c.base} 0%,${c.base2} 100%);">
  <tr><td style="padding:24px 26px 0;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:${c.ink};">${escapeHtml(businessName)}</td>
      <td align="right" style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${c.ink};opacity:.7;">Gift voucher</td>
    </tr></table>
  </td></tr>
  <tr><td align="center" style="padding:26px 26px 22px;font-family:${FONT};color:${c.ink};">
    <div style="font-size:40px;line-height:1.1;font-weight:600;">${escapeHtml(title)}</div>
    <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin-top:10px;opacity:.8;">For ${escapeHtml(forName)}</div>
  </td></tr>
  <tr><td style="padding:0 26px 22px;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${c.foil[1]};"><tr>
      <td style="padding-top:12px;font-family:Menlo,Consolas,monospace;font-size:13px;letter-spacing:.14em;color:${c.ink};">${escapeHtml(code)}</td>
      <td align="right" style="padding-top:12px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${c.ink};opacity:.7;">Valid until ${escapeHtml(formatLongDate(expiry))}</td>
    </tr></table>
  </td></tr>
</table>`;
}

function button(href: string, label: string, c: Colourway): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 6px;"><tr>
  <td style="border-radius:999px;background:${c.base};"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:14px;font-weight:600;color:${c.ink};text-decoration:none;">${escapeHtml(label)}</a></td>
</tr></table>`;
}

function contactLine(b: VoucherBrand): string {
  return [b.phone && `call ${b.phone}`, b.email && `email ${b.email}`].filter(Boolean).join(" or ");
}

export interface GiftEmailInput {
  brand: VoucherBrand;
  colourway: Colourway;
  fromName: string;
  toName: string;
  message: string | null;
  title: string;
  code: string;
  expiry: string;
  revealUrl: string;
}

/** To the recipient: "<From> sent you a gift", the card and one button. */
export function renderGiftEmail(i: GiftEmailInput): { subject: string; html: string } {
  const c = i.colourway;
  const contact = contactLine(i.brand);
  const logo = i.brand.logoUrl
    ? `<img src="${escapeHtml(i.brand.logoUrl)}" alt="${escapeHtml(i.brand.businessName)}" height="36" style="display:block;margin:0 auto;height:36px;width:auto;border:0;">`
    : `<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#111827;">${escapeHtml(i.brand.businessName)}</div>`;
  const message = i.message
    ? `<p style="margin:0 auto 22px;max-width:420px;font-size:17px;line-height:1.6;font-style:italic;color:#374151;text-align:center;">&ldquo;${escapeHtml(i.message)}&rdquo;</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(i.fromName)} sent you a gift</title></head>
<body style="margin:0;background:#f3f4f6;padding:24px 12px;font-family:${FONT};color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;">
  <tr><td align="center" style="padding:32px 24px 8px;">${logo}</td></tr>
  <tr><td align="center" style="padding:18px 24px 6px;">
    <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:#111827;">${escapeHtml(i.fromName)} sent you a gift</h1>
  </td></tr>
  <tr><td style="padding:22px 24px 8px;">${cardHtml(c, i.brand.businessName, i.title, i.toName, i.code, i.expiry)}</td></tr>
  <tr><td style="padding:16px 24px 0;">${message}${button(i.revealUrl, "Open your gift", c)}</td></tr>
  <tr><td align="center" style="padding:10px 24px 28px;font-size:13px;line-height:1.6;color:#6b7280;">
    ${contact ? `To book, ${escapeHtml(contact)}. Give them your code.` : "Give your code when you book."}
  </td></tr>
  <tr><td style="padding:0 24px 24px;"><div style="border-top:1px solid #e5e7eb;padding-top:14px;font-size:12px;color:#9ca3af;text-align:center;">Sent by ${escapeHtml(i.brand.businessName)}${i.brand.website ? ` &middot; ${escapeHtml(i.brand.website)}` : ""}</div></td></tr>
</table>
</body></html>`;
  return { subject: `${i.fromName} sent you a gift from ${i.brand.businessName}`, html };
}

export interface ReceiptEmailInput {
  brand: VoucherBrand;
  colourway: Colourway;
  buyerName: string;
  toName: string;
  title: string;
  paidEur: number;
  code: string;
  expiry: string;
  revealUrl: string;
  deliverTo: DeliverTo;
  recipientEmail: string | null;
  deliverOn: string | null;
}

/** To the buyer: what they paid, the card, the voucher link, and what happens next. */
export function renderReceiptEmail(i: ReceiptEmailInput): { subject: string; html: string } {
  const first = i.buyerName.split(/\s+/)[0] || "";
  const next =
    i.deliverTo === "buyer"
      ? "Here is your voucher. Print it or forward this email."
      : i.deliverOn
        ? `We will email it to ${i.toName} at ${i.recipientEmail} on ${formatLongDate(i.deliverOn)} at 9am.`
        : `We have emailed it to ${i.toName} at ${i.recipientEmail}.`;
  const contact = contactLine(i.brand);
  const bodyHtml = `
    ${textToParagraphs(`${first ? `Thanks, ${first}.` : "Thanks."} You paid ${formatEuro(i.paidEur)} for a gift voucher for ${i.toName}.`)}
    ${textToParagraphs(next)}
    <div style="margin:18px 0;">${cardHtml(i.colourway, i.brand.businessName, i.title, i.toName, i.code, i.expiry)}</div>
    ${button(i.revealUrl, "Open the voucher", i.colourway)}
    ${textToParagraphs(`Code ${i.code}. Valid until ${formatLongDate(i.expiry)}.${contact ? ` To book, ${contact}.` : ""}`)}`;
  const html = renderEmailShell({
    businessName: i.brand.businessName,
    accent: i.colourway.base,
    heading: "Your gift voucher",
    bodyHtml,
    footer: `Sent by ${i.brand.businessName}.`,
    logoUrl: i.brand.logoUrl ?? undefined,
    logoWidth: 160,
  });
  return { subject: `Your ${i.brand.businessName} gift voucher`, html };
}
```

- [ ] **Step 4: Write the delivery**

Create `app/src/lib/vouchers/deliver.ts`:

```ts
import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import type { SendResult } from "@/lib/email";
import type { Voucher, VoucherOrder } from "@/lib/db/schema";
import { isDeliveryDue, parseColourway, voucherTitle } from "./model";
import {
  claimDelivery,
  failDelivery,
  getVoucherById,
  getVoucherOrder,
  markDelivered,
  pendingGiftOrders,
  resetDelivery,
  therapyName,
} from "./store";
import { renderGiftEmail, renderReceiptEmail, sendVoucherEmail, voucherBrand, type VoucherMailer } from "./email";

/**
 * Gift emails to recipients. Sent at once when the buyer chose "now", and
 * otherwise by the minute dispatch ticker at 09:00 Irish time on the chosen
 * day. Each send is claimed first (claimDelivery), so the purchase and the
 * ticker can't both send it. A failure is kept on the order for staff, who
 * see it on the voucher with a Resend button; it is not retried by itself,
 * so a bad address doesn't get an email a minute.
 */
export async function deliverGift(
  tenantId: number,
  orderId: number,
  send: VoucherMailer = sendVoucherEmail,
  now = Date.now(),
): Promise<"sent" | "failed" | "skipped"> {
  return runWithTenant(tenantId, async () => {
    const order = getVoucherOrder(orderId);
    if (!order || order.status !== "paid" || order.deliverTo !== "recipient" || !order.recipientEmail || !order.giftVoucherId) return "skipped";
    const voucher = getVoucherById(order.giftVoucherId);
    const colourway = parseColourway(voucher?.colourway ?? order.colourway);
    if (!voucher || !voucher.viewToken || !colourway || voucher.cancelledAt) return "skipped";
    if (!claimDelivery(order.id, now)) return "skipped";

    let r: SendResult;
    try {
      const { subject, html } = renderGiftEmail({
        brand: voucherBrand(tenantId, order.siteId, order.siteUrl),
        colourway,
        fromName: order.fromName,
        toName: order.recipientName,
        message: order.message,
        title: voucherTitle({ kind: order.kind, valueEur: order.valueCents / 100, therapyName: therapyName(order.therapyId) }),
        code: voucher.code,
        expiry: voucher.expiryDate,
        revealUrl: `${order.siteUrl}/v/${voucher.viewToken}`,
      });
      r = await send(tenantId, { to: order.recipientEmail, subject, html });
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : "The gift email could not be sent." };
    }
    if (r.ok) return "sent";
    failDelivery(order.id, r.error);
    await logActivity("voucher_gift_failed", `The gift email for voucher ${voucher.code} to ${order.recipientEmail} failed: ${r.error}`, {
      orderId: order.id,
      voucherId: voucher.id,
    });
    return "failed";
  });
}

/** The ticker's pass for one business: every gift whose day and hour have come. Returns how many went. */
export async function dispatchDueVoucherGifts(tenantId: number, now = Date.now(), send: VoucherMailer = sendVoucherEmail): Promise<number> {
  const due = runWithTenant(tenantId, () => pendingGiftOrders().filter((o) => isDeliveryDue(o.deliverOn, now)));
  let sent = 0;
  for (const o of due) {
    if ((await deliverGift(tenantId, o.id, send, now)) === "sent") sent++;
  }
  return sent;
}

/**
 * Staff: send it again. A gift for a recipient goes to the recipient (now,
 * whatever date was chosen); a voucher sent to the buyer re-sends the
 * receipt, which carries the voucher link.
 */
export async function resendVoucherEmails(tenantId: number, orderId: number, send: VoucherMailer = sendVoucherEmail): Promise<SendResult> {
  const order = runWithTenant(tenantId, () => getVoucherOrder(orderId));
  if (!order || order.status !== "paid" || !order.giftVoucherId) return { ok: false, error: "This voucher has no paid online order." };
  if (order.deliverTo === "recipient") {
    runWithTenant(tenantId, () => resetDelivery(order.id));
    const r = await deliverGift(tenantId, order.id, send);
    if (r === "sent") return { ok: true, id: "" };
    const after = runWithTenant(tenantId, () => getVoucherOrder(order.id));
    return { ok: false, error: after?.deliveryError || "The gift email could not be sent." };
  }
  return runWithTenant(tenantId, async () => {
    const voucher = getVoucherById(order.giftVoucherId!);
    if (!voucher) return { ok: false as const, error: "The voucher is missing." };
    const r = await sendReceipt(tenantId, order, voucher, send);
    if (r.ok) markDelivered(order.id);
    return r;
  });
}

/** The buyer's receipt with the voucher link. Never throws. */
export async function sendReceipt(tenantId: number, order: VoucherOrder, voucher: Voucher, send: VoucherMailer = sendVoucherEmail): Promise<SendResult> {
  try {
    const colourway = parseColourway(voucher.colourway ?? order.colourway);
    if (!colourway || !voucher.viewToken) return { ok: false as const, error: "The voucher is missing its card or link." };
    const { subject, html } = renderReceiptEmail({
      brand: voucherBrand(tenantId, order.siteId, order.siteUrl),
      colourway,
      buyerName: order.buyerName,
      toName: order.recipientName,
      title: voucherTitle({ kind: order.kind, valueEur: order.valueCents / 100, therapyName: therapyName(order.therapyId) }),
      paidEur: order.valueCents / 100,
      code: voucher.code,
      expiry: voucher.expiryDate,
      revealUrl: `${order.siteUrl}/v/${voucher.viewToken}`,
      deliverTo: order.deliverTo,
      recipientEmail: order.recipientEmail,
      deliverOn: order.deliverOn,
    });
    const r = await send(tenantId, { to: order.buyerEmail, subject, html });
    if (!r.ok) console.error(`[vouchers] receipt for order ${order.id} failed:`, r.error);
    return r;
  } catch (err) {
    console.error(`[vouchers] receipt for order ${order.id} failed:`, err);
    return { ok: false as const, error: err instanceof Error ? err.message : "The receipt could not be sent." };
  }
}

```

- [ ] **Step 5: Run the test and make sure it passes**

Run: `cd app && npm test -- src/lib/vouchers/email.test.ts`
Expected: PASS, printing `vouchers email: rendering, logo rule, fallback, delivery; all passed`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/vouchers/email.ts app/src/lib/vouchers/deliver.ts app/src/lib/vouchers/email.test.ts
git commit -m "$(cat <<'EOF'
feat(vouchers): branded receipt and gift emails, gift delivery with platform fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Fulfil once, the webhook, refunds and the ticker

**Files:**
- Create: `app/src/lib/vouchers/fulfil.ts`
- Modify: `app/src/app/api/stripe/webhook/route.ts`
- Modify: `app/src/lib/dispatch/ticker.ts`
- Test: `app/src/lib/vouchers/fulfil.test.ts`

**Interfaces:**
- Consumes: Tasks 2-4. Existing: `CheckoutSession` type from `lib/stripe/api.ts`; `logActivity(type, message, meta)` from `lib/queries.ts`; `getBusinessProfileForTenant`; the webhook's `fulfilCheckout`, `expireOrder`, `recoverAbandonedCheckout`, `refundOrder` (offers, unchanged).
- Produces:
  - fulfil.ts: `FulfilStatus = "fulfilled" | "already" | "unpaid" | "not_found" | "mismatch"`, `fulfilVoucherCheckout(tenantId, accountId, session: CheckoutSession, send?: VoucherMailer, now?): Promise<{ status: FulfilStatus; orderId?: number; voucherId?: number }>`, `expireVoucherOrder(tenantId, sessionId): void`, `refundVoucherOrder(tenantId, paymentIntentId, now?): boolean` (false = not a voucher order).
  - `DispatchSummary.vouchersSent: number`.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/vouchers/fulfil.test.ts`:

```ts
// Run: npm test -- src/lib/vouchers/fulfil.test.ts
//
// From a paid Checkout to a delivered voucher, in a scratch business, with
// the mailer stubbed (no network):
//   - unpaid and wrong-amount sessions make nothing;
//   - the webhook and the return page both fulfilling makes ONE voucher;
//   - the voucher: online, balance = value, expiry 5 years on, its own token;
//   - receipt to the buyer always; gift now, or by the ticker at 09:00 Irish
//     time on the chosen day, once; a failed gift waits for staff, Resend works;
//   - refunds: unused -> cancelled, part-used -> flagged, not a voucher -> false;
//   - the Stripe webhook routes kind=voucher events here and leaves offers alone,
//     and a business with no sender falls back to the platform sender.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Module from "node:module";
import { createRequire } from "node:module";

process.env.EMAIL_TOKEN_SECRET = "voucher-test-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_vouchers";
process.env.STRIPE_API_BASE = "http://stripe.test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_vouchers";
delete process.env.RESEND_API_KEY;

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { NextRequest } = requireLocal("next/server") as typeof import("next/server");
  const { withVoucherTenant } = requireLocal("./testSupport") as typeof import("./testSupport");
  const store = requireLocal("./store") as typeof import("./store");
  const fulfil = requireLocal("./fulfil") as typeof import("./fulfil");
  const deliver = requireLocal("./deliver") as typeof import("./deliver");
  const model = requireLocal("./model") as typeof import("./model");
  const webhook = requireLocal("../../app/api/stripe/webhook/route") as typeof import("../../app/api/stripe/webhook/route");

  type Sent = { to: string; subject: string; html: string };
  const sent: Sent[] = [];
  let mailerFails = false;
  const mailer = async (_tid: number, m: Sent) => {
    sent.push(m);
    return mailerFails ? { ok: false as const, error: "mailbox full" } : { ok: true as const, id: "m1" };
  };

  await withVoucherTenant("voucher-fulfil-test", async (tid, accountId) => {
    const tdb = getTenantDbById(tid);
    const colourway = model.colourways(["#2f4a3a"])[0]!;
    const base: import("./model").ValidOrder = {
      kind: "amount",
      valueCents: 5000,
      therapyId: null,
      therapyName: null,
      toName: "Aoife",
      fromName: "Sean",
      message: "Happy birthday <3",
      colourwayId: colourway.id,
      deliverTo: "recipient",
      recipientEmail: "aoife@example.ie",
      deliverOn: null,
      buyerName: "Sean Walsh",
      buyerEmail: "sean@example.ie",
    };
    let n = 0;
    const order = (o: Partial<import("./model").ValidOrder> = {}) =>
      runWithTenant(tid, () => {
        const row = store.createPendingVoucherOrder({ ...base, ...o }, { colourway, stripeAccountId: accountId, siteId: null, siteUrl: "https://www.glow.ie" });
        n++;
        store.setVoucherOrderSession(row.id, `cs_test_${n}`);
        return { ...row, session: `cs_test_${n}`, pi: `pi_test_${n}` };
      });
    const session = (o: { id: number; session: string; pi: string }, extra: Partial<import("../stripe/api").CheckoutSession> = {}) => ({
      id: o.session,
      payment_status: "paid" as const,
      amount_total: 5000,
      currency: "eur",
      payment_intent: o.pi,
      client_reference_id: String(o.id),
      ...extra,
    });
    const vouchers = () => tdb.select().from(schema.giftVouchers).all();
    const getOrder = (id: number) => tdb.select().from(schema.voucherOrders).where(eq(schema.voucherOrders.id, id)).get()!;
    const now = Date.UTC(2026, 10, 23, 12);

    // Unpaid, wrong amount, someone else's account: nothing.
    const a = order();
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, accountId, session(a, { payment_status: "unpaid" }), mailer, now)).status, "unpaid");
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, accountId, session(a, { amount_total: 100 }), mailer, now)).status, "mismatch");
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, "acct_other", session(a), mailer, now)).status, "not_found");
    assert.equal(vouchers().length, 0);

    // Webhook and return page together: one voucher.
    const [r1, r2] = await Promise.all([
      fulfil.fulfilVoucherCheckout(tid, accountId, session(a), mailer, now),
      fulfil.fulfilVoucherCheckout(tid, accountId, session(a), mailer, now),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), ["already", "fulfilled"], "only one caller fulfils");
    assert.equal(vouchers().length, 1, "one voucher");
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, accountId, session(a), mailer, now)).status, "already", "a late webhook changes nothing");
    const v = vouchers()[0]!;
    assert.equal(v.source, "online");
    assert.equal(v.kind, "amount");
    assert.equal(v.valueEur, 50);
    assert.equal(v.balanceEur, 50);
    assert.equal(v.purchaseDate, "2026-11-23");
    assert.equal(v.expiryDate, "2031-11-23", "five years, the legal floor");
    assert.match(v.code, /^GC-\d{4}-[A-Z2-9]{4}$/, "the business's own prefix (Glow Clinic)");
    assert.equal(v.viewToken?.length, 24);
    assert.equal(v.purchaserName, "Sean", "the card's From line");
    assert.equal(v.recipientName, "Aoife");
    assert.equal(v.colourway, JSON.stringify(colourway));
    const paidA = getOrder(a.id);
    assert.equal(paidA.status, "paid");
    assert.equal(paidA.giftVoucherId, v.id);
    assert.equal(paidA.paymentIntentId, a.pi);
    assert.equal(sent.length, 2, "receipt and gift, once each");
    assert.equal(sent[0]!.to, "sean@example.ie");
    assert.ok(sent[0]!.html.includes(`https://www.glow.ie/v/${v.viewToken}`), "the receipt carries the voucher link");
    assert.equal(sent[1]!.to, "aoife@example.ie");
    assert.equal(sent[1]!.subject, "Sean sent you a gift from Glow Clinic");
    assert.ok(sent[1]!.html.includes("Happy birthday &lt;3"), "the message is escaped");
    assert.ok(!/Renova/.test(sent[0]!.html + sent[1]!.html), "nothing from another business");
    assert.ok(paidA.deliveredAt, "the gift is marked delivered");

    // Sent to the buyer: the receipt is the delivery.
    sent.length = 0;
    const b = order({ deliverTo: "buyer", recipientEmail: null });
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(b), mailer, now);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "sean@example.ie");
    assert.ok(getOrder(b.id).deliveredAt);

    // A dated gift: receipt now, gift at 09:00 Irish time on the day, once.
    sent.length = 0;
    const c = order({ deliverOn: "2027-07-15" });
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(c), mailer, now);
    assert.deepEqual(sent.map((s) => s.to), ["sean@example.ie"], "only the receipt so far");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, Date.UTC(2027, 6, 15, 7, 59), mailer), 0, "not before 09:00 Irish summer time");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, Date.UTC(2027, 6, 15, 8, 0), mailer), 1, "09:00 Irish time is 08:00 UTC in July");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, Date.UTC(2027, 6, 15, 8, 1), mailer), 0, "never twice");
    assert.deepEqual(sent.map((s) => s.to), ["sean@example.ie", "aoife@example.ie"]);

    // A failed gift waits for staff; Resend sends it.
    sent.length = 0;
    mailerFails = true;
    const d = order();
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(d), mailer, now);
    assert.equal(getOrder(d.id).deliveryError, "mailbox full");
    assert.equal(getOrder(d.id).deliveredAt, null);
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, now + 60_000, mailer), 0, "not retried every minute");
    mailerFails = false;
    const again = await deliver.resendVoucherEmails(tid, d.id, mailer);
    assert.ok(again.ok);
    assert.equal(getOrder(d.id).deliveryError, null);
    assert.ok(getOrder(d.id).deliveredAt);

    // Refunds.
    assert.equal(fulfil.refundVoucherOrder(tid, "pi_unknown"), false, "not a voucher: the offers handle it");
    assert.equal(fulfil.refundVoucherOrder(tid, b.pi, now), true);
    const vb = tdb.select().from(schema.giftVouchers).where(eq(schema.giftVouchers.id, getOrder(b.id).giftVoucherId!)).get()!;
    assert.equal(vb.balanceEur, 0, "an unused voucher is cancelled");
    assert.equal(vb.cancelledAt, now);
    assert.equal(getOrder(b.id).status, "refunded");
    const vc = getOrder(c.id).giftVoucherId!;
    tdb.update(schema.giftVouchers).set({ balanceEur: 20 }).where(eq(schema.giftVouchers.id, vc)).run();
    assert.equal(fulfil.refundVoucherOrder(tid, c.pi, now), true);
    const vcRow = tdb.select().from(schema.giftVouchers).where(eq(schema.giftVouchers.id, vc)).get()!;
    assert.equal(vcRow.cancelledAt, null, "a part-used voucher is not cancelled");
    assert.equal(vcRow.balanceEur, 20);
    assert.equal(getOrder(c.id).status, "refunded", "the order shows the refund for staff");

    // The webhook: kind=voucher goes to the voucher store.
    const sign = (body: string) => {
      const t = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", "whsec_test_vouchers").update(`${t}.${body}`, "utf8").digest("hex");
      return `t=${t},v1=${sig}`;
    };
    const post = (event: object) => {
      const raw = JSON.stringify(event);
      return webhook.POST(new NextRequest("https://app.test/api/stripe/webhook", { method: "POST", body: raw, headers: { "stripe-signature": sign(raw) } }));
    };
    const e = order({ deliverTo: "buyer", recipientEmail: null });
    let res = await post({ type: "checkout.session.completed", account: accountId, data: { object: { ...session(e), metadata: { kind: "voucher", voucher_order_id: String(e.id) } } } });
    assert.equal(res.status, 200);
    const paidE = getOrder(e.id);
    assert.equal(paidE.status, "paid", "the webhook fulfilled the voucher order");
    assert.match(paidE.deliveryError ?? "", /Platform email isn't configured/, "no business sender: it tried the platform sender, and the failure waits for staff");
    const f = order();
    res = await post({ type: "checkout.session.expired", account: accountId, data: { object: { id: f.session, metadata: { kind: "voucher" } } } });
    assert.equal(res.status, 200);
    assert.equal(getOrder(f.id).status, "expired");
    res = await post({ type: "charge.refunded", account: accountId, data: { object: { payment_intent: e.pi, refunded: true } } });
    assert.equal(res.status, 200);
    assert.equal(getOrder(e.id).status, "refunded", "a refund finds the voucher order by its payment id");

    // The dispatch ticker reaches a due gift (the real sender: no email set up here, so it records why).
    const g = order({ deliverOn: "2026-01-01" });
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(g), mailer, now);
    tdb.update(schema.voucherOrders).set({ deliveredAt: null, deliveryError: null }).where(eq(schema.voucherOrders.id, g.id)).run();
    const { runDispatchForTenant } = requireLocal("../dispatch/ticker") as typeof import("../dispatch/ticker");
    const summary = await runDispatchForTenant(tid, "http://localhost:3000");
    assert.equal(summary.vouchersSent, 0);
    assert.match(getOrder(g.id).deliveryError ?? "", /Platform email isn't configured/, "the ticker tried to send the due gift");
  });

  console.log("vouchers fulfil: one voucher per payment, delivery, refunds, webhook routing; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/vouchers/fulfil.test.ts`
Expected: FAIL with `Cannot find module './fulfil'`.

- [ ] **Step 3: Write the fulfilment**

Create `app/src/lib/vouchers/fulfil.ts`:

```ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/db/tenant";
import { giftVouchers, voucherOrders, type Voucher } from "@/lib/db/schema";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { logActivity } from "@/lib/queries";
import type { CheckoutSession } from "@/lib/stripe/api";
import { codePrefix, dublinDate, expiryDate, voucherTitle } from "./model";
import {
  cancelVoucher,
  getStoreSettings,
  getVoucherById,
  getVoucherOrder,
  markDelivered,
  failDelivery,
  newViewToken,
  newVoucherCode,
  setVoucherOrderStatus,
  therapyName,
  voucherOrderForPaymentIntent,
  voucherOrderForSession,
} from "./store";
import { sendVoucherEmail, type VoucherMailer } from "./email";
import { deliverGift, sendReceipt } from "./deliver";

export type FulfilStatus = "fulfilled" | "already" | "unpaid" | "not_found" | "mismatch";

/**
 * A paid Checkout becomes a gift voucher. Reached from the Stripe webhook AND
 * from the buyer's return to /vouchers, whichever is first. The order is
 * claimed with one conditional UPDATE (pending/expired -> paid) inside the
 * same transaction that writes the voucher, so the two callers can never
 * both make one, and a claim never stands without its voucher.
 *
 * Then: the buyer's receipt (always, with the voucher link), and the gift
 * email at once when the buyer chose "now". A dated gift is left for the
 * dispatch ticker (deliver.ts).
 */
export async function fulfilVoucherCheckout(
  tenantId: number,
  accountId: string,
  session: CheckoutSession,
  send: VoucherMailer = sendVoucherEmail,
  now = Date.now(),
): Promise<{ status: FulfilStatus; orderId?: number; voucherId?: number }> {
  return runWithTenant(tenantId, async () => {
    const order =
      voucherOrderForSession(session.id) ?? (session.client_reference_id ? getVoucherOrder(Number(session.client_reference_id)) : null);
    if (!order || order.stripeAccountId !== accountId) return { status: "not_found" as const };
    if (order.status === "paid" || order.status === "refunded") return { status: "already" as const, orderId: order.id, voucherId: order.giftVoucherId ?? undefined };
    if (session.payment_status !== "paid") return { status: "unpaid" as const, orderId: order.id };
    if (session.amount_total !== order.valueCents || (session.currency ?? "").toLowerCase() !== "eur") {
      console.error(`[vouchers] amount mismatch on order ${order.id}: paid ${session.amount_total} ${session.currency}, expected ${order.valueCents} eur`);
      return { status: "mismatch" as const, orderId: order.id };
    }

    const today = dublinDate(now);
    const years = getStoreSettings().expiryYears;
    const prefix = codePrefix(getBusinessProfileForTenant(tenantId).businessName);
    const voucher = db.transaction((tx): Voucher | null => {
      const claimed = tx
        .update(voucherOrders)
        .set({ status: "paid", paidAt: now, stripeSessionId: session.id, paymentIntentId: session.payment_intent ?? null })
        .where(and(eq(voucherOrders.id, order.id), inArray(voucherOrders.status, ["pending", "expired", "failed"])))
        .run().changes;
      if (claimed !== 1) return null;
      const [v] = tx
        .insert(giftVouchers)
        .values({
          code: newVoucherCode(prefix),
          purchaserName: order.fromName,
          purchaserEmail: order.buyerEmail,
          recipientName: order.recipientName,
          therapyId: order.therapyId,
          valueEur: order.valueCents / 100,
          balanceEur: order.valueCents / 100,
          isRedeemed: false,
          purchaseDate: today,
          expiryDate: expiryDate(today, years),
          source: "online",
          kind: order.kind,
          voucherOrderId: order.id,
          message: order.message,
          colourway: order.colourway,
          viewToken: newViewToken(),
        })
        .returning()
        .all();
      tx.update(voucherOrders).set({ giftVoucherId: v!.id }).where(eq(voucherOrders.id, order.id)).run();
      return v!;
    });
    if (!voucher) return { status: "already" as const, orderId: order.id };

    const paid = getVoucherOrder(order.id)!;
    await logActivity("voucher_sale", `${order.buyerName} bought a gift voucher online for ${order.recipientName} (${voucherTitle({ kind: order.kind, valueEur: order.valueCents / 100, therapyName: therapyName(order.therapyId) })})`, {
      orderId: order.id,
      voucherId: voucher.id,
    });

    const receipt = await sendReceipt(tenantId, paid, voucher, send);
    if (paid.deliverTo === "buyer") {
      // Sent to the buyer: the receipt IS the delivery.
      if (receipt.ok) markDelivered(paid.id, now);
      else failDelivery(paid.id, receipt.error);
    } else if (paid.deliverOn === null) {
      await deliverGift(tenantId, paid.id, send, now);
    }
    return { status: "fulfilled" as const, orderId: order.id, voucherId: voucher.id };
  });
}

export function expireVoucherOrder(tenantId: number, sessionId: string): void {
  runWithTenant(tenantId, () => {
    const order = voucherOrderForSession(sessionId);
    if (order) setVoucherOrderStatus(order.id, "expired", ["pending"]);
  });
}

/**
 * Stripe refunded a payment. False when it wasn't a voucher order (the
 * caller then tries the offer orders). An unused voucher is cancelled; a
 * part-used one is left as it is and flagged for staff, because the money
 * already spent on it can't be taken back by cancelling.
 */
export function refundVoucherOrder(tenantId: number, paymentIntentId: string, now = Date.now()): boolean {
  return runWithTenant(tenantId, () => {
    const order = voucherOrderForPaymentIntent(paymentIntentId);
    if (!order) return false;
    if (!setVoucherOrderStatus(order.id, "refunded", ["paid"])) return true;
    const v = order.giftVoucherId ? getVoucherById(order.giftVoucherId) : null;
    if (!v) return true;
    if (Math.round(v.balanceEur * 100) >= Math.round(v.valueEur * 100)) {
      cancelVoucher(v.id, now);
      void logActivity("voucher_refund", `Voucher ${v.code} was refunded in Stripe and has been cancelled.`, { orderId: order.id, voucherId: v.id });
    } else {
      void logActivity("voucher_refund_part_used", `Voucher ${v.code} was refunded in Stripe after part of it was used. Check it with the buyer.`, {
        orderId: order.id,
        voucherId: v.id,
      });
    }
    return true;
  });
}
```

- [ ] **Step 4: Route `kind=voucher` events in the webhook**

Offers keep exactly their current behaviour.

In `app/src/app/api/stripe/webhook/route.ts`, replace:

```ts
import { expireOrder, fulfilCheckout, recoverAbandonedCheckout, refundOrder } from "@/lib/offers/fulfil";
```

with:

```ts
import { expireOrder, fulfilCheckout, recoverAbandonedCheckout, refundOrder } from "@/lib/offers/fulfil";
import { expireVoucherOrder, fulfilVoucherCheckout, refundVoucherOrder } from "@/lib/vouchers/fulfil";
```

In `app/src/app/api/stripe/webhook/route.ts`, replace:

```ts
  const obj = event.data?.object ?? {};
  if (!tenantId) return NextResponse.json({ ok: true, ignored: "unknown account" });

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await fulfilCheckout(tenantId, account, obj as unknown as CheckoutSession);
        break;
      case "checkout.session.expired":
        expireOrder(tenantId, String(obj.id ?? ""));
        // Gave their details but never paid: a lead, and the follow-up if switched on.
        await recoverAbandonedCheckout(tenantId, obj as unknown as CheckoutSession);
        break;
      case "charge.refunded": {
        const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : "";
        if (pi && obj.refunded === true) refundOrder(tenantId, pi);
        break;
      }
```

with:

```ts
  const obj = event.data?.object ?? {};
  if (!tenantId) return NextResponse.json({ ok: true, ignored: "unknown account" });
  // Gift vouchers from the voucher store carry kind=voucher (lib/vouchers);
  // everything else is an offer, handled exactly as before.
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  const isVoucher = meta.kind === "voucher";

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (isVoucher) await fulfilVoucherCheckout(tenantId, account, obj as unknown as CheckoutSession);
        else await fulfilCheckout(tenantId, account, obj as unknown as CheckoutSession);
        break;
      case "checkout.session.expired":
        if (isVoucher) {
          expireVoucherOrder(tenantId, String(obj.id ?? ""));
          break;
        }
        expireOrder(tenantId, String(obj.id ?? ""));
        // Gave their details but never paid: a lead, and the follow-up if switched on.
        await recoverAbandonedCheckout(tenantId, obj as unknown as CheckoutSession);
        break;
      case "charge.refunded": {
        const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : "";
        // A charge may not carry the payment's metadata, so a voucher order is
        // found by its payment id; anything that isn't one is an offer order.
        if (pi && obj.refunded === true && !refundVoucherOrder(tenantId, pi)) refundOrder(tenantId, pi);
        break;
      }
```

- [ ] **Step 5: Hook gift delivery into the dispatch ticker**

In `app/src/lib/dispatch/ticker.ts`, replace:

```ts
 *   - the campaign nurture sequence's delayed messages (lib/automations/nurture.ts)
```

with:

```ts
 *   - the campaign nurture sequence's delayed messages (lib/automations/nurture.ts)
 *   - gift vouchers bought for a date, emailed at 09:00 Irish time (lib/vouchers/deliver.ts)
```

In `app/src/lib/dispatch/ticker.ts`, replace:

```ts
import { resealAllSecrets } from "@/lib/security/resealSecrets";
```

with:

```ts
import { resealAllSecrets } from "@/lib/security/resealSecrets";
import { dispatchDueVoucherGifts } from "@/lib/vouchers/deliver";
```

In `app/src/lib/dispatch/ticker.ts`, replace:

```ts
  nurtureSent: number;
}
```

with:

```ts
  nurtureSent: number;
  vouchersSent: number;
}
```

In `app/src/lib/dispatch/ticker.ts`, replace:

```ts
  return { tenants: 0, emailsStarted: 0, postsPublished: 0, blogsPublished: 0, nurtureSent: 0 };
```

with:

```ts
  return { tenants: 0, emailsStarted: 0, postsPublished: 0, blogsPublished: 0, nurtureSent: 0, vouchersSent: 0 };
```

In `app/src/lib/dispatch/ticker.ts`, replace:

```ts
    } catch (err) {
      console.error(`[dispatch] tenant ${tenantId} nurture queue failed:`, err);
    }
```

with:

```ts
    } catch (err) {
      console.error(`[dispatch] tenant ${tenantId} nurture queue failed:`, err);
    }
    // Gift vouchers bought for a date: emailed at 09:00 Irish time that day.
    // Not gated on the store flag, so a voucher already paid for is still
    // delivered if the store is later switched off.
    try {
      summary.vouchersSent += await dispatchDueVoucherGifts(tenantId);
    } catch (err) {
      console.error(`[dispatch] tenant ${tenantId} voucher gifts failed:`, err);
    }
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `cd app && npm test -- src/lib/vouchers/fulfil.test.ts`
Expected: PASS, printing `vouchers fulfil: one voucher per payment, delivery, refunds, webhook routing; all passed`. Three expected log lines appear (an amount mismatch, `mailbox full`, `Platform email isn't configured`).

Run: `cd app && npm test -- src/lib/dispatch/dispatch.test.ts` and `cd app && npm test -- src/lib/offers/salesFunnel.test.ts`
Expected: both PASS (the ticker and offers are otherwise unchanged).

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/vouchers/fulfil.ts app/src/lib/vouchers/fulfil.test.ts app/src/app/api/stripe/webhook/route.ts app/src/lib/dispatch/ticker.ts
git commit -m "$(cat <<'EOF'
feat(vouchers): one voucher per payment from webhook or return, refunds, 9am gift delivery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The public store at `/vouchers`

**Files:**
- Create: `app/src/components/vouchers/RevealCard.tsx`
- Create: `app/src/components/vouchers/VoucherBuilder.tsx`
- Create: `app/src/app/site/[siteSlug]/vouchers/page.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, 5 (`fulfilVoucherCheckout` for the return page). Existing: `resolvePublicSite`, `siteUrl`, `PublicSite`; `siteRequestHost`; `getSiteChrome`, `CHROME_CONTENT_CSS`; `resolvePageContext`, `siteVerificationMeta` from `lib/cms/render.ts`; `PublicSitePage` + its `generateMetadata` from `app/site/[siteSlug]/[...slug]/page.tsx`; `SiteTracking({ siteSlug, pixelId, googleTagId })`, `SiteBeacon()`.
- Produces:
  - `RevealCard(props: RevealCardProps)` with `RevealCardProps { colourway: Colourway; businessName: string; title: string; forName: string; code: string; expiryLabel: string }` (used by Tasks 7 and 8).
  - `VoucherBuilder(props: VoucherBuilderProps)` with `{ token: string | null; businessName; phone; intro; settings: VoucherStoreSettings; treatments: StoreTreatment[]; colourways: Colourway[]; today: string }`.

No unit test: the page is checked in the browser in Step 4 and in Task 11; its rules are the model's (Task 2) and the checkout's (Task 3), both tested.

- [ ] **Step 1: Write the reveal card**

Create `app/src/components/vouchers/RevealCard.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

import type { Colourway } from "@/lib/vouchers/model";

/**
 * The gift voucher card: a foil card in the business's own colours that
 * catches the light as the pointer moves or the phone tilts. Used by the
 * store's live preview, the recipient's gift page, the thank-you view and
 * the staff voucher page, so the voucher looks the same everywhere.
 *
 * Generalised from the old Renova-only HolographicCard. Every colour comes
 * from the colourway (lib/vouchers/model colourways); the type is the page's
 * own (inherit), so on a client site it is set in the site's typeface.
 *
 * Motion: pointer and device tilt write CSS variables on the card element,
 * one write per animation frame, so React never re-renders on a move. With
 * prefers-reduced-motion nothing is listened to and the card stays flat.
 * iPhone Safari only reports tilt after a tap grants permission, so the
 * first tap on the card asks.
 */
export interface RevealCardProps {
  colourway: Colourway;
  businessName: string;
  /** "€50", or the treatment's name. */
  title: string;
  /** The recipient's name. */
  forName: string;
  code: string;
  /** "Valid until 23 November 2031". */
  expiryLabel: string;
}

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

export function RevealCard({ colourway: c, businessName, title, forName, code, expiryLabel }: RevealCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const card = ref.current;
    if (!card || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const set = (x: number, y: number, live: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cx = Math.min(1, Math.max(0, x));
        const cy = Math.min(1, Math.max(0, y));
        card.style.setProperty("--rc-x", cx.toFixed(3));
        card.style.setProperty("--rc-y", cy.toFixed(3));
        card.style.setProperty("--rc-ry", `${((cx - 0.5) * 14).toFixed(2)}deg`);
        card.style.setProperty("--rc-rx", `${((0.5 - cy) * 12).toFixed(2)}deg`);
        card.classList.toggle("is-live", live);
      });
    };
    const onMove = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, true);
    };
    const onLeave = () => set(0.5, 0.5, false);
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      // Held upright-ish in the hand, beta sits near 45 degrees.
      set(0.5 + e.gamma / 60, 0.5 + (e.beta - 45) / 60, true);
    };
    let asked = false;
    const askForTilt = () => {
      if (asked) return;
      asked = true;
      const D = (window as unknown as { DeviceOrientationEvent?: OrientationPermission }).DeviceOrientationEvent;
      if (D?.requestPermission) {
        D.requestPermission()
          .then((r) => {
            if (r === "granted") window.addEventListener("deviceorientation", onTilt);
          })
          .catch(() => undefined);
      }
    };

    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    card.addEventListener("pointerdown", askForTilt);
    const D = (window as unknown as { DeviceOrientationEvent?: OrientationPermission }).DeviceOrientationEvent;
    if (D && !D.requestPermission) window.addEventListener("deviceorientation", onTilt);
    return () => {
      cancelAnimationFrame(frame);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      card.removeEventListener("pointerdown", askForTilt);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, []);

  const vars = {
    "--rc-base": c.base,
    "--rc-base2": c.base2,
    "--rc-f1": c.foil[0],
    "--rc-f2": c.foil[1],
    "--rc-f3": c.foil[2],
    "--rc-ink": c.ink,
  } as React.CSSProperties;

  return (
    <div className="rc-wrap">
      <style dangerouslySetInnerHTML={{ __html: RC_CSS }} />
      <div ref={ref} className="rc" style={vars} role="img" aria-label={`${businessName} gift voucher: ${title} for ${forName}. Code ${code}. ${expiryLabel}.`}>
        <div className="rc__foil" aria-hidden />
        <div className="rc__sheen" aria-hidden />
        <div className="rc__body" aria-hidden>
          <div className="rc__top">
            <span className="rc__brand">{businessName}</span>
            <span className="rc__tag">Gift voucher</span>
          </div>
          <div>
            <div className={`rc__title${title.length > 10 ? " rc__title--long" : ""}`}>{title}</div>
            <div className="rc__for">For {forName}</div>
          </div>
          <div className="rc__bottom">
            <span className="rc__code">{code}</span>
            <span className="rc__exp">{expiryLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const RC_CSS = `
.rc-wrap{perspective:1200px;display:flex;justify-content:center;width:100%}
.rc{--rc-x:.5;--rc-y:.5;--rc-rx:0deg;--rc-ry:0deg;position:relative;width:min(420px,100%);aspect-ratio:1.586;border-radius:22px;overflow:hidden;isolation:isolate;color:var(--rc-ink);background:linear-gradient(135deg,var(--rc-base) 0%,var(--rc-base2) 100%);transform:rotateX(var(--rc-rx)) rotateY(var(--rc-ry));transition:transform .5s cubic-bezier(.2,.85,.3,1);box-shadow:0 30px 60px -28px rgba(0,0,0,.55),0 12px 24px -14px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.14);font-family:inherit}
.rc.is-live{transition:transform .08s linear}
.rc__foil{position:absolute;inset:-30%;background:conic-gradient(from 200deg at calc(var(--rc-x) * 100%) calc(var(--rc-y) * 100%),var(--rc-f1),var(--rc-f2),var(--rc-f3),var(--rc-f1));mix-blend-mode:soft-light;opacity:.6;filter:blur(6px) saturate(1.2);pointer-events:none}
.rc__sheen{position:absolute;inset:0;background:radial-gradient(circle at calc(var(--rc-x) * 100%) calc(var(--rc-y) * 100%),rgba(255,255,255,.42),rgba(255,255,255,0) 46%);mix-blend-mode:overlay;pointer-events:none}
.rc__body{position:relative;z-index:1;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;padding:clamp(16px,5vw,28px)}
.rc__top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:11px;letter-spacing:.22em;text-transform:uppercase}
.rc__brand{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rc__tag{opacity:.75;white-space:nowrap}
.rc__title{text-align:center;font-size:clamp(34px,11vw,64px);line-height:1.05;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}
.rc__title--long{font-size:clamp(22px,6.5vw,38px)}
.rc__for{text-align:center;margin-top:10px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;opacity:.85}
.rc__bottom{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding-top:12px;border-top:1px solid var(--rc-f2)}
.rc__code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;letter-spacing:.14em}
.rc__exp{font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;text-align:right}
@media (prefers-reduced-motion:reduce){.rc{transform:none!important;transition:none}.rc__foil{opacity:.45}}
@media print{.rc{box-shadow:none;transform:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
```

- [ ] **Step 2: Write the builder**

Create `app/src/components/vouchers/VoucherBuilder.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";

import { RevealCard } from "@/components/vouchers/RevealCard";
import {
  expiryDate,
  formatEuro,
  formatLongDate,
  latestDeliveryDate,
  validateOrder,
  voucherTitle,
  type Colourway,
  type DeliverTo,
  type OrderDraft,
  type OrderDraftField,
  type StoreTreatment,
  type VoucherKind,
  type VoucherStoreSettings,
} from "@/lib/vouchers/model";

/**
 * The voucher store, on the business's own site: a live preview of the card
 * beside the choices (what, who, look, delivery, pay). Everything visual it
 * cannot know comes from the site's own stylesheet; it sets layout, and
 * colours only on the card and the Pay button, which wear the chosen
 * colourway. Checks run in the browser with the same rules the server uses
 * (lib/vouchers/model validateOrder), so the server's answer is never a
 * surprise.
 */
export interface VoucherBuilderProps {
  /** Signed store token; null when payments aren't ready (no Pay button). */
  token: string | null;
  businessName: string;
  phone: string;
  intro: string;
  settings: VoucherStoreSettings;
  treatments: StoreTreatment[];
  colourways: Colourway[];
  /** Today in Ireland, YYYY-MM-DD (from the server, so the date range is Irish). */
  today: string;
}

type Choice = { kind: "amount"; euros: number } | { kind: "custom" } | { kind: "treatment" };

export function VoucherBuilder(p: VoucherBuilderProps) {
  const firstChoice: Choice = p.settings.amounts.length
    ? { kind: "amount", euros: p.settings.amounts[Math.min(1, p.settings.amounts.length - 1)]! }
    : p.settings.allowCustom
      ? { kind: "custom" }
      : { kind: "treatment" };
  const [choice, setChoice] = useState<Choice>(firstChoice);
  const [custom, setCustom] = useState("");
  const [therapyId, setTherapyId] = useState<number | null>(p.treatments[0]?.id ?? null);
  const [toName, setToName] = useState("");
  const [fromName, setFromName] = useState("");
  const [message, setMessage] = useState("");
  const [colourwayId, setColourwayId] = useState(p.colourways[0]?.id ?? "");
  const [deliverTo, setDeliverTo] = useState<DeliverTo>("recipient");
  const [when, setWhen] = useState<"now" | "date">("now");
  const [deliverOn, setDeliverOn] = useState(p.today);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [error, setError] = useState<{ field: OrderDraftField | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const kind: VoucherKind = choice.kind === "treatment" ? "treatment" : "amount";
  const amountEur = choice.kind === "amount" ? choice.euros : choice.kind === "custom" && custom.trim() ? Number(custom) : null;
  const treatment = p.treatments.find((t) => t.id === therapyId) ?? null;
  const colourway = p.colourways.find((c) => c.id === colourwayId) ?? p.colourways[0]!;
  const latest = latestDeliveryDate(p.today);
  const expiryLabel = `Valid until ${formatLongDate(expiryDate(p.today, p.settings.expiryYears))}`;
  const title =
    kind === "treatment"
      ? voucherTitle({ kind, valueEur: treatment?.priceEur ?? 0, therapyName: treatment?.name ?? "Treatment" })
      : amountEur && Number.isFinite(amountEur) && amountEur > 0
        ? formatEuro(amountEur)
        : "€";
  const priceEur = kind === "treatment" ? treatment?.priceEur ?? 0 : amountEur ?? 0;

  const draft: OrderDraft = useMemo(
    () => ({
      kind,
      amountEur,
      therapyId: kind === "treatment" ? therapyId : null,
      toName,
      fromName,
      message,
      colourwayId,
      deliverTo,
      recipientEmail,
      deliverOn: deliverTo === "recipient" && when === "date" ? deliverOn : null,
      buyerName,
      buyerEmail,
    }),
    [kind, amountEur, therapyId, toName, fromName, message, colourwayId, deliverTo, recipientEmail, when, deliverOn, buyerName, buyerEmail],
  );

  const errorFor = (field: OrderDraftField) =>
    error && error.field === field ? (
      <p className="vb__error" role="alert" id={`vb-err-${field}`}>
        {error.message}
      </p>
    ) : null;
  const invalid = (field: OrderDraftField) => (error?.field === field ? { "aria-invalid": true, "aria-describedby": `vb-err-${field}` } : {});

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!p.token || busy) return;
    const check = validateOrder(draft, { settings: p.settings, treatments: p.treatments, colourwayIds: p.colourways.map((c) => c.id), today: p.today });
    if (!check.ok) {
      setError({ field: check.field, message: check.error });
      document.getElementById(`vb-${check.field}`)?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/voucher-store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: p.token, order: draft }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string; field?: OrderDraftField } | null;
      if (data?.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError({ field: data?.field ?? "form", message: data?.error ?? "Payments aren't working right now. Nothing was charged." });
    } catch {
      setError({ field: "form", message: "We couldn't reach the payment page. Nothing was charged. Please try again." });
    }
    setBusy(false);
  }

  const shownName = toName.trim() || "them";

  return (
    <div className="vb">
      <style dangerouslySetInnerHTML={{ __html: VB_CSS }} />
      <div className="vb__head">
        <h1>Gift vouchers</h1>
        <p>{p.intro || `Buy a gift voucher for ${p.businessName}. Send it by email now or on a date you choose.`}</p>
      </div>

      <div className="vb__grid">
        <div className="vb__preview">
          <RevealCard
            colourway={colourway}
            businessName={p.businessName}
            title={title}
            forName={toName.trim() || "someone special"}
            code="Your code"
            expiryLabel={expiryLabel}
          />
          {message.trim() && <p className="vb__note">&ldquo;{message.trim()}&rdquo;{fromName.trim() ? ` From ${fromName.trim()}.` : ""}</p>}
        </div>

        {!p.token ? (
          <div className="vb__closed">
            <h2>Not taking orders online yet</h2>
            <p>{p.phone ? `To buy a gift voucher, call ${p.phone}.` : `To buy a gift voucher, contact ${p.businessName}.`}</p>
          </div>
        ) : (
          <form className="vb__form" onSubmit={pay} noValidate>
            <fieldset>
              <legend>1. Choose the gift</legend>
              <div className="vb__chips" id="vb-amountEur" tabIndex={-1}>
                {p.settings.amounts.map((a) => (
                  <button key={a} type="button" className="vb__chip" aria-pressed={choice.kind === "amount" && choice.euros === a} onClick={() => setChoice({ kind: "amount", euros: a })}>
                    {formatEuro(a)}
                  </button>
                ))}
                {p.settings.allowCustom && (
                  <button type="button" className="vb__chip" aria-pressed={choice.kind === "custom"} onClick={() => setChoice({ kind: "custom" })}>
                    Other amount
                  </button>
                )}
                {p.treatments.length > 0 && (
                  <button type="button" className="vb__chip" aria-pressed={choice.kind === "treatment"} onClick={() => setChoice({ kind: "treatment" })}>
                    A treatment
                  </button>
                )}
              </div>
              {choice.kind === "custom" && (
                <label className="vb__field">
                  <span>
                    Amount in euros, {formatEuro(p.settings.customMin)} to {formatEuro(p.settings.customMax)}
                  </span>
                  <input inputMode="numeric" pattern="[0-9]*" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))} {...invalid("amountEur")} />
                </label>
              )}
              {choice.kind === "treatment" && (
                <label className="vb__field">
                  <span>Treatment</span>
                  <span className="vb__select">
                    <select id="vb-therapyId" value={therapyId ?? ""} onChange={(e) => setTherapyId(Number(e.target.value) || null)} {...invalid("therapyId")}>
                      {p.treatments.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}, {formatEuro(t.priceEur)}
                        </option>
                      ))}
                    </select>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </label>
              )}
              {errorFor("amountEur")}
              {errorFor("therapyId")}
            </fieldset>

            <fieldset>
              <legend>2. Who is it for?</legend>
              <label className="vb__field">
                <span>To</span>
                <input id="vb-toName" value={toName} maxLength={60} autoComplete="off" onChange={(e) => setToName(e.target.value)} {...invalid("toName")} />
              </label>
              {errorFor("toName")}
              <label className="vb__field">
                <span>From</span>
                <input id="vb-fromName" value={fromName} maxLength={60} onChange={(e) => setFromName(e.target.value)} {...invalid("fromName")} />
              </label>
              {errorFor("fromName")}
              <label className="vb__field">
                <span>Message (optional)</span>
                <textarea id="vb-message" value={message} maxLength={200} rows={3} onChange={(e) => setMessage(e.target.value)} {...invalid("message")} />
              </label>
              <p className="vb__hint">{200 - message.length} characters left</p>
              {errorFor("message")}
            </fieldset>

            <fieldset>
              <legend>3. Card colour</legend>
              <div className="vb__swatches" id="vb-colourwayId" tabIndex={-1}>
                {p.colourways.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="vb__swatch"
                    aria-pressed={c.id === colourwayId}
                    aria-label={c.name}
                    title={c.name}
                    onClick={() => setColourwayId(c.id)}
                    style={{ background: `linear-gradient(135deg, ${c.base}, ${c.base2})`, boxShadow: `inset 0 0 0 3px ${c.foil[1]}` }}
                  />
                ))}
              </div>
              {errorFor("colourwayId")}
            </fieldset>

            <fieldset>
              <legend>4. How should it arrive?</legend>
              <div className="vb__chips">
                <button type="button" className="vb__chip" aria-pressed={deliverTo === "recipient"} onClick={() => setDeliverTo("recipient")}>
                  Email it to {shownName}
                </button>
                <button type="button" className="vb__chip" aria-pressed={deliverTo === "buyer"} onClick={() => setDeliverTo("buyer")}>
                  Send it to me
                </button>
              </div>
              {deliverTo === "recipient" && (
                <>
                  <label className="vb__field">
                    <span>Their email</span>
                    <input id="vb-recipientEmail" type="email" inputMode="email" autoComplete="off" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} {...invalid("recipientEmail")} />
                  </label>
                  {errorFor("recipientEmail")}
                  <div className="vb__chips">
                    <button type="button" className="vb__chip" aria-pressed={when === "now"} onClick={() => setWhen("now")}>
                      Now
                    </button>
                    <button type="button" className="vb__chip" aria-pressed={when === "date"} onClick={() => setWhen("date")}>
                      On a date
                    </button>
                  </div>
                  {when === "date" && (
                    <label className="vb__field">
                      <span>Date (it arrives at 9am)</span>
                      <input id="vb-deliverOn" type="date" min={p.today} max={latest} value={deliverOn} onChange={(e) => setDeliverOn(e.target.value)} {...invalid("deliverOn")} />
                    </label>
                  )}
                  {errorFor("deliverOn")}
                </>
              )}
              {deliverTo === "buyer" && <p className="vb__hint">We email the voucher to you. Print it or forward it.</p>}
            </fieldset>

            <fieldset>
              <legend>5. Your details</legend>
              <label className="vb__field">
                <span>Your name</span>
                <input id="vb-buyerName" autoComplete="name" value={buyerName} maxLength={60} onChange={(e) => setBuyerName(e.target.value)} {...invalid("buyerName")} />
              </label>
              {errorFor("buyerName")}
              <label className="vb__field">
                <span>Your email (for the receipt)</span>
                <input id="vb-buyerEmail" type="email" inputMode="email" autoComplete="email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} {...invalid("buyerEmail")} />
              </label>
              {errorFor("buyerEmail")}
            </fieldset>

            {error?.field === "form" || error?.field === "kind" || error?.field === "deliverTo" ? (
              <p className="vb__error" role="alert">
                {error.message}
              </p>
            ) : null}
            <button type="submit" className="vb__pay" disabled={busy} aria-busy={busy} style={{ background: colourway.base, color: colourway.ink }}>
              {busy ? "Opening secure payment" : priceEur > 0 ? `Pay ${formatEuro(priceEur)}` : "Pay"}
            </button>
            <p className="vb__hint">
              Paid securely with Stripe to {p.businessName}. {expiryLabel}.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

const VB_CSS = `
.vb{max-width:1180px;margin:0 auto;padding:clamp(40px,7vw,96px) 16px clamp(56px,8vw,110px);box-sizing:border-box}
@media(min-width:640px){.vb{padding-left:clamp(18px,4vw,40px);padding-right:clamp(18px,4vw,40px)}}
.vb *,.vb *::before,.vb *::after{box-sizing:border-box}
.vb__head h1{font-size:clamp(34px,6vw,60px);line-height:1.05;margin:0}
.vb__head p{margin:.7em 0 0;max-width:56ch;opacity:.78;line-height:1.6}
.vb__grid{display:grid;gap:clamp(28px,4vw,56px);margin-top:clamp(26px,4vw,44px)}
@media(min-width:900px){.vb__grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.vb__preview{position:sticky;top:96px}}
.vb__note{margin:18px auto 0;max-width:420px;text-align:center;font-style:italic;opacity:.8;line-height:1.6;overflow-wrap:anywhere}
.vb fieldset{border:0;padding:0;margin:0 0 28px;min-width:0}
.vb legend{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px;padding:0}
.vb__chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;outline:none}
.vb__chip{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid rgba(127,127,127,.55);background:transparent;color:inherit;font:inherit;font-size:15px;line-height:1.2;cursor:pointer;max-width:100%;overflow-wrap:anywhere}
.vb__chip[aria-pressed="true"]{border-color:currentColor;box-shadow:inset 0 0 0 1px currentColor;font-weight:600}
.vb__field{display:block;margin:0 0 12px}
.vb__field > span:first-child{display:block;font-size:14px;margin-bottom:6px;opacity:.8}
.vb input,.vb textarea,.vb select{display:block;width:100%;min-height:48px;padding:12px 16px;border-radius:10px;border:1px solid rgba(127,127,127,.55);background:transparent;color:inherit;font:inherit;font-size:16px}
.vb textarea{min-height:96px;resize:vertical}
.vb__select{position:relative;display:block}
.vb select{appearance:none;-webkit-appearance:none;padding-right:40px;cursor:pointer}
.vb select option{color:#111;background:#fff}
.vb__select svg{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.75}
.vb__swatches{display:flex;flex-wrap:wrap;gap:12px;outline:none}
.vb__swatch{width:48px;height:48px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
.vb__swatch[aria-pressed="true"]{outline:2px solid currentColor;outline-offset:3px}
.vb__hint{margin:4px 0 0;font-size:13px;opacity:.7;line-height:1.5}
.vb__error{margin:4px 0 12px;font-size:14px;line-height:1.4;color:#c62828;font-weight:600}
.vb__pay{display:block;width:100%;min-height:54px;padding:0 24px;border:0;border-radius:999px;font:inherit;font-size:17px;font-weight:600;cursor:pointer;margin-top:4px}
.vb__pay[disabled]{opacity:.65;cursor:progress}
.vb__closed{padding:clamp(20px,4vw,32px);border:1px solid rgba(127,127,127,.4);border-radius:14px}
.vb__closed h2{margin:0 0 .4em;font-size:clamp(22px,3vw,28px)}
.vb__closed p{margin:0;line-height:1.6;opacity:.85}
.vb :focus-visible{outline:2px solid currentColor;outline-offset:3px}
`;
```

- [ ] **Step 3: Write the page**

Create `app/src/app/site/[siteSlug]/vouchers/page.tsx`:

```tsx
/**
 * The voucher store, at /vouchers on the business's own site (its domain in
 * production; the middleware rewrites /vouchers there to this route).
 *
 * Inside the site's own chrome (lib/cms/siteChrome): its stylesheet, navbar
 * and footer, like the blog, because the store is part of the website.
 *
 * NAMESPACE NOTE: this static route is picked ahead of the [...slug]
 * catch-all for /vouchers on every site. While the store is OFF, a site that
 * has its own published /vouchers page gets that page, exactly as the blog
 * route defers to a site's own /blog; a site with neither gets a 404.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolvePublicSite, siteUrl, type PublicSite } from "@/lib/cms/resolveHost";
import { siteRequestHost } from "@/lib/cms/requestHost";
import { CHROME_CONTENT_CSS, getSiteChrome } from "@/lib/cms/siteChrome";
import { resolvePageContext, siteVerificationMeta } from "@/lib/cms/render";
import { runWithTenant } from "@/lib/db/tenant";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getCheckoutSession } from "@/lib/stripe/api";
import { canTakePayments, getStripeConnection } from "@/lib/stripe/connection";
import { SiteTracking } from "@/components/cms/SiteTracking";
import { SiteBeacon } from "@/components/cms/SiteBeacon";
import { RevealCard } from "@/components/vouchers/RevealCard";
import { VoucherBuilder } from "@/components/vouchers/VoucherBuilder";
import { fulfilVoucherCheckout } from "@/lib/vouchers/fulfil";
import {
  colourways,
  dublinDate,
  formatLongDate,
  parseColourway,
  voucherTitle,
  type Colourway,
  type DeliverTo,
} from "@/lib/vouchers/model";
import {
  brandPaletteForTenant,
  getStoreSettings,
  getVoucherById,
  getVoucherOrder,
  storeFlagOn,
  storeTreatments,
  therapyName,
} from "@/lib/vouchers/store";
import { signVoucherStoreToken, siteRootUrl } from "@/lib/vouchers/storeToken";

import PublicSitePage, { generateMetadata as pageMetadata } from "../[...slug]/page";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ site?: string; paid?: string; session_id?: string }>;
};

const PATH = ["vouchers"];

function storeOpen(site: PublicSite): boolean {
  return storeFlagOn(site.tenantId) && runWithTenant(site.tenantId, () => getStoreSettings().enabled);
}

function ownsVouchersPage(siteSlug: string, site?: string): boolean {
  const pc = resolvePageContext({ siteSlug, slug: PATH }, { site });
  return Boolean(pc && pc.template);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const host = siteRequestHost();
  const resolved = resolvePublicSite({ host, siteParam: searchParams.site ?? params.siteSlug });
  if (!resolved) return { title: "Not found" };
  if (!storeOpen(resolved)) {
    if (ownsVouchersPage(params.siteSlug, searchParams.site)) {
      return pageMetadata({ params: Promise.resolve({ siteSlug: params.siteSlug, slug: PATH }), searchParams: Promise.resolve({ site: searchParams.site }) });
    }
    return { title: "Not found" };
  }
  const p = getBusinessProfileForTenant(resolved.tenantId);
  const town = p.location.split(",")[0]?.trim() ?? "";
  const years = runWithTenant(resolved.tenantId, () => getStoreSettings().expiryYears);
  const title = `Gift Vouchers${town ? ` ${town}` : ""} | ${resolved.site.name}`;
  const description = `Buy a ${resolved.site.name} gift voucher online. Choose an amount or a treatment, add a message and send it by email. Valid for ${years} years.`;
  const canonical = siteUrl(resolved, "/vouchers", host);
  return {
    title,
    description,
    alternates: { canonical },
    verification: siteVerificationMeta(resolved.site),
    openGraph: { title, description, url: canonical, siteName: resolved.site.name, type: "website" },
    // The thank-you view carries an order number: never indexed.
    robots: searchParams.paid ? { index: false, follow: false } : { index: true, follow: true },
  };
}

interface Thanks {
  status: "paid" | "processing";
  colourway: Colourway;
  title: string;
  toName: string;
  buyerEmail: string;
  deliverTo: DeliverTo;
  recipientEmail: string | null;
  deliverOn: string | null;
  code: string | null;
  expiry: string | null;
  revealUrl: string | null;
}

/**
 * The buyer back from Stripe (?paid=<order>&session_id=<session>). If the
 * webhook hasn't landed yet, ask Stripe and fulfil here (the claim inside
 * fulfilVoucherCheckout keeps it to one voucher). Only a session id that
 * matches the order counts, so a guessed order number shows nothing.
 */
async function purchaseState(tenantId: number, sp: Awaited<Props["searchParams"]>): Promise<Thanks | null> {
  const orderId = Number(sp.paid);
  const sessionId = String(sp.session_id ?? "");
  if (!Number.isInteger(orderId) || orderId <= 0 || !sessionId.startsWith("cs_")) return null;
  let order = runWithTenant(tenantId, () => getVoucherOrder(orderId));
  if (!order || order.stripeSessionId !== sessionId) return null;
  if (order.status === "pending" || order.status === "expired") {
    const s = await getCheckoutSession(order.stripeAccountId, sessionId);
    if (s.ok && s.data.client_reference_id === String(order.id)) await fulfilVoucherCheckout(tenantId, order.stripeAccountId, s.data);
    order = runWithTenant(tenantId, () => getVoucherOrder(orderId));
  }
  if (!order || (order.status !== "paid" && order.status !== "pending")) return null;
  const o = order;
  return runWithTenant(tenantId, () => {
    const v = o.giftVoucherId ? getVoucherById(o.giftVoucherId) : null;
    return {
      status: o.status === "paid" ? ("paid" as const) : ("processing" as const),
      colourway: parseColourway(o.colourway) ?? colourways(brandPaletteForTenant(tenantId))[0]!,
      title: voucherTitle({ kind: o.kind, valueEur: o.valueCents / 100, therapyName: therapyName(o.therapyId) }),
      toName: o.recipientName,
      buyerEmail: o.buyerEmail,
      deliverTo: o.deliverTo,
      recipientEmail: o.recipientEmail,
      deliverOn: o.deliverOn,
      code: v?.code ?? null,
      expiry: v?.expiryDate ?? null,
      revealUrl: v?.viewToken ? `${o.siteUrl}/v/${v.viewToken}` : null,
    };
  });
}

export default async function VoucherStorePage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const host = siteRequestHost();
  const resolved = resolvePublicSite({ host, siteParam: searchParams.site ?? params.siteSlug });
  if (!resolved) notFound();
  if (!storeOpen(resolved)) {
    if (ownsVouchersPage(params.siteSlug, searchParams.site)) {
      return PublicSitePage({ params: Promise.resolve({ siteSlug: params.siteSlug, slug: PATH }), searchParams: Promise.resolve({ site: searchParams.site }) });
    }
    notFound();
  }

  const tid = resolved.tenantId;
  const business = getBusinessProfileForTenant(tid);
  const chrome = getSiteChrome(resolved.db, resolved.site.id, resolved.resolvedVia === "host" ? resolved.site.slug : null);
  const purchase = searchParams.paid ? await purchaseState(tid, searchParams) : null;
  const store = runWithTenant(tid, () => {
    const settings = getStoreSettings();
    return { settings, treatments: storeTreatments(settings.therapyIds), palette: colourways(brandPaletteForTenant(tid)) };
  });
  const ready = canTakePayments(getStripeConnection(tid));
  const token = ready ? signVoucherStoreToken({ tenantId: tid, siteId: resolved.site.id, siteUrl: siteRootUrl(resolved, host) }) : null;

  return (
    <>
      <SiteTracking siteSlug={resolved.site.slug} pixelId={resolved.site.metaPixelId} googleTagId={resolved.site.googleTagId} />
      <SiteBeacon />
      <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
      <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS + THANKS_CSS }} />
      {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}

      <main>
        {purchase ? (
          <section className="cms-shell vt">
            <div className="vt__card">
              <RevealCard
                colourway={purchase.colourway}
                businessName={business.businessName}
                title={purchase.title}
                forName={purchase.toName}
                code={purchase.code ?? "Your code"}
                expiryLabel={purchase.expiry ? `Valid until ${formatLongDate(purchase.expiry)}` : "Gift voucher"}
              />
            </div>
            <div className="vt__text">
              <h1>Thank you</h1>
              {purchase.status === "paid" ? (
                <>
                  <p>Your voucher is paid. Your receipt is on its way to {purchase.buyerEmail}.</p>
                  <p>
                    {purchase.deliverTo === "buyer"
                      ? "The voucher is in that email. You can open it now too."
                      : purchase.deliverOn
                        ? `We will email it to ${purchase.toName} on ${formatLongDate(purchase.deliverOn)} at 9am.`
                        : `We have emailed it to ${purchase.toName}.`}
                  </p>
                  {purchase.revealUrl && (
                    <p>
                      <a className="vt__link" href={purchase.revealUrl}>
                        Open the voucher
                      </a>
                    </p>
                  )}
                </>
              ) : (
                <p>We are confirming your payment with Stripe. Your receipt will arrive by email in a few minutes.</p>
              )}
            </div>
          </section>
        ) : (
          <VoucherBuilder
            token={token}
            businessName={business.businessName}
            phone={business.phone}
            intro={store.settings.intro}
            settings={store.settings}
            treatments={store.treatments}
            colourways={store.palette}
            today={dublinDate(Date.now())}
          />
        )}
      </main>

      {chrome.footer && <div dangerouslySetInnerHTML={{ __html: chrome.footer }} />}
      {chrome.tail && <div dangerouslySetInnerHTML={{ __html: chrome.tail }} />}
    </>
  );
}

const THANKS_CSS = `
.vt{display:grid;gap:clamp(28px,4vw,56px);align-items:center}
@media(min-width:900px){.vt{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.vt__text h1{font-size:clamp(34px,6vw,60px);line-height:1.05;margin:0 0 .4em}
.vt__text p{margin:0 0 .8em;line-height:1.6;max-width:52ch}
.vt__link{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:999px;border:1px solid currentColor;text-decoration:none;font-weight:600}
`;
```

- [ ] **Step 4: Typecheck, the site-route guard, and look at it**

Run: `cd app && npm run typecheck`
Expected: exits 0 with no output.

Run: `cd app && npm test -- src/lib/cms/bundledSites.test.ts`
Expected: PASS, including `site/[siteSlug]/vouchers/page.tsx renders <SiteTracking>` (every public site route must carry the consent-gated tracking component).

Local check (the local `data/` DBs are dev copies; never production). With `npm run dev` running, switch the store on for the dev tenant that owns a site (here `optimal-health`; use the tenant id that `SELECT id FROM tenants WHERE slug='optimal-health'` returns in `app/data/control.db`):

```bash
cd app
TID=$(sqlite3 data/control.db "SELECT id FROM tenants WHERE slug='optimal-health'")
sqlite3 data/control.db "INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES ('voucher_store','allow',100,'[$TID]',strftime('%s','now')*1000) ON CONFLICT(key) DO UPDATE SET mode='allow', allow='[$TID]'"
sqlite3 data/tenants/optimal-health/optimal-health.db "INSERT INTO settings (key, value) VALUES ('voucher_store','{\"enabled\":true,\"amounts\":[25,50,100],\"allowCustom\":true,\"customMin\":25,\"customMax\":500,\"therapyIds\":[],\"intro\":\"\",\"expiryYears\":5,\"bookUrl\":\"\"}') ON CONFLICT(key) DO UPDATE SET value=excluded.value"
```

Open `http://localhost:3000/site/optimal-health/vouchers`. Without a Stripe connection it shows the site's navbar and footer, the card, and "Not taking orders online yet". To see the form locally, add a test-mode connection row (`sqlite3 data/control.db "INSERT OR REPLACE INTO stripe_connections (tenant_id, account_id, livemode, charges_enabled, connected_at, updated_at) VALUES ($TID,'acct_local_preview',0,0,0,0)"`); Pay then fails with "Payments aren't working right now. Nothing was charged." because there is no local Stripe key, which is the expected local result. Delete that row afterwards: `sqlite3 data/control.db "DELETE FROM stripe_connections WHERE account_id='acct_local_preview'"`.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/vouchers/RevealCard.tsx app/src/components/vouchers/VoucherBuilder.tsx 'app/src/app/site/[siteSlug]/vouchers/page.tsx'
git commit -m "$(cat <<'EOF'
feat(vouchers): public voucher store at /vouchers in the site's own chrome

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The gift page at `/v/[token]`

**Files:**
- Create: `app/src/components/vouchers/PrintButton.tsx`
- Create: `app/src/app/site/[siteSlug]/v/[token]/page.tsx`

**Interfaces:**
- Consumes: Task 6 `RevealCard`; Task 3 `getVoucherByViewToken`, `getStoreSettings`, `brandPaletteForTenant`, `therapyName`; Task 2 `voucherState`, `balanceLabel`, `voucherTitle`, `formatEuro`, `formatLongDate`, `parseColourway`, `colourways`, `dublinDate`.
- Produces: `PrintButton({ className?: string })`.

- [ ] **Step 1: Write the print button**

Create `app/src/components/vouchers/PrintButton.tsx`:

```tsx
"use client";

/** The gift page's Print button, for a buyer who gives the voucher in person. */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      Print
    </button>
  );
}
```

- [ ] **Step 2: Write the page**

Create `app/src/app/site/[siteSlug]/v/[token]/page.tsx`:

```tsx
/**
 * The recipient's gift page, /v/<token> on the business's own site. The
 * token is the voucher's unguessable view_token, separate from the short
 * code staff take at the desk. Inside the site's own chrome, with the site's
 * consent-gated tracking like every public page. Never indexed.
 *
 * NAMESPACE NOTE: reserves /v/* on every site, ahead of the CMS catch-all,
 * the same accepted cost as /c/* for campaign pages.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolvePublicSite, type PublicSite } from "@/lib/cms/resolveHost";
import { siteRequestHost } from "@/lib/cms/requestHost";
import { CHROME_CONTENT_CSS, getSiteChrome } from "@/lib/cms/siteChrome";
import { runWithTenant } from "@/lib/db/tenant";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { SiteTracking } from "@/components/cms/SiteTracking";
import { RevealCard } from "@/components/vouchers/RevealCard";
import { PrintButton } from "@/components/vouchers/PrintButton";
import {
  balanceLabel,
  colourways,
  dublinDate,
  formatEuro,
  formatLongDate,
  parseColourway,
  voucherState,
  voucherTitle,
} from "@/lib/vouchers/model";
import { brandPaletteForTenant, getStoreSettings, getVoucherByViewToken, therapyName } from "@/lib/vouchers/store";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ siteSlug: string; token: string }>;
  searchParams: Promise<{ site?: string }>;
};

function load(site: PublicSite, token: string) {
  return runWithTenant(site.tenantId, () => {
    const v = getVoucherByViewToken(token);
    if (!v) return null;
    const colourway = parseColourway(v.colourway) ?? colourways(brandPaletteForTenant(site.tenantId))[0]!;
    return { v, colourway, therapy: therapyName(v.therapyId), bookUrl: getStoreSettings().bookUrl };
  });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const resolved = resolvePublicSite({ host: siteRequestHost(), siteParam: searchParams.site ?? params.siteSlug });
  const data = resolved ? load(resolved, params.token) : null;
  return {
    title: data ? `A gift from ${data.v.purchaserName} | ${resolved!.site.name}` : "Gift voucher",
    robots: { index: false, follow: false },
  };
}

export default async function GiftPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const resolved = resolvePublicSite({ host: siteRequestHost(), siteParam: searchParams.site ?? params.siteSlug });
  if (!resolved) notFound();
  const data = load(resolved, params.token);
  if (!data) notFound();
  const { v, colourway, therapy, bookUrl } = data;
  const business = getBusinessProfileForTenant(resolved.tenantId);
  const chrome = getSiteChrome(resolved.db, resolved.site.id, resolved.resolvedVia === "host" ? resolved.site.slug : null);
  const state = voucherState(v, dublinDate(Date.now()));
  const title = voucherTitle({ kind: v.kind, valueEur: v.valueEur, therapyName: therapy });
  const forName = v.recipientName || "you";
  const phoneHref = business.phone ? `tel:${business.phone.replace(/[^0-9+]/g, "")}` : null;
  const bookHref = bookUrl || phoneHref || (business.email ? `mailto:${business.email}` : null);
  const notice =
    state === "cancelled"
      ? "This voucher was cancelled."
      : state === "used"
        ? "This voucher has been used."
        : state === "expired"
          ? `This voucher's date has passed. Contact ${business.businessName} to use it.`
          : null;

  return (
    <>
      <SiteTracking siteSlug={resolved.site.slug} pixelId={resolved.site.metaPixelId} googleTagId={resolved.site.googleTagId} />
      <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
      <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS + GIFT_CSS }} />
      {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}

      <main className="cms-shell cms-shell--narrow vg">
        <div className="vg__reveal">
          <p className="vg__eyebrow">A gift for {forName}</p>
          <h1>{v.purchaserName} sent you a gift</h1>
        </div>
        <div className="vg__card">
          <RevealCard
            colourway={colourway}
            businessName={business.businessName}
            title={title}
            forName={forName}
            code={v.code}
            expiryLabel={`Valid until ${formatLongDate(v.expiryDate)}`}
          />
        </div>
        {v.message && (
          <blockquote className="vg__message">
            &ldquo;{v.message}&rdquo;
            <cite>{v.purchaserName}</cite>
          </blockquote>
        )}
        {notice && <p className="vg__notice">{notice}</p>}
        <dl className="vg__details">
          <div>
            <dt>Code</dt>
            <dd className="vg__mono">{v.code}</dd>
          </div>
          <div>
            <dt>{v.kind === "treatment" ? "Treatment" : "Value"}</dt>
            <dd>{v.kind === "treatment" ? title : formatEuro(v.valueEur)}</dd>
          </div>
          <div>
            <dt>Left</dt>
            <dd>{state === "cancelled" ? "Cancelled" : balanceLabel(v)}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{formatLongDate(v.expiryDate)}</dd>
          </div>
        </dl>
        <div className="vg__actions">
          {bookHref && state !== "cancelled" && state !== "used" && (
            <a className="vg__book" href={bookHref} style={{ background: colourway.base, color: colourway.ink }}>
              Book with this voucher
            </a>
          )}
          <PrintButton className="vg__print" />
        </div>
        <p className="vg__how">
          {business.phone
            ? `To book, call ${business.phone} and give your code.`
            : `To book, contact ${business.businessName} and give your code.`}
        </p>
      </main>

      {chrome.footer && <div dangerouslySetInnerHTML={{ __html: chrome.footer }} />}
      {chrome.tail && <div dangerouslySetInnerHTML={{ __html: chrome.tail }} />}
    </>
  );
}

const GIFT_CSS = `
.vg{text-align:center}
.vg__reveal{animation:vg-rise .8s ease both}
.vg__eyebrow{font-size:12px;letter-spacing:.24em;text-transform:uppercase;opacity:.7;margin:0 0 14px}
.vg h1{font-size:clamp(30px,6vw,52px);line-height:1.1;margin:0 0 clamp(28px,5vw,44px)}
.vg__card{animation:vg-card 1.1s cubic-bezier(.2,.85,.3,1) .25s both}
.vg__message{margin:clamp(28px,5vw,40px) auto 0;max-width:30em;font-size:clamp(17px,2.2vw,20px);font-style:italic;line-height:1.6;overflow-wrap:anywhere}
.vg__message cite{display:block;margin-top:10px;font-style:normal;font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.7}
.vg__notice{margin:24px auto 0;max-width:34em;padding:12px 16px;border:1px solid currentColor;border-radius:10px;font-weight:600}
.vg__details{margin:clamp(28px,5vw,40px) auto 0;max-width:440px;padding:0;text-align:left;border-top:1px solid rgba(127,127,127,.4)}
.vg__details > div{display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid rgba(127,127,127,.4)}
.vg__details dt{font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;margin:0}
.vg__details dd{margin:0;text-align:right;overflow-wrap:anywhere}
.vg__mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.12em}
.vg__actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:clamp(26px,4vw,36px)}
.vg__book,.vg__print{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 24px;border-radius:999px;font:inherit;font-weight:600;font-size:16px;text-decoration:none;cursor:pointer}
.vg__book{border:0}
.vg__print{background:transparent;color:inherit;border:1px solid currentColor}
.vg__how{margin:18px 0 0;font-size:14px;opacity:.75}
@keyframes vg-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes vg-card{0%{opacity:0;transform:translateY(36px) scale(.92)}60%{opacity:1}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vg__reveal,.vg__card{animation:none}}
@media print{
  header,footer,nav,.vg__actions,.vg__how{display:none!important}
  .vg__reveal,.vg__card{animation:none}
  body{background:#fff!important;color:#000!important}
}
`;
```

- [ ] **Step 3: Typecheck, the site-route guard, and look at it**

Run: `cd app && npm run typecheck`
Expected: exits 0.

Run: `cd app && npm test -- src/lib/cms/bundledSites.test.ts`
Expected: PASS, including `site/[siteSlug]/v/[token]/page.tsx renders <SiteTracking>`.

With the Task 6 local setup, make a voucher with a token and open it:

```bash
cd app
sqlite3 data/tenants/optimal-health/optimal-health.db "INSERT INTO gift_vouchers (code, purchaser_name, recipient_name, value_eur, balance_eur, purchase_date, expiry_date, source, message, view_token) VALUES ('OH-2026-TEST','Sean','Aoife',50,20,'2026-11-23','2031-11-23','online','Happy birthday','abcdefghijklmnopqrstuvwx')"
```

Open `http://localhost:3000/site/optimal-health/v/abcdefghijklmnopqrstuvwx`: "Sean sent you a gift", the card, the message, Left "€20 left", Book with this voucher (a `tel:` link) and Print. Print preview hides the site header and footer. A wrong token is a 404. Delete the row afterwards: `sqlite3 data/tenants/optimal-health/optimal-health.db "DELETE FROM gift_vouchers WHERE code='OH-2026-TEST'"`.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/vouchers/PrintButton.tsx 'app/src/app/site/[siteSlug]/v/[token]/page.tsx'
git commit -m "$(cat <<'EOF'
feat(vouchers): recipient gift page at /v/<token> with balance and print

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Staff: online store settings, the voucher list and the voucher page

**Files:**
- Create: `app/src/app/vouchers/store/actions.ts`
- Create: `app/src/app/vouchers/store/page.tsx`
- Create: `app/src/components/vouchers/StoreSettingsForm.tsx`
- Create: `app/src/app/vouchers/[code]/actions.ts`
- Create: `app/src/components/vouchers/VoucherDeliveryActions.tsx`
- Replace: `app/src/app/vouchers/[code]/page.tsx` (whole file)
- Replace: `app/src/app/vouchers/[code]/CopyButton.tsx` (whole file)
- Delete: `app/src/app/vouchers/[code]/HolographicCard.tsx`
- Modify: `app/src/components/vouchers/VoucherList.tsx`
- Modify: `app/src/app/vouchers/page.tsx`

**Interfaces:**
- Consumes: Tasks 2-6. Existing: `requireAdmin`, `requireAdminPage`, `requireUser`, `getCurrentMembership` from `lib/auth.ts`; `getCurrentTenant` from `lib/db/tenant.ts`; `listSites` from `lib/cms/sites.ts`; `getFeatureFlags` from `lib/settings.ts`; `isModuleOn` from `lib/features.ts`; `getBusinessProfile`; UI `Button` (`loading`), `Card`, `CardLabel`, `Input`, `Label`, `Textarea`, `Badge` (`tone`), `PageHeader`.
- Produces: server actions `saveVoucherStoreAction(input: StoreSettingsInput)`, `resendVoucherAction(voucherId: number)`, `changeRecipientEmailAction(voucherId: number, email: string)`, each returning `{ ok: true } | { ok: false; error: string }`; `StoreSettingsInput { enabled; amountsText; allowCustom; customMin; customMax; therapyIds; intro; expiryYears; bookUrl }`.

The settings page lives at `/vouchers/store`, which the `voucher_store` module owns (the root layout's `pathAllowed` guard turns it away when the flag is off); `requireAdminPage` keeps non-admins out, and the server action checks both again.

- [ ] **Step 1: Write the settings action and page**

Create `app/src/app/vouchers/store/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { parseAmountList, validateStoreSettings } from "@/lib/vouchers/model";
import { saveStoreSettings, storeFlagOn } from "@/lib/vouchers/store";

export interface StoreSettingsInput {
  enabled: boolean;
  amountsText: string;
  allowCustom: boolean;
  customMin: number;
  customMax: number;
  therapyIds: number[];
  intro: string;
  expiryYears: number;
  bookUrl: string;
}

/** Products > Vouchers > Online store. Admin only, and only with the voucher_store module on. */
export async function saveVoucherStoreAction(input: StoreSettingsInput): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  if (!storeFlagOn(getCurrentTenant().id)) return { ok: false, error: "The online voucher store isn't switched on for this business." };
  const amounts = parseAmountList(input.amountsText);
  if (amounts === null) return { ok: false, error: "Write the amounts as whole euros with commas, like 25, 50, 100." };
  const checked = validateStoreSettings({
    enabled: input.enabled,
    amounts,
    allowCustom: input.allowCustom,
    customMin: Number(input.customMin),
    customMax: Number(input.customMax),
    therapyIds: input.therapyIds.map(Number),
    intro: String(input.intro ?? ""),
    expiryYears: Number(input.expiryYears),
    bookUrl: String(input.bookUrl ?? ""),
  });
  if (!checked.ok) return checked;
  saveStoreSettings(checked.value);
  await logActivity("voucher_store.settings", `Online voucher store ${checked.value.enabled ? "on" : "off"}; settings saved.`, {});
  revalidatePath("/vouchers/store");
  return { ok: true };
}
```

Create `app/src/app/vouchers/store/page.tsx`:

```tsx
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardLabel } from "@/components/ui/Card";
import { StoreSettingsForm } from "@/components/vouchers/StoreSettingsForm";
import { requireAdminPage } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { listSites } from "@/lib/cms/sites";
import { canTakePayments, getStripeConnection } from "@/lib/stripe/connection";
import { getStoreSettings, listSellableTherapies } from "@/lib/vouchers/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Online voucher store — AdonisAgent" };

/**
 * Products > Vouchers > Online store. The module guard (voucher_store) keeps
 * this page from a business without the module; requireAdminPage keeps it
 * from staff who aren't admins.
 */
export default async function VoucherStorePage() {
  await requireAdminPage();
  const tenantId = getCurrentTenant().id;
  const settings = getStoreSettings();
  const therapies = listSellableTherapies();
  const conn = getStripeConnection(tenantId);
  const ready = canTakePayments(conn);
  const sites = await listSites();
  const site = sites.find((s) => s.status === "live") ?? sites[0] ?? null;
  const storeUrl = site ? (site.primaryHost ? `https://${site.primaryHost}/vouchers` : `/site/${site.slug}/vouchers`) : null;

  return (
    <div className="app-page" style={{ maxWidth: 820 }}>
      <PageHeader
        eyebrow="Vouchers"
        title="Online voucher store"
        subtitle="Sell gift vouchers on your own website. Payments go straight to your Stripe account."
      />

      <Card style={{ marginBottom: 20 }}>
        <CardLabel>Payments</CardLabel>
        {ready ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
            Payments go to your Stripe account{conn?.displayName ? ` (${conn.displayName})` : ""}. You keep everything except Stripe&apos;s own fee.
          </p>
        ) : (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
            Connect Stripe before the store can take payments. Until then it shows that you are not taking orders online.{" "}
            <Link href="/settings/integrations/stripe" style={{ color: "var(--text-primary)", textDecoration: "underline" }}>
              Connect Stripe
            </Link>
          </p>
        )}
        {storeUrl && settings.enabled && (
          <p style={{ margin: "12px 0 0", fontSize: 14 }}>
            <a href={storeUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              Open your store <ExternalLink size={14} />
            </a>
          </p>
        )}
        {!site && (
          <p style={{ margin: "12px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>
            The store lives on your website, and this business has no website yet.
          </p>
        )}
      </Card>

      <StoreSettingsForm
        initial={{
          enabled: settings.enabled,
          amountsText: settings.amounts.join(", "),
          allowCustom: settings.allowCustom,
          customMin: settings.customMin,
          customMax: settings.customMax,
          therapyIds: settings.therapyIds,
          intro: settings.intro,
          expiryYears: settings.expiryYears,
          bookUrl: settings.bookUrl,
        }}
        therapies={therapies}
      />
    </div>
  );
}
```

Create `app/src/components/vouchers/StoreSettingsForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { saveVoucherStoreAction, type StoreSettingsInput } from "@/app/vouchers/store/actions";
import { MIN_EXPIRY_YEARS, type StoreTreatment } from "@/lib/vouchers/model";

/** The online voucher store's settings. Saved together with one button. */
export function StoreSettingsForm({ initial, therapies }: { initial: StoreSettingsInput; therapies: StoreTreatment[] }) {
  const router = useRouter();
  const [s, setS] = useState<StoreSettingsInput>(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof StoreSettingsInput>(k: K, v: StoreSettingsInput[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const toggleTherapy = (id: number) =>
    set("therapyIds", s.therapyIds.includes(id) ? s.therapyIds.filter((x) => x !== id) : [...s.therapyIds, id]);

  function save() {
    startTransition(async () => {
      const r = await saveVoucherStoreAction(s);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(s.enabled ? "Saved. The store is on." : "Saved. The store is off.");
      router.refresh();
    });
  }

  const check: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-primary)", cursor: "pointer", minHeight: 36 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <label style={check}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Store on: sell gift vouchers at /vouchers on your website
        </label>
      </Card>

      <Card>
        <CardLabel>Money vouchers</CardLabel>
        <Label htmlFor="vs-amounts">Amounts (whole euros, with commas)</Label>
        <Input id="vs-amounts" value={s.amountsText} onChange={(e) => set("amountsText", e.target.value)} placeholder="25, 50, 100" />
        <label style={{ ...check, marginTop: 14 }}>
          <input type="checkbox" checked={s.allowCustom} onChange={(e) => set("allowCustom", e.target.checked)} />
          Buyers can type their own amount
        </label>
        {s.allowCustom && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 12 }}>
            <div>
              <Label htmlFor="vs-min">Lowest (EUR)</Label>
              <Input id="vs-min" type="number" min={5} step={1} value={s.customMin} onChange={(e) => set("customMin", Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="vs-max">Highest (EUR)</Label>
              <Input id="vs-max" type="number" min={5} step={1} value={s.customMax} onChange={(e) => set("customMax", Number(e.target.value))} />
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>Treatment vouchers</CardLabel>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          One session of a treatment at its list price. The name and price come from your services, so they follow any change you make there.
        </p>
        {therapies.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-tertiary)" }}>No active services with a price yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {therapies.map((t) => (
              <label key={t.id} style={check}>
                <input type="checkbox" checked={s.therapyIds.includes(t.id)} onChange={() => toggleTherapy(t.id)} />
                {t.name}, EUR {t.priceEur.toFixed(2).replace(/\.00$/, "")}
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>The store page</CardLabel>
        <Label htmlFor="vs-intro">Intro line (optional, up to 200 characters)</Label>
        <Textarea id="vs-intro" rows={2} maxLength={200} value={s.intro} onChange={(e) => set("intro", e.target.value)} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 14 }}>
          <div>
            <Label htmlFor="vs-years">Valid for (years, at least {MIN_EXPIRY_YEARS})</Label>
            <Input id="vs-years" type="number" min={MIN_EXPIRY_YEARS} step={1} value={s.expiryYears} onChange={(e) => set("expiryYears", Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="vs-book">Booking link (optional)</Label>
            <Input id="vs-book" type="url" placeholder="Blank: your phone number" value={s.bookUrl} onChange={(e) => set("bookUrl", e.target.value)} />
          </div>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
          Irish law says gift vouchers last at least 5 years.
        </p>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="button" onClick={save} loading={pending}>
          Save
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the voucher page's actions and controls**

Create `app/src/app/vouchers/[code]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { resendVoucherEmails } from "@/lib/vouchers/deliver";
import { isEmail } from "@/lib/vouchers/model";
import { getVoucherById, orderForVoucher, setRecipientEmail } from "@/lib/vouchers/store";

type Result = { ok: true } | { ok: false; error: string };

/** Send the gift email again (or, for a voucher sent to the buyer, the receipt). */
export async function resendVoucherAction(voucherId: number): Promise<Result> {
  await requireUser();
  const v = getVoucherById(voucherId);
  const order = v ? orderForVoucher(v) : null;
  if (!v || !order) return { ok: false, error: "This voucher wasn't bought online." };
  const r = await resendVoucherEmails(getCurrentTenant().id, order.id);
  revalidatePath(`/vouchers/${encodeURIComponent(v.code)}`);
  revalidatePath("/vouchers");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** A typo in the recipient's address: fix it, then Resend. */
export async function changeRecipientEmailAction(voucherId: number, email: string): Promise<Result> {
  await requireUser();
  const clean = email.trim().toLowerCase();
  if (!isEmail(clean)) return { ok: false, error: "Enter a full email address." };
  const v = getVoucherById(voucherId);
  const order = v ? orderForVoucher(v) : null;
  if (!v || !order) return { ok: false, error: "This voucher wasn't bought online." };
  if (order.deliverTo !== "recipient") return { ok: false, error: "This voucher was sent to the buyer." };
  setRecipientEmail(order.id, clean);
  await logActivity("voucher.recipient_email", `Recipient email for voucher ${v.code} changed to ${clean}`, { voucherId: v.id });
  revalidatePath(`/vouchers/${encodeURIComponent(v.code)}`);
  return { ok: true };
}
```

Create `app/src/components/vouchers/VoucherDeliveryActions.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { changeRecipientEmailAction, resendVoucherAction } from "@/app/vouchers/[code]/actions";

/** Resend the voucher email; for a gift to someone else, fix their address first if needed. */
export function VoucherDeliveryActions({ voucherId, recipientEmail }: { voucherId: number; recipientEmail: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState(recipientEmail ?? "");
  const [sending, startSend] = useTransition();
  const [saving, startSave] = useTransition();

  const resend = () =>
    startSend(async () => {
      const r = await resendVoucherAction(voucherId);
      if (r.ok) toast.success("Sent.");
      else toast.error(r.error);
      router.refresh();
    });
  const saveEmail = () =>
    startSave(async () => {
      const r = await changeRecipientEmailAction(voucherId, email);
      if (r.ok) toast.success("Email address saved. Press Resend to send it there.");
      else toast.error(r.error);
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {recipientEmail !== null && (
        <div>
          <Label htmlFor="vd-email">Recipient email</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <Input id="vd-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="button" variant="secondary" onClick={saveEmail} loading={saving} disabled={email.trim().toLowerCase() === recipientEmail}>
              Save email
            </Button>
          </div>
        </div>
      )}
      <div>
        <Button type="button" onClick={resend} loading={sending}>
          Resend
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rebuild the voucher page on the business's own brand**

Replace the whole of `app/src/app/vouchers/[code]/page.tsx` with:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Mail, Ticket } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { RevealCard } from "@/components/vouchers/RevealCard";
import { VoucherDeliveryActions } from "@/components/vouchers/VoucherDeliveryActions";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getCurrentTenant } from "@/lib/db/tenant";
import { formatDate } from "@/lib/utils";
import {
  balanceLabel,
  colourways,
  deliveryStatus,
  dublinDate,
  formatEuro,
  formatLongDate,
  parseColourway,
  voucherState,
  voucherTitle,
} from "@/lib/vouchers/model";
import { brandPaletteForTenant, getVoucherByCode, listRedemptions, orderForVoucher, therapyName } from "@/lib/vouchers/store";
import { CopyButton } from "./CopyButton";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ code: string }>;
}

const STATE_BADGE = {
  active: { label: "Active", tone: "green" },
  part_used: { label: "Part used", tone: "amber" },
  used: { label: "Used", tone: "green" },
  expired: { label: "Past its date", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "red" },
} as const;

/**
 * One voucher, for staff: the card as the recipient sees it (in this
 * business's colours, never another's), its balance and every use, and for
 * an online voucher the order and its email, with Resend.
 */
export default async function VoucherDetailPage(props: Props) {
  const params = await props.params;
  const v = getVoucherByCode(decodeURIComponent(params.code));
  if (!v) notFound();
  const tenantId = getCurrentTenant().id;
  const business = getBusinessProfile();
  const order = orderForVoucher(v);
  const therapy = therapyName(v.therapyId);
  const colourway = parseColourway(v.colourway) ?? colourways(brandPaletteForTenant(tenantId))[0]!;
  const uses = listRedemptions(v.id);
  const state = voucherState(v, dublinDate(Date.now()));
  const title = voucherTitle({ kind: v.kind, valueEur: v.valueEur, therapyName: therapy });
  const delivery = order ? deliveryStatus(order) : null;
  const giftUrl = order && v.viewToken ? `${order.siteUrl}/v/${v.viewToken}` : null;
  const usable = state !== "used" && state !== "cancelled";
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--hairline)", fontSize: 14 };
  const key: React.CSSProperties = { color: "var(--text-tertiary)" };

  return (
    <div className="app-page" style={{ maxWidth: 1000 }}>
      <PageHeader
        eyebrow="Vouchers"
        title={v.code}
        subtitle={v.source === "online" ? `Bought online by ${order?.buyerName ?? v.purchaserName}` : "Made at the desk"}
        actions={
          usable ? (
            <Link href={`/appointments/new?voucher=${encodeURIComponent(v.code)}`}>
              <Button>
                <Ticket size={15} />
                Redeem at a booking
              </Button>
            </Link>
          ) : null
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <RevealCard
            colourway={colourway}
            businessName={business.businessName}
            title={title}
            forName={v.recipientName || "the recipient"}
            code={v.code}
            expiryLabel={`Valid until ${formatLongDate(v.expiryDate)}`}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <CopyButton code={v.code} />
            <a href={`/vouchers/${encodeURIComponent(v.code)}/email`} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">
                <Mail size={14} />
                See the gift email
              </Button>
            </a>
            {giftUrl && (
              <a href={giftUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  <ExternalLink size={14} />
                  Open the gift page
                </Button>
              </a>
            )}
          </div>
        </div>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <CardLabel>Voucher</CardLabel>
            <Badge tone={STATE_BADGE[state].tone}>{STATE_BADGE[state].label}</Badge>
          </div>
          <div style={row}>
            <span style={key}>Type</span>
            <span>{v.kind === "treatment" ? `One ${therapy ?? "treatment"}` : "Money"}</span>
          </div>
          <div style={row}>
            <span style={key}>Value</span>
            <span>{formatEuro(v.valueEur)}</span>
          </div>
          <div style={row}>
            <span style={key}>Left</span>
            <span style={{ fontWeight: 600 }}>{state === "cancelled" ? "Cancelled" : balanceLabel(v)}</span>
          </div>
          <div style={row}>
            <span style={key}>Valid until</span>
            <span>{formatLongDate(v.expiryDate)}</span>
          </div>
          <div style={row}>
            <span style={key}>For</span>
            <span>{v.recipientName ?? "Anyone with the code"}</span>
          </div>
          <div style={row}>
            <span style={key}>From</span>
            <span>{v.purchaserName}</span>
          </div>
          {v.message && (
            <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--text-secondary)", fontStyle: "italic", lineHeight: 1.6 }}>&ldquo;{v.message}&rdquo;</p>
          )}
          {state === "expired" && (
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "#b45309" }}>This voucher&apos;s date has passed. You can still take it at a booking.</p>
          )}
        </Card>
      </div>

      {order && delivery && (
        <Card style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
            <CardLabel>Online order #{order.id}</CardLabel>
            <Badge tone={delivery.tone}>{delivery.label}</Badge>
          </div>
          <div style={row}>
            <span style={key}>Buyer</span>
            <span>
              {order.buyerName} ({order.buyerEmail})
            </span>
          </div>
          <div style={row}>
            <span style={key}>Sent to</span>
            <span>{order.deliverTo === "buyer" ? "The buyer" : `${order.recipientName} (${order.recipientEmail})`}</span>
          </div>
          {order.deliverOn && (
            <div style={row}>
              <span style={key}>Send date</span>
              <span>{formatLongDate(order.deliverOn)}, 9am</span>
            </div>
          )}
          {order.status === "refunded" && state !== "cancelled" && (
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "#dc2626", lineHeight: 1.55 }}>
              Refunded in Stripe after part of it was used. Check it with the buyer before taking it again.
            </p>
          )}
          {order.status === "paid" && (
            <div style={{ marginTop: 16 }}>
              <VoucherDeliveryActions voucherId={v.id} recipientEmail={order.deliverTo === "recipient" ? order.recipientEmail : null} />
            </div>
          )}
        </Card>
      )}

      <Card style={{ marginTop: 20 }}>
        <CardLabel>Uses</CardLabel>
        {uses.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-tertiary)" }}>Not used yet.</p>
        ) : (
          uses.map((u) => (
            <div key={u.id} style={row}>
              <span>
                {formatDate(u.createdAt)}
                {u.appointmentId ? (
                  <>
                    {" · "}
                    <Link href={`/appointments/${u.appointmentId}`} style={{ color: "var(--text-primary)", textDecoration: "underline" }}>
                      booking{u.appointmentDate ? ` on ${u.appointmentDate}` : ""}
                    </Link>
                  </>
                ) : (
                  " · package sale"
                )}
              </span>
              <span style={{ fontWeight: 600 }}>{formatEuro(u.amountEur)}</span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
```

Replace the whole of `app/src/app/vouchers/[code]/CopyButton.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/Button";

export function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: nothing to do.
    }
  };

  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      <Copy size={14} />
      {copied ? "Copied" : "Copy code"}
    </Button>
  );
}
```

Delete the Renova-only card, now replaced by `RevealCard`:

```bash
git rm 'app/src/app/vouchers/[code]/HolographicCard.tsx'
```

- [ ] **Step 4: Show online vouchers in the list**

In `app/src/components/vouchers/VoucherList.tsx`, replace:

```tsx
import type { Therapy, Voucher } from "@/lib/db/schema";
```

with:

```tsx
import type { Therapy } from "@/lib/db/schema";
import type { VoucherRow } from "@/lib/vouchers/store";
import { deliveryStatus } from "@/lib/vouchers/model";
```

In `app/src/components/vouchers/VoucherList.tsx`, replace:

```tsx
interface Props {
  vouchers: Voucher[];
```

with:

```tsx
interface Props {
  vouchers: VoucherRow[];
```

In `app/src/components/vouchers/VoucherList.tsx`, replace:

```tsx
        v.purchaserEmail ?? "",
        v.recipientName ?? "",
      ]
```

with:

```tsx
        v.purchaserEmail ?? "",
        v.recipientName ?? "",
        v.order?.buyerName ?? "",
        v.order?.recipientEmail ?? "",
      ]
```

In `app/src/components/vouchers/VoucherList.tsx`, replace:

```tsx
                const redeemable = !empty && !expired;
                return (
                  <tr key={v.id}>
                    <td
                      style={{
                        ...td,
                        fontFamily: "var(--font-heading)",
                        textTransform: "uppercase",
                      }}
                    >
                      {v.code}
                    </td>
                    <td style={td}>
                      <div>{v.purchaserName}</div>
```

with:

```tsx
                const cancelled = v.cancelledAt != null;
                // Past its date is a warning, not a refusal: staff may still take it.
                const redeemable = !empty && !cancelled;
                const delivery = v.order ? deliveryStatus(v.order) : null;
                return (
                  <tr key={v.id}>
                    <td
                      style={{
                        ...td,
                        fontFamily: "var(--font-heading)",
                        textTransform: "uppercase",
                      }}
                    >
                      <Link href={`/vouchers/${encodeURIComponent(v.code)}`} style={{ color: "var(--text-primary)" }}>
                        {v.code}
                      </Link>
                    </td>
                    <td style={td}>
                      <div>{v.order?.buyerName ?? v.purchaserName}</div>
                      {v.source === "online" && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone="info">Bought online</Badge>
                        </div>
                      )}
```

In `app/src/components/vouchers/VoucherList.tsx`, replace:

```tsx
                    <td style={td}>{v.recipientName ?? "—"}</td>
```

with:

```tsx
                    <td style={td}>
                      <div>{v.recipientName ?? "—"}</div>
                      {delivery && (
                        <div style={{ marginTop: 4 }}>
                          <Badge tone={delivery.tone}>{delivery.label}</Badge>
                        </div>
                      )}
                    </td>
```

In `app/src/components/vouchers/VoucherList.tsx`, replace:

```tsx
                      {empty ? (
                        <Badge tone="green">Redeemed</Badge>
                      ) : expired ? (
```

with:

```tsx
                      {cancelled ? (
                        <Badge tone="red">Cancelled</Badge>
                      ) : empty ? (
                        <Badge tone="green">Redeemed</Badge>
                      ) : expired ? (
```

- [ ] **Step 5: The list page: online rows and the Online store button**

In `app/src/app/vouchers/page.tsx`, replace:

```tsx
import { Gift, Plus } from "lucide-react";
```

with:

```tsx
import { Gift, Plus, Store } from "lucide-react";
```

In `app/src/app/vouchers/page.tsx`, replace:

```tsx
import { listVouchers, getTherapyMap } from "@/lib/queries";
import { getVenueType } from "@/lib/settings";
```

with:

```tsx
import { getTherapyMap } from "@/lib/queries";
import { getFeatureFlags, getVenueType } from "@/lib/settings";
import { getCurrentMembership } from "@/lib/auth";
import { isModuleOn } from "@/lib/features";
import { listVoucherRows } from "@/lib/vouchers/store";
```

In `app/src/app/vouchers/page.tsx`, replace:

```tsx
  const [vouchers, therapyMap] = await Promise.all([
    listVouchers(),
    getTherapyMap(),
  ]);
```

with:

```tsx
  const vouchers = listVoucherRows();
  const therapyMap = await getTherapyMap();
  // Products > Vouchers > Online store: admins, with the voucher_store module on.
  const showStore = getCurrentMembership()?.role === "admin" && isModuleOn(getFeatureFlags(), "voucher_store");
```

In `app/src/app/vouchers/page.tsx`, replace:

```tsx
        actions={
          <Link href="/vouchers/new">
            <Button>
              <Plus size={15} />
              Create voucher
            </Button>
          </Link>
        }
```

with:

```tsx
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {showStore && (
              <Link href="/vouchers/store">
                <Button variant="secondary">
                  <Store size={15} />
                  Online store
                </Button>
              </Link>
            )}
            <Link href="/vouchers/new">
              <Button>
                <Plus size={15} />
                Create voucher
              </Button>
            </Link>
          </div>
        }
```

- [ ] **Step 6: Check it**

Run: `cd app && npm run typecheck`
Expected: exits 0.

Run: `cd app && npm test -- src/components/emphasisBudget.app.test.ts` and `cd app && npm test -- src/components/dohertyFeedback.test.ts`
Expected: both PASS (one primary button per new component; every action button uses `loading`).

- [ ] **Step 7: Commit**

```bash
git add app/src/app/vouchers/store/actions.ts app/src/app/vouchers/store/page.tsx app/src/components/vouchers/StoreSettingsForm.tsx 'app/src/app/vouchers/[code]/actions.ts' app/src/components/vouchers/VoucherDeliveryActions.tsx 'app/src/app/vouchers/[code]/page.tsx' 'app/src/app/vouchers/[code]/CopyButton.tsx' app/src/components/vouchers/VoucherList.tsx app/src/app/vouchers/page.tsx
git commit -m "$(cat <<'EOF'
feat(vouchers): online store settings, online vouchers in the list, voucher page with resend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(`git rm` in Step 3 already staged the deletion.)

---

### Task 9: Redemption at booking

**Files:**
- Create: `app/src/lib/vouchers/redeem.ts`
- Modify: `app/src/app/api/appointments/route.ts`
- Modify: `app/src/app/api/vouchers/[code]/route.ts`
- Modify: `app/src/components/appointments/BookingForm.tsx`
- Modify: `app/src/app/packages/actions.ts`
- Modify: `app/src/app/appointments/actions.ts` (`createAppointmentAction`, which has no callers today, so its voucher branch follows the same rules)
- Test: `app/src/lib/vouchers/redeem.test.ts`

**Interfaces:**
- Consumes: Task 2 `splitPayment`, `voucherState`, `toCents`, `formatEuro`, `dublinDate`; Task 3 `getVoucherByCode`; `getSessionUser` from `lib/auth.ts`.
- Produces: `VoucherLookup`, `lookupVoucher(code, today?): VoucherLookup | null`, `VoucherUse`, `recordVoucherUse(u: VoucherUse, now?): { paymentId: number }`, `RedeemResult`, `redeemAtBooking({ code, clientId, appointmentId, priceEur, therapyIds, secondaryMethod, userId, now? }): RedeemResult`. `GET /api/vouchers/<code>` now also returns `cancelled`, `kind`, `therapyId`, `therapyName`, `recipientName`, `purchaserName`, `expiryDate`, and `redeemable` no longer depends on the date.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/vouchers/redeem.test.ts`:

```ts
// Run: npm test -- src/lib/vouchers/redeem.test.ts
//
// Paying for a booking with a voucher, in a scratch business:
//   - a money voucher pays up to its balance; the rest needs another method
//     and is a second payment; the change stays on the voucher;
//   - a treatment voucher pays one session of its treatment at today's price
//     and is used up; it is refused for a different treatment;
//   - expired = allowed (the form warns); cancelled, used up, unknown and
//     price-less bookings are refused with nothing written;
//   - every use is one voucher_redemptions row, and balance = value - uses.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

process.env.STRIPE_SECRET_KEY = "sk_test_vouchers";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { withVoucherTenant, seedTherapy } = requireLocal("./testSupport") as typeof import("./testSupport");
  const { redeemAtBooking, lookupVoucher } = requireLocal("./redeem") as typeof import("./redeem");
  const { balanceFrom } = requireLocal("./model") as typeof import("./model");

  await withVoucherTenant("voucher-redeem-test", (tid) =>
    runWithTenant(tid, () => {
      const tdb = getTenantDbById(tid);
      const massage = seedTherapy(tid, "Swedish massage", 80);
      const facial = seedTherapy(tid, "Facial", 60);
      const [client] = tdb.insert(schema.clients).values({ firstName: "Aoife", lastName: "Byrne", phone: "0870000000" }).returning().all();
      const appt = (therapyId: number, price: number) =>
        tdb
          .insert(schema.appointments)
          .values({ clientId: client!.id, date: "2026-12-01", startTime: "10:00", endTime: "11:00", status: "scheduled", therapyIds: JSON.stringify([therapyId]), totalPriceEur: price })
          .returning()
          .all()[0]!.id;
      const voucher = (code: string, v: Partial<typeof schema.giftVouchers.$inferInsert> = {}) =>
        tdb
          .insert(schema.giftVouchers)
          .values({ code, purchaserName: "Sean", recipientName: "Aoife", valueEur: 50, balanceEur: 50, purchaseDate: "2026-11-23", expiryDate: "2031-11-23", ...v })
          .returning()
          .all()[0]!;
      const get = (id: number) => tdb.select().from(schema.giftVouchers).where(eq(schema.giftVouchers.id, id)).get()!;
      const uses = (id: number) => tdb.select().from(schema.voucherRedemptions).where(eq(schema.voucherRedemptions.voucherId, id)).all();
      const pays = (apptId: number) => tdb.select().from(schema.payments).where(eq(schema.payments.appointmentId, apptId)).all();
      const now = Date.UTC(2026, 11, 1, 10);
      const book = (code: string, apptId: number, price: number, therapyId: number, secondaryMethod: string | null = null) =>
        redeemAtBooking({ code, clientId: client!.id, appointmentId: apptId, priceEur: price, therapyIds: [therapyId], secondaryMethod, userId: 7, now });

      // Money voucher short of the price: refused until another method is chosen.
      const v50 = voucher("GC-2026-AAAA");
      const a1 = appt(massage, 80);
      const short = book("GC-2026-AAAA", a1, 80, massage);
      assert.ok(!short.ok && short.error === "The voucher pays €50 of €80. Choose how the other €30 is paid.");
      assert.equal(pays(a1).length, 0, "nothing written");
      assert.equal(uses(v50.id).length, 0);
      assert.equal(get(v50.id).balanceEur, 50);
      const paid = book("gc-2026-aaaa ", a1, 80, massage, "card");
      assert.ok(paid.ok && paid.voucherEur === 50 && paid.remainderEur === 30, "lower case and stray spaces are fine");
      assert.deepEqual(pays(a1).map((p) => [p.paymentMethod, p.amountEur, p.voucherId]), [["voucher", 50, v50.id], ["card", 30, null]], "two payments");
      assert.deepEqual(uses(v50.id).map((u) => [u.amountEur, u.appointmentId, u.redeemedByUserId]), [[50, a1, 7]], "one redemption, who and where");
      assert.equal(get(v50.id).balanceEur, 0);
      assert.equal(get(v50.id).isRedeemed, true);
      const again = book("GC-2026-AAAA", appt(massage, 80), 80, massage, "cash");
      assert.ok(!again.ok && again.error === "This voucher has been used.");

      // Money voucher with change: the balance carries to the next visit.
      const v100 = voucher("GC-2026-BBBB", { valueEur: 100, balanceEur: 100 });
      const a2 = appt(facial, 30);
      assert.ok(book("GC-2026-BBBB", a2, 30, facial).ok, "covers it, no second method needed");
      assert.equal(get(v100.id).balanceEur, 70);
      assert.equal(lookupVoucher("GC-2026-BBBB", "2026-12-01")?.state, "part_used");
      const a3 = appt(massage, 80);
      assert.ok(book("GC-2026-BBBB", a3, 80, massage, "cash").ok);
      assert.equal(get(v100.id).balanceEur, 0);
      assert.equal(balanceFrom(100, uses(v100.id).map((u) => u.amountEur)), get(v100.id).balanceEur, "balance = value - redemptions");

      // Treatment voucher: today's price, whatever it cost, then used up.
      const vt = voucher("GC-2026-CCCC", { kind: "treatment", therapyId: massage, valueEur: 70, balanceEur: 70 });
      assert.ok(!book("GC-2026-CCCC", appt(facial, 60), 60, facial).ok, "not for a different treatment");
      const wrong = book("GC-2026-CCCC", appt(facial, 60), 60, facial);
      assert.ok(!wrong.ok && wrong.error === "This voucher is for Swedish massage.");
      const a4 = appt(massage, 80);
      const t = book("GC-2026-CCCC", a4, 80, massage);
      assert.ok(t.ok && t.voucherEur === 80 && t.remainderEur === 0, "the whole session, at today's EUR 80");
      assert.deepEqual(pays(a4).map((p) => [p.paymentMethod, p.amountEur]), [["voucher", 80]]);
      assert.deepEqual(uses(vt.id).map((u) => u.amountEur), [70], "the voucher's own value comes off");
      assert.equal(get(vt.id).balanceEur, 0);

      // Expired: a warning, still taken.
      voucher("GC-2026-DDDD", { expiryDate: "2026-11-30" });
      assert.equal(lookupVoucher("GC-2026-DDDD", "2026-12-01")?.expired, true);
      const old = book("GC-2026-DDDD", appt(facial, 40), 40, facial);
      assert.ok(old.ok && old.expired, "expired is allowed and reported");

      // Refused, nothing written.
      voucher("GC-2026-EEEE", { cancelledAt: now, balanceEur: 0 });
      const a5 = appt(facial, 40);
      const cancelled = book("GC-2026-EEEE", a5, 40, facial);
      assert.ok(!cancelled.ok && cancelled.error === "This voucher was cancelled.");
      const unknown = book("NOPE-0000", a5, 40, facial);
      assert.ok(!unknown.ok && unknown.error === "Voucher not found.");
      voucher("GC-2026-FFFF");
      const free = book("GC-2026-FFFF", a5, 0, facial);
      assert.ok(!free.ok && /no price/.test(free.error));
      assert.equal(pays(a5).length, 0);
    }),
  );

  console.log("vouchers redeem: split payments, treatment vouchers, refusals; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/vouchers/redeem.test.ts`
Expected: FAIL with `Cannot find module './redeem'`.

- [ ] **Step 3: Write the redemption**

Create `app/src/lib/vouchers/redeem.ts`:

```ts
import "server-only";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { giftVouchers, payments, therapies, voucherRedemptions } from "@/lib/db/schema";
import { dublinDate, formatEuro, splitPayment, toCents, voucherState, type VoucherKind, type VoucherState } from "./model";
import { getVoucherByCode } from "./store";

/**
 * Taking a voucher at the desk. Every use is one voucher_redemptions row, and
 * the voucher's balance_eur moves in the same transaction as that row and
 * the payment rows, so balance always equals value less the redemptions.
 * Ambient `db` (a staff request).
 */

export interface VoucherLookup {
  id: number;
  code: string;
  kind: VoucherKind;
  therapyId: number | null;
  therapyName: string | null;
  purchaserName: string;
  recipientName: string | null;
  valueEur: number;
  balanceEur: number;
  expiryDate: string;
  state: VoucherState;
  /** Past its date: staff are warned, and may still take it. */
  expired: boolean;
}

export function lookupVoucher(code: string, today = dublinDate(Date.now())): VoucherLookup | null {
  const v = getVoucherByCode(code);
  if (!v) return null;
  const therapy = v.therapyId ? db.select({ name: therapies.name }).from(therapies).where(eq(therapies.id, v.therapyId)).get() : undefined;
  return {
    id: v.id,
    code: v.code,
    kind: v.kind,
    therapyId: v.therapyId,
    therapyName: therapy?.name ?? null,
    purchaserName: v.purchaserName,
    recipientName: v.recipientName,
    valueEur: v.valueEur,
    balanceEur: v.balanceEur,
    expiryDate: v.expiryDate,
    state: voucherState(v, today),
    expired: v.expiryDate < today,
  };
}

type OtherMethod = "cash" | "card" | "bank_transfer";
const OTHER_METHODS: readonly string[] = ["cash", "card", "bank_transfer"];

export interface VoucherUse {
  voucherId: number;
  /** Taken off the balance. */
  redemptionEur: number;
  /** The "voucher" payment row's amount. */
  paymentEur: number;
  clientId: number;
  appointmentId: number | null;
  packageId: number | null;
  userId: number | null;
  note: string | null;
  /** The rest of the price, paid another way, recorded as a second payment. */
  remainder: { amountEur: number; method: OtherMethod; note: string } | null;
}

/** Payment rows, the redemption and the new balance, all or nothing. */
export function recordVoucherUse(u: VoucherUse, now = Date.now()): { paymentId: number } {
  return db.transaction((tx) => {
    const [pay] = tx
      .insert(payments)
      .values({
        clientId: u.clientId,
        appointmentId: u.appointmentId,
        packageId: u.packageId,
        voucherId: u.voucherId,
        amountEur: u.paymentEur,
        paymentMethod: "voucher",
        notes: u.note,
      })
      .returning({ id: payments.id })
      .all();
    if (u.remainder && toCents(u.remainder.amountEur) > 0) {
      tx.insert(payments)
        .values({
          clientId: u.clientId,
          appointmentId: u.appointmentId,
          packageId: u.packageId,
          voucherId: null,
          amountEur: u.remainder.amountEur,
          paymentMethod: u.remainder.method,
          notes: u.remainder.note,
        })
        .run();
    }
    tx.insert(voucherRedemptions)
      .values({
        voucherId: u.voucherId,
        amountEur: u.redemptionEur,
        appointmentId: u.appointmentId,
        paymentId: pay!.id,
        redeemedByUserId: u.userId,
        createdAt: now,
      })
      .run();
    tx.update(giftVouchers)
      .set({
        balanceEur: sql`max(0, round((${giftVouchers.balanceEur} - ${u.redemptionEur}) * 100) / 100.0)`,
        isRedeemed: sql`case when round((${giftVouchers.balanceEur} - ${u.redemptionEur}) * 100) <= 0 then 1 else 0 end`,
        redeemedByClientId: sql`coalesce(${giftVouchers.redeemedByClientId}, ${u.clientId})`,
        redeemedAt: new Date(now),
      })
      .where(eq(giftVouchers.id, u.voucherId))
      .run();
    return { paymentId: pay!.id };
  });
}

export type RedeemResult =
  | { ok: true; voucherEur: number; remainderEur: number; paymentId: number; expired: boolean }
  | { ok: false; error: string };

/**
 * A booking paid with a voucher. A money voucher pays up to its balance; a
 * treatment voucher pays for one session of its treatment at today's price
 * and is used up. Anything left is recorded as a second payment by
 * `secondaryMethod`. Nothing is written when it is refused.
 */
export function redeemAtBooking(input: {
  code: string;
  clientId: number;
  appointmentId: number;
  priceEur: number;
  therapyIds: readonly number[];
  secondaryMethod: string | null;
  userId: number | null;
  now?: number;
}): RedeemResult {
  const now = input.now ?? Date.now();
  const v = lookupVoucher(input.code, dublinDate(now));
  if (!v) return { ok: false, error: "Voucher not found." };
  if (v.state === "cancelled") return { ok: false, error: "This voucher was cancelled." };
  if (v.state === "used") return { ok: false, error: "This voucher has been used." };
  if (toCents(input.priceEur) <= 0) return { ok: false, error: "This booking has no price, so there is nothing for the voucher to pay." };

  let treatmentPrice: number | null = null;
  if (v.kind === "treatment") {
    if (!v.therapyId || !input.therapyIds.includes(v.therapyId)) {
      return { ok: false, error: `This voucher is for ${v.therapyName ?? "a different treatment"}.` };
    }
    treatmentPrice = db.select({ p: therapies.defaultPriceEur }).from(therapies).where(eq(therapies.id, v.therapyId)).get()?.p ?? input.priceEur;
  }
  const split = splitPayment({ kind: v.kind, balanceEur: v.balanceEur }, input.priceEur, treatmentPrice);
  const method = input.secondaryMethod ?? "";
  if (split.remainderEur > 0 && !OTHER_METHODS.includes(method)) {
    return {
      ok: false,
      error: `The voucher pays ${formatEuro(split.voucherEur)} of ${formatEuro(input.priceEur)}. Choose how the other ${formatEuro(split.remainderEur)} is paid.`,
    };
  }
  const { paymentId } = recordVoucherUse(
    {
      voucherId: v.id,
      redemptionEur: split.redemptionEur,
      paymentEur: split.voucherEur,
      clientId: input.clientId,
      appointmentId: input.appointmentId,
      packageId: null,
      userId: input.userId,
      note: `Voucher ${v.code}`,
      remainder: split.remainderEur > 0 ? { amountEur: split.remainderEur, method: method as OtherMethod, note: `Rest after voucher ${v.code}` } : null,
    },
    now,
  );
  return { ok: true, voucherEur: split.voucherEur, remainderEur: split.remainderEur, paymentId, expired: v.expired };
}
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `cd app && npm test -- src/lib/vouchers/redeem.test.ts`
Expected: PASS, printing `vouchers redeem: split payments, treatment vouchers, refusals; all passed`.

- [ ] **Step 5: Use it in the booking route**

In `app/src/app/api/appointments/route.ts`, replace:

```ts
import {
  appointments,
  clients,
  giftVouchers,
  packages,
  packageTemplates,
  payments,
} from "@/lib/db/schema";
```

with:

```ts
import {
  appointments,
  clients,
  packages,
  packageTemplates,
  payments,
} from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { redeemAtBooking } from "@/lib/vouchers/redeem";
```

In `app/src/app/api/appointments/route.ts`, replace:

```ts
    let voucherId: number | null = null;
    let voucherDeducted = 0;
    if (parsed.paymentMethod === "voucher" && voucherCode) {
      const v = db
        .select()
        .from(giftVouchers)
        .where(eq(giftVouchers.code, voucherCode.trim()))
        .get();
      const today = new Date().toISOString().slice(0, 10);
      if (!v) return rollback(apptId, "Voucher not found.");
      if (v.expiryDate < today) return rollback(apptId, "Voucher has expired.");
      const balance = v.balanceEur ?? v.valueEur;
      const secondaryMethod = (fd.get("secondaryPaymentMethod") as string) || "";
      if (balance < parsed.totalPriceEur) {
        // Need to split: voucher covers the balance, the rest comes from a
        // secondary method (cash / card / bank_transfer).
        const allowed = ["cash", "card", "bank_transfer"];
        if (!allowed.includes(secondaryMethod)) {
          return rollback(
            apptId,
            `Voucher balance €${balance.toFixed(2)} doesn't cover the €${parsed.totalPriceEur.toFixed(2)} session — choose a method for the €${(parsed.totalPriceEur - balance).toFixed(2)} remainder.`,
          );
        }
      }
      voucherId = v.id;
      voucherDeducted = Math.min(balance, parsed.totalPriceEur);
      const newBalance = balance - voucherDeducted;
      db.update(giftVouchers)
        .set({
          balanceEur: newBalance,
          isRedeemed: newBalance <= 0.01 ? true : false,
          redeemedByClientId: resolvedClientId,
          redeemedAt: new Date(),
        })
        .where(eq(giftVouchers.id, v.id))
        .run();

      // Voucher portion of the payment.
      db.insert(payments)
        .values({
          clientId: resolvedClientId,
          appointmentId: apptId,
          packageId: null,
          voucherId,
          amountEur: voucherDeducted,
          paymentMethod: "voucher",
          notes: null,
        })
        .run();

      // Remainder, if any, by the secondary method.
      const remainder = parsed.totalPriceEur - voucherDeducted;
      if (remainder > 0.01) {
        db.insert(payments)
          .values({
            clientId: resolvedClientId,
            appointmentId: apptId,
            packageId: null,
            voucherId: null,
            amountEur: remainder,
            paymentMethod: secondaryMethod as
              | "cash"
              | "card"
              | "bank_transfer",
            notes: `Top-up after voucher ${v.code}`,
          })
          .run();
      }
    } else {
      // No voucher — single payment row for the full session.
```

with:

```ts
    if (parsed.paymentMethod === "voucher") {
      // The voucher pays what it can and any rest is a second payment, with
      // one voucher_redemptions row and the new balance (lib/vouchers/redeem).
      // An expired voucher is still taken: staff saw the warning on the form.
      if (!voucherCode.trim()) return rollback(apptId, "Enter the voucher code.");
      const staff = await getSessionUser();
      const used = redeemAtBooking({
        code: voucherCode,
        clientId: resolvedClientId,
        appointmentId: apptId,
        priceEur: parsed.totalPriceEur,
        therapyIds,
        secondaryMethod: (fd.get("secondaryPaymentMethod") as string) || null,
        userId: staff?.id ?? null,
      });
      if (!used.ok) return rollback(apptId, used.error);
    } else {
      // No voucher — single payment row for the full session.
```

- [ ] **Step 6: The code lookup the booking form calls**

In `app/src/app/api/vouchers/[code]/route.ts`, replace:

```ts
import { NextResponse } from "next/server";
import { getVoucherByCode } from "@/lib/queries";
import { guard } from "@/lib/api/guard";
```

with:

```ts
import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { lookupVoucher } from "@/lib/vouchers/redeem";
```

In `app/src/app/api/vouchers/[code]/route.ts`, replace:

```ts
  const voucher = await getVoucherByCode(params.code);
  if (!voucher) return NextResponse.json({ ok: false });
  const today = new Date().toISOString().slice(0, 10);
  const expired = voucher.expiryDate < today;
  const empty = (voucher.balanceEur ?? 0) <= 0;
  return NextResponse.json({
    ok: true,
    redeemable: !expired && !empty,
    expired,
    empty,
    valueEur: voucher.valueEur,
    balanceEur: voucher.balanceEur ?? voucher.valueEur,
  });
```

with:

```ts
  const v = lookupVoucher(decodeURIComponent(params.code));
  if (!v) return NextResponse.json({ ok: false });
  // An expired voucher is a warning, not a refusal: staff may still take it.
  return NextResponse.json({
    ok: true,
    redeemable: v.state !== "used" && v.state !== "cancelled",
    expired: v.expired,
    empty: v.state === "used",
    cancelled: v.state === "cancelled",
    kind: v.kind,
    therapyId: v.therapyId,
    therapyName: v.therapyName,
    recipientName: v.recipientName,
    purchaserName: v.purchaserName,
    expiryDate: v.expiryDate,
    valueEur: v.valueEur,
    balanceEur: v.balanceEur,
  });
```

- [ ] **Step 7: The booking form: type, balance, expiry warning, treatment vouchers**

In `app/src/components/appointments/BookingForm.tsx`, replace:

```tsx
  defaultWalkInName?: string;
}
```

with:

```tsx
  defaultWalkInName?: string;
}

/** What /api/vouchers/<code> says about a code typed at the desk. */
type VoucherInfo =
  | { state: "idle" | "invalid" | "empty" | "cancelled" }
  | {
      state: "valid";
      kind: "amount" | "treatment";
      balance: number;
      therapyId: number | null;
      therapyName: string | null;
      recipientName: string | null;
      expiryDate: string;
      expired: boolean;
    };
```

In `app/src/components/appointments/BookingForm.tsx`, replace:

```tsx
  const [voucherInfo, setVoucherInfo] = useState<{
    state: "idle" | "valid" | "invalid" | "expired" | "empty";
    balance?: number;
  }>({ state: "idle" });
```

with:

```tsx
  const [voucherInfo, setVoucherInfo] = useState<VoucherInfo>({ state: "idle" });
```

In `app/src/components/appointments/BookingForm.tsx`, replace:

```tsx
  // Validate voucher code
  useEffect(() => {
    if (paymentMethod !== "voucher" || !voucherCode) {
      setVoucherInfo({ state: "idle" });
      return;
    }
    const id = setTimeout(() => {
      fetch(`/api/vouchers/${encodeURIComponent(voucherCode)}`)
        .then((r) => r.json())
        .then(
          (d: {
            ok: boolean;
            redeemable?: boolean;
            expired?: boolean;
            empty?: boolean;
            balanceEur?: number;
          }) => {
            if (!d.ok) setVoucherInfo({ state: "invalid" });
            else if (d.expired) setVoucherInfo({ state: "expired" });
            else if (d.empty) setVoucherInfo({ state: "empty" });
            else
              setVoucherInfo({
                state: "valid",
                balance: d.balanceEur ?? 0,
              });
          },
        )
        .catch(() => setVoucherInfo({ state: "invalid" }));
    }, 250);
    return () => clearTimeout(id);
  }, [voucherCode, paymentMethod]);

```

with:

```tsx
  // Validate voucher code
  useEffect(() => {
    if (paymentMethod !== "voucher" || !voucherCode) {
      setVoucherInfo({ state: "idle" });
      return;
    }
    const id = setTimeout(() => {
      fetch(`/api/vouchers/${encodeURIComponent(voucherCode)}`)
        .then((r) => r.json())
        .then(
          (d: {
            ok: boolean;
            empty?: boolean;
            cancelled?: boolean;
            expired?: boolean;
            kind?: "amount" | "treatment";
            balanceEur?: number;
            therapyId?: number | null;
            therapyName?: string | null;
            recipientName?: string | null;
            expiryDate?: string;
          }) => {
            if (!d.ok) setVoucherInfo({ state: "invalid" });
            else if (d.cancelled) setVoucherInfo({ state: "cancelled" });
            else if (d.empty) setVoucherInfo({ state: "empty" });
            else
              setVoucherInfo({
                state: "valid",
                kind: d.kind === "treatment" ? "treatment" : "amount",
                balance: d.balanceEur ?? 0,
                therapyId: d.therapyId ?? null,
                therapyName: d.therapyName ?? null,
                recipientName: d.recipientName ?? null,
                expiryDate: d.expiryDate ?? "",
                expired: d.expired === true,
              });
          },
        )
        .catch(() => setVoucherInfo({ state: "invalid" }));
    }, 250);
    return () => clearTimeout(id);
  }, [voucherCode, paymentMethod]);

  // What the voucher pays towards this booking: a money voucher up to its
  // balance; a treatment voucher the whole session if it is that treatment.
  const voucherWrongTreatment =
    voucherInfo.state === "valid" && voucherInfo.kind === "treatment" && voucherInfo.therapyId !== therapyId;
  const voucherCovers =
    voucherInfo.state !== "valid"
      ? 0
      : voucherInfo.kind === "treatment"
        ? voucherWrongTreatment
          ? 0
          : price
        : Math.min(voucherInfo.balance, price);

```

In `app/src/components/appointments/BookingForm.tsx`, replace:

```tsx
      if (
        voucherInfo.state === "valid" &&
        voucherInfo.balance != null &&
        voucherInfo.balance < price
      ) {
        fd.set("secondaryPaymentMethod", secondaryPaymentMethod);
      }
```

with:

```tsx
      if (voucherInfo.state === "valid" && !voucherWrongTreatment && voucherCovers < price) {
        fd.set("secondaryPaymentMethod", secondaryPaymentMethod);
      }
```

In `app/src/components/appointments/BookingForm.tsx`, replace:

```tsx
            {voucherCode && voucherInfo.state !== "idle" && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {voucherInfo.state === "valid" && voucherInfo.balance != null ? (
                  <>
                    <div style={{ color: "#047857", fontWeight: 500 }}>
                      Valid voucher · €{voucherInfo.balance.toFixed(2)} balance
                    </div>
                    {price > 0 && voucherInfo.balance >= price && (
                      <div style={{ color: "var(--text-secondary)" }}>
                        Deduct €{price.toFixed(2)} → €
                        {(voucherInfo.balance - price).toFixed(2)} remaining
                        after this session
                      </div>
                    )}
                  </>
                ) : voucherInfo.state === "empty" ? (
                  <div style={{ color: "#b45309" }}>
                    Voucher fully redeemed (no balance left).
                  </div>
                ) : voucherInfo.state === "expired" ? (
                  <div style={{ color: "#dc2626" }}>Voucher has expired.</div>
                ) : (
                  <div style={{ color: "#dc2626" }}>Voucher not found.</div>
                )}
              </div>
            )}

            {/* Split-payment picker — shown when balance < session price */}
            {voucherInfo.state === "valid" &&
              voucherInfo.balance != null &&
              price > 0 &&
              voucherInfo.balance < price && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    border: "1px solid var(--hairline-strong)",
                    borderRadius: "var(--radius)",
                    background: "rgba(180, 83, 9, 0.04)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      marginBottom: 6,
                    }}
                  >
                    Split payment
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      marginBottom: 12,
                    }}
                  >
                    Voucher covers €{voucherInfo.balance.toFixed(2)} of €
                    {price.toFixed(2)}. The remaining €
                    {(price - voucherInfo.balance).toFixed(2)} will be charged
                    by:
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["card", "cash", "bank_transfer"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSecondaryPaymentMethod(m)}
                        style={{
                          padding: "6px 14px",
                          fontSize: 12,
                          borderRadius: "var(--radius)",
                          border: `1px solid ${
                            secondaryPaymentMethod === m
                              ? "var(--text-primary)"
                              : "var(--hairline)"
                          }`,
                          background:
                            secondaryPaymentMethod === m
                              ? "var(--text-primary)"
                              : "transparent",
                          color:
                            secondaryPaymentMethod === m
                              ? "var(--bg)"
                              : "var(--text-secondary)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textTransform: "capitalize",
                        }}
                      >
```

with:

```tsx
            {voucherCode && voucherInfo.state !== "idle" && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {voucherInfo.state === "valid" ? (
                  <>
                    <div style={{ color: "#047857", fontWeight: 500 }}>
                      {voucherInfo.kind === "treatment"
                        ? `Treatment voucher: one ${voucherInfo.therapyName ?? "session"}`
                        : `Money voucher: €${voucherInfo.balance.toFixed(2)} left`}
                      {voucherInfo.recipientName ? ` · for ${voucherInfo.recipientName}` : ""}
                    </div>
                    {voucherInfo.expired && (
                      <div style={{ color: "#b45309" }}>
                        This voucher&apos;s date ({voucherInfo.expiryDate}) has passed. You can still take it.
                      </div>
                    )}
                    {voucherWrongTreatment ? (
                      <div style={{ color: "#dc2626" }}>
                        This voucher is for {voucherInfo.therapyName ?? "a different treatment"}.
                      </div>
                    ) : voucherInfo.kind === "treatment" ? (
                      <div style={{ color: "var(--text-secondary)" }}>
                        Pays for this session. The voucher is then used up.
                      </div>
                    ) : (
                      price > 0 &&
                      voucherInfo.balance >= price && (
                        <div style={{ color: "var(--text-secondary)" }}>
                          Pays €{price.toFixed(2)}. €{(voucherInfo.balance - price).toFixed(2)} stays on the voucher.
                        </div>
                      )
                    )}
                  </>
                ) : voucherInfo.state === "empty" ? (
                  <div style={{ color: "#b45309" }}>This voucher has been used.</div>
                ) : voucherInfo.state === "cancelled" ? (
                  <div style={{ color: "#dc2626" }}>This voucher was cancelled.</div>
                ) : (
                  <div style={{ color: "#dc2626" }}>Voucher not found.</div>
                )}
              </div>
            )}

            {/* Split payment: shown when the voucher pays less than the session */}
            {voucherInfo.state === "valid" &&
              !voucherWrongTreatment &&
              price > 0 &&
              voucherCovers < price && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    border: "1px solid var(--hairline-strong)",
                    borderRadius: "var(--radius)",
                    background: "rgba(180, 83, 9, 0.04)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      marginBottom: 6,
                    }}
                  >
                    Split payment
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      marginBottom: 12,
                    }}
                  >
                    The voucher pays €{voucherCovers.toFixed(2)} of €{price.toFixed(2)}. The other €
                    {(price - voucherCovers).toFixed(2)} is paid by:
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["card", "cash", "bank_transfer"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSecondaryPaymentMethod(m)}
                        style={{
                          padding: "8px 16px",
                          fontSize: 12,
                          borderRadius: "var(--radius)",
                          border: `1px solid ${
                            secondaryPaymentMethod === m
                              ? "var(--text-primary)"
                              : "var(--hairline)"
                          }`,
                          background:
                            secondaryPaymentMethod === m
                              ? "var(--text-primary)"
                              : "transparent",
                          color:
                            secondaryPaymentMethod === m
                              ? "var(--bg)"
                              : "var(--text-secondary)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textTransform: "capitalize",
                        }}
                      >
```

- [ ] **Step 8: Package sales write a redemption too**

In `app/src/app/packages/actions.ts`, replace:

```ts
import { createPackage } from "@/lib/packages";
```

with:

```ts
import { createPackage } from "@/lib/packages";
import { recordVoucherUse } from "@/lib/vouchers/redeem";
```

In `app/src/app/packages/actions.ts`, replace:

```ts
import { eq, sql } from "drizzle-orm";
```

with:

```ts
import { eq } from "drizzle-orm";
```

In `app/src/app/packages/actions.ts`, replace:

```ts
  if (!v) return { ok: false, error: "Voucher not found." };
```

with:

```ts
  if (!v) return { ok: false, error: "Voucher not found." };
  if (v.cancelledAt) return { ok: false, error: "This voucher was cancelled." };
  if (v.kind === "treatment") return { ok: false, error: "A treatment voucher is used when its session is booked." };
```

In `app/src/app/packages/actions.ts`, replace:

```ts
export async function sellPackageAction(formData: FormData) {
  await requireUser();
```

with:

```ts
export async function sellPackageAction(formData: FormData) {
  const staff = await requireUser();
```

In `app/src/app/packages/actions.ts`, replace:

```ts
    if (!v) throw new Error("Voucher not found.");
```

with:

```ts
    if (!v) throw new Error("Voucher not found.");
    if (v.cancelledAt) throw new Error("This voucher was cancelled.");
    if (v.kind === "treatment") throw new Error("A treatment voucher is used when its session is booked.");
```

In `app/src/app/packages/actions.ts`, replace:

```ts
  // Voucher payment row (if any)
  if (voucherRow && voucherApplied > 0) {
    const newBalance = Math.max(0, voucherRow.balanceEur - voucherApplied);
    db.update(giftVouchers)
      .set({
        balanceEur: newBalance,
        isRedeemed: newBalance === 0,
        redeemedAt: newBalance === 0 ? new Date() : undefined,
        redeemedByClientId: sql`COALESCE(${giftVouchers.redeemedByClientId}, ${parsed.clientId})`,
      })
      .where(eq(giftVouchers.id, voucherRow.id))
      .run();

    db.insert(payments)
      .values({
        clientId: parsed.clientId,
        packageId,
        voucherId: voucherRow.id,
        amountEur: voucherApplied,
        paymentMethod: "voucher",
        notes: `Voucher ${voucherRow.code} applied to package: ${parsed.packageName}`,
      })
      .run();
  }

```

with:

```ts
  // Voucher payment row (if any), its redemption and the new balance, together
  // (lib/vouchers/redeem), so the voucher's history shows this use too.
  if (voucherRow && voucherApplied > 0) {
    recordVoucherUse({
      voucherId: voucherRow.id,
      redemptionEur: voucherApplied,
      paymentEur: voucherApplied,
      clientId: parsed.clientId,
      appointmentId: null,
      packageId,
      userId: staff.id,
      note: `Voucher ${voucherRow.code} applied to package: ${parsed.packageName}`,
      remainder: null,
    });
  }

```

- [ ] **Step 9: The unused booking action follows the same rules**

In `app/src/app/appointments/actions.ts`, replace:

```ts
import { appointmentStatusDates } from "@/lib/statusDates";
```

with:

```ts
import { appointmentStatusDates } from "@/lib/statusDates";
import { redeemAtBooking } from "@/lib/vouchers/redeem";
```

In `app/src/app/appointments/actions.ts`, replace:

```ts
  appointments,
  giftVouchers,
  packages,
```

with:

```ts
  appointments,
  packages,
```

In `app/src/app/appointments/actions.ts`, replace:

```ts
export async function createAppointmentAction(formData: FormData) {
  await requireUser();
```

with:

```ts
export async function createAppointmentAction(formData: FormData) {
  const staff = await requireUser();
```

In `app/src/app/appointments/actions.ts`, replace:

```ts
  // Record payment
  if (parsed.totalPriceEur > 0 || parsed.paymentMethod === "package") {
    let voucherId: number | undefined;
    if (parsed.paymentMethod === "voucher" && parsed.voucherCode) {
      const v = db
        .select()
        .from(giftVouchers)
        .where(eq(giftVouchers.code, parsed.voucherCode.trim()))
        .get();
      if (v && !v.isRedeemed) {
        voucherId = v.id;
        db.update(giftVouchers)
          .set({
            isRedeemed: true,
            redeemedByClientId: parsed.clientId,
            redeemedAt: new Date(),
          })
          .where(eq(giftVouchers.id, v.id))
          .run();
      }
    }

    db.insert(payments)
      .values({
        clientId: parsed.clientId,
        appointmentId: apptId,
        packageId: parsed.packageId ?? null,
        voucherId: voucherId ?? null,
        amountEur:
          parsed.paymentMethod === "package" ? 0 : parsed.totalPriceEur,
        paymentMethod: parsed.paymentMethod,
        notes: null,
      })
      .run();
  }

```

with:

```ts
  // Record payment. A voucher follows the booking form's rules (lib/vouchers/redeem).
  if (parsed.paymentMethod === "voucher") {
    const used = redeemAtBooking({
      code: parsed.voucherCode ?? "",
      clientId: parsed.clientId,
      appointmentId: apptId,
      priceEur: parsed.totalPriceEur,
      therapyIds: parsed.therapyIds,
      secondaryMethod: null,
      userId: staff.id,
    });
    if (!used.ok) {
      db.delete(appointments).where(eq(appointments.id, apptId)).run();
      throw new Error(used.error);
    }
  } else if (parsed.totalPriceEur > 0 || parsed.paymentMethod === "package") {
    db.insert(payments)
      .values({
        clientId: parsed.clientId,
        appointmentId: apptId,
        packageId: parsed.packageId ?? null,
        voucherId: null,
        amountEur:
          parsed.paymentMethod === "package" ? 0 : parsed.totalPriceEur,
        paymentMethod: parsed.paymentMethod,
        notes: null,
      })
      .run();
  }

```

- [ ] **Step 10: Check it**

Run: `cd app && npm run typecheck`
Expected: exits 0.

Run: `cd app && npm test -- src/lib/vouchers/redeem.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/vouchers/redeem.ts app/src/lib/vouchers/redeem.test.ts app/src/app/api/appointments/route.ts 'app/src/app/api/vouchers/[code]/route.ts' app/src/components/appointments/BookingForm.tsx app/src/app/packages/actions.ts app/src/app/appointments/actions.ts
git commit -m "$(cat <<'EOF'
feat(vouchers): take vouchers at booking with balances, treatment vouchers and redemption history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Rebrand the Renova-only email and staff vouchers

**Files:**
- Replace: `app/src/app/vouchers/[code]/email/route.ts` (whole file)
- Delete: `app/src/lib/voucherEmail.ts`
- Modify: `app/src/app/vouchers/actions.ts`
- Modify: `app/src/components/vouchers/NewVoucherForm.tsx`
- Modify: `app/src/app/vouchers/page.tsx` (the example code in the how-to card)

**Interfaces:**
- Consumes: Task 4 `renderGiftEmail`, `voucherBrand`; Task 3 `getVoucherByCode`, `orderForVoucher`, `brandPaletteForTenant`, `therapyName`, `newVoucherCode`; Task 2 `codePrefix`, `colourways`, `parseColourway`, `voucherTitle`; `guard` from `lib/api/guard.ts`.
- Produces: nothing new.

- [ ] **Step 1: The gift email preview, on the business's own brand**

Replace the whole of `app/src/app/vouchers/[code]/email/route.ts` with:

```ts
import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";
import { renderGiftEmail, voucherBrand } from "@/lib/vouchers/email";
import { colourways, parseColourway, voucherTitle } from "@/lib/vouchers/model";
import { brandPaletteForTenant, getVoucherByCode, orderForVoucher, therapyName } from "@/lib/vouchers/store";

export const dynamic = "force-dynamic";

/**
 * Staff preview of a voucher's gift email, exactly as the recipient gets it:
 * this business's name, logo and colours (lib/vouchers/email).
 */
export async function GET(_request: Request, props: { params: Promise<{ code: string }> }) {
  const denied = await guard("user");
  if (denied) return denied;
  const params = await props.params;
  const v = getVoucherByCode(decodeURIComponent(params.code));
  if (!v) return new NextResponse("Voucher not found", { status: 404 });
  const tenantId = getCurrentTenant().id;
  const order = orderForVoucher(v);
  const { html } = renderGiftEmail({
    brand: voucherBrand(tenantId, order?.siteId ?? null, order?.siteUrl ?? null),
    colourway: parseColourway(v.colourway) ?? colourways(brandPaletteForTenant(tenantId))[0]!,
    fromName: v.purchaserName,
    toName: v.recipientName || "you",
    message: v.message,
    title: voucherTitle({ kind: v.kind, valueEur: v.valueEur, therapyName: therapyName(v.therapyId) }),
    code: v.code,
    expiry: v.expiryDate,
    revealUrl: order && v.viewToken ? `${order.siteUrl}/v/${v.viewToken}` : "#",
  });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
```

Delete the Renova-hardcoded email (its only caller was the route above):

```bash
git rm app/src/lib/voucherEmail.ts
```

- [ ] **Step 2: Desk-made vouchers: the business's own code prefix, 5 years by default**

In `app/src/app/vouchers/actions.ts`, replace:

```ts
import { logActivity } from "@/lib/queries";
import { genVoucherCode } from "@/lib/utils";
```

with:

```ts
import { logActivity } from "@/lib/queries";
import { getBusinessProfile } from "@/lib/businessProfile";
import { codePrefix } from "@/lib/vouchers/model";
import { newVoucherCode } from "@/lib/vouchers/store";
```

In `app/src/app/vouchers/actions.ts`, replace:

```ts
import { eq } from "drizzle-orm";
```

with:

```ts

```

In `app/src/app/vouchers/actions.ts`, replace:

```ts
  // Generate a unique code
  let code = genVoucherCode();
  while (db.select().from(giftVouchers).where(eq(giftVouchers.code, code)).get()) {
    code = genVoucherCode();
  }
```

with:

```ts
  // A unique code with this business's own prefix ("OH-2026-K7QX").
  const code = newVoucherCode(codePrefix(getBusinessProfile().businessName));
```

In `app/src/components/vouchers/NewVoucherForm.tsx`, replace:

```tsx
    d.setFullYear(d.getFullYear() + 1);
```

with:

```tsx
    // Irish law: a gift voucher lasts at least 5 years (Consumer Rights Act 2022).
    d.setFullYear(d.getFullYear() + 5);
```

- [ ] **Step 3: No Renova code in the how-to card**

In `app/src/app/vouchers/page.tsx`, replace:

```tsx
                Open the new voucher and write the <strong>code</strong> (e.g.{" "}
                <code style={codeStyle}>RCH-2026-A4F2</code>), the{" "}
```

with:

```tsx
                Open the new voucher and write the <strong>code</strong> (it looks like{" "}
                <code style={codeStyle}>AB-2026-K7QX</code>), the{" "}
```

- [ ] **Step 4: Check nothing Renova-only is left in the voucher code**

Run: `grep -rn "renova-logo\|Renova\|RCH-\|renovacellular" app/src/app/vouchers app/src/lib/vouchers app/src/components/vouchers`
Expected: no output.

Run: `cd app && npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add 'app/src/app/vouchers/[code]/email/route.ts' app/src/app/vouchers/actions.ts app/src/components/vouchers/NewVoucherForm.tsx app/src/app/vouchers/page.tsx
git commit -m "$(cat <<'EOF'
refactor(vouchers): gift email and desk vouchers on each business's own brand, 5-year default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

(`git rm` in Step 1 already staged the deletion.)

---

### Task 11: Full checks, browser check, deploy, then the live switch-on (controller task)

**Files:**
- Modify (Step 8 only, after the user agrees): `sites/optimal-health/build.mjs`, `sites/optimal-health/pages/pricing.html`, and the bundle `app/public/sites/optimal-health/_pages.json`

- [ ] **Step 1: Full suite**

Run: `cd app && npm test`
Expected: every file passes; the last line reports `N/N test file(s) passed` with no FAILED lines. This includes the suite-wide guards: `src/lib/ai/meteredGuard.test.ts` (nothing here calls a model), `src/lib/features.test.ts`, `src/lib/cms/bundledSites.test.ts` (every public site route renders `<SiteTracking>`), `src/components/emphasisBudget.app.test.ts`, `src/components/dohertyFeedback.test.ts`. (`src/lib/programs/memberPrograms.test.ts` needs the dev control DB's seeded exercise library; it passes against the normal dev data.)

- [ ] **Step 2: Typecheck, lint and build**

Run: `cd app && npm run typecheck`
Expected: exits 0.

Run: `cd app && npm run lint`
Expected: no new errors in the files this plan touched (warnings elsewhere are pre-existing).

Run: `cd app && npx next build`
Expected: `Compiled successfully`, and the route list includes `/site/[siteSlug]/vouchers`, `/site/[siteSlug]/v/[token]`, `/api/voucher-store/checkout` and `/vouchers/store`.

- [ ] **Step 3: Browser check (local, dev data only)**

With the Task 6 local setup (flag allowed for the dev `optimal-health` tenant, store setting on, the temporary test-mode `stripe_connections` row), run `cd app && npm run dev` and check, at 390px and 1280px wide:

- `http://localhost:3000/site/optimal-health/vouchers` (a light site) and the same page for a dark site (switch the flag and setting on for `inspire` the same way and open `/site/inspire/vouchers`): the site's own navbar and footer; the card preview updates as you pick an amount, type To and From, pick a colour; "Other amount" refuses 24 and 501 with the plain message under the field; the treatment dropdown's chevron sits 12px from the edge with no text under it; nothing scrolls sideways at 390px; every chip and button is at least 44px tall.
- With the store setting `enabled:false`, `/vouchers` is a 404 (no site page of that name).
- `http://localhost:3000/vouchers/store` signed in as an admin: saving with 4 years shows "Vouchers must last at least 5 years. That is the law in Ireland."; saving with 5 works.
- The staff voucher page for the Task 7 test voucher, `/vouchers/OH-2026-TEST`: the card in the business's colours, the Left line reads "€20 left", Uses says "Not used yet.", and "See the gift email" opens an email with this business's name and colours.

Then remove the local test rows (`stripe_connections` row, the test voucher) as in Tasks 6 and 7.

- [ ] **Step 4: Land on main and deploy with the flag off**

```bash
git status
git push origin main
cd app && railway up
```

Expected: `git status` shows only the pre-existing untracked files from before this work; the deploy finishes and `https://app.adonisagent.ie/api/health` answers 200. The flag has `defaultRollout: "none"`, so no business sees anything yet.

- [ ] **Step 5: Smoke check production with the flag off**

Open `https://www.optimalhealthatinspire.ie/vouchers`: a 404 (the store is off; OH has no CMS page at /vouchers). The rest of the site is unchanged. Open Products > Vouchers in the app: the list renders, no "Online store" button.

- [ ] **Step 6: ASK THE USER before going further**

Stop and ask, in plain words, for two separate yeses:
1. "Switch the voucher store on for Optimal Health (tenant 1028), with amounts EUR 25, 50, 100, other amounts EUR 25 to 500, and which treatments?" (get the list of treatments from them).
2. "Buy one real EUR 25 voucher on www.optimalhealthatinspire.ie/vouchers and refund it in Stripe straight after?"

Do nothing in Steps 7 and 8 without both answers.

- [ ] **Step 7: After yes: switch on, set up, live test**

1. Admin console > Feature flags > Online voucher store: rollout "allow" with tenant 1028 only.
2. Signed in to Optimal Health as an admin: Products > Gift vouchers > Online store: tick Store on, amounts `25, 50, 100`, other amount on with 25 and 500, tick the treatments the user named, Valid for 5, Booking link blank (phone). Save.
3. Buy a EUR 25 voucher on `https://www.optimalhealthatinspire.ie/vouchers` sent to "me" with the user's email. Check: Stripe Checkout shows Optimal Health at Inspire and EUR 25 with no platform fee; the return page says "Thank you" with the card; the receipt email arrives from the business's sender (or "Optimal Health ... via AdonisAgent" if it has none) with a working "Open the voucher" link; the voucher shows "Bought online" in the app with the right code prefix and EUR 25 balance.
4. Refund the payment in Optimal Health's Stripe dashboard. Check the voucher shows Cancelled and the order "Refunded in Stripe" within a minute.

- [ ] **Step 8: Point their site at the store**

In `sites/optimal-health/build.mjs`, replace:

```js
const VOUCHERS = "https://optimalhealth.voucherconnect.com";
```

with:

```js
const VOUCHERS = "vouchers.html";
```

(The importer turns `vouchers.html` into `/site/optimal-health/vouchers`, which the own-domain render strips to `/vouchers`.)

In `sites/optimal-health/pages/pricing.html`, replace:

```html
    <p style="margin-top:clamp(20px,2.4vw,28px)"><a class="explore" href="https://optimalhealth.voucherconnect.com">Buy a voucher</a></p>
```

with:

```html
    <p style="margin-top:clamp(20px,2.4vw,28px)"><a class="explore" href="vouchers.html">Buy a voucher</a></p>
```

and replace:

```html
          <p>Yes. You can buy one online at <a href="https://optimalhealth.voucherconnect.com">optimalhealth.voucherconnect.com</a>. Or ring us on 083 867 2844.</p>
```

with:

```html
          <p>Yes. You can buy one online on our <a href="vouchers.html">gift voucher page</a>. Or ring us on 083 867 2844.</p>
```

Then:

```bash
cd sites/optimal-health && node build.mjs && cd ../..
grep -c "voucherconnect" sites/optimal-health/*.html
node tools/build-site-bundle.cjs --slug optimal-health
git add sites/optimal-health/build.mjs sites/optimal-health/pages/pricing.html sites/optimal-health/*.html app/public/sites/optimal-health/_pages.json
git commit -m "$(cat <<'EOF'
feat(optimal-health): Vouchers link and FAQ point at the new voucher store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
git push origin main
cd app && railway up
```

Expected: the `grep -c` prints `0` for every page; after the deploy the navbar "Vouchers" link and the pricing FAQ go to `https://www.optimalhealthatinspire.ie/vouchers`. Also check Settings > Business > FAQs in Optimal Health for an answer that names voucherconnect, and with the user's OK change it to the new page.

- [ ] **Step 9: Record it**

Update the memory files `stripe-connect-offers.md` (voucher store live for OH, the live test result) and `where-we-left-off.md`, and add a `voucher-store.md` entry to `MEMORY.md`.
