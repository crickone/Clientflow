"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { contacts, suppressions } from "@/lib/db/schema";
import { logActivity } from "@/lib/queries";
import {
  dedupeKey,
  mapRow,
  normalizeEmail,
  parseCsv,
  parseTags,
  validateRow,
  type ContactColumnMapping,
} from "@/lib/marketing/contactImport";

export interface ContactImportResult {
  ok: true;
  inserted: number;
  duplicates: number;
  invalid: number;
  suppressedSkipped: number;
}

const MAX_ROWS = 20000;

/**
 * Import contacts from a mapped CSV into the CURRENT tenant's contacts table
 * (the email-marketing mailing list — see lib/marketing/contactImport.ts).
 * Tenant scoping is implicit and correct: this is an authed admin request, so
 * the `db` proxy resolves to the admin's active tenant. Re-parses + re-
 * validates + re-dedupes server-side (never trusts the client preview).
 *
 * Suppressions are a hard gate, even here at import time: an email that
 * previously unsubscribed/bounced/complained is never (re)imported as a
 * subscribed contact, even if it's back in a fresh CSV — it's simply skipped
 * and counted in `suppressedSkipped`. That check runs BEFORE the existing-
 * contact dedupe check, so a suppressed+already-a-contact row is reported as
 * suppressed (the stronger rule), not a plain duplicate.
 */
export async function importContactsAction(input: {
  csvText: string;
  mapping: ContactColumnMapping;
}): Promise<ContactImportResult | { ok: false; error: string }> {
  await requireAdmin();

  const csvText = String(input?.csvText ?? "");
  const mapping = (input?.mapping ?? {}) as ContactColumnMapping;

  const { rows } = parseCsv(csvText);
  if (rows.length === 0) return { ok: false, error: "No rows to import." };
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `That file has too many rows (max ${MAX_ROWS.toLocaleString()}).` };
  }
  if (mapping.email === undefined) {
    return { ok: false, error: "Map an email column to continue." };
  }

  // Existing contacts → dedupe set (current tenant). Any existing row blocks
  // re-import regardless of its current status, same as importMembersAction.
  const existing = db.select({ email: contacts.email }).from(contacts).all();
  const emailSet = new Set(existing.map((e) => normalizeEmail(e.email ?? "")).filter(Boolean));

  // Suppressed emails (current tenant) — the hard do-not-(re)subscribe gate.
  const suppressed = db.select({ email: suppressions.email }).from(suppressions).all();
  const suppressedSet = new Set(suppressed.map((s) => normalizeEmail(s.email ?? "")).filter(Boolean));

  let inserted = 0;
  let duplicates = 0;
  let invalid = 0;
  let suppressedSkipped = 0;

  const now = new Date();

  for (const row of rows) {
    const m = mapRow(row, mapping);
    const v = validateRow(m);
    if (!v.ok) {
      invalid++;
      continue;
    }

    const key = dedupeKey(m);
    if (!key) {
      invalid++;
      continue;
    }

    if (suppressedSet.has(key)) {
      suppressedSkipped++;
      continue;
    }

    if (emailSet.has(key)) {
      duplicates++;
      continue;
    }

    db.insert(contacts)
      .values({
        email: key,
        name: m.name || null,
        phone: m.phone || null,
        tags: JSON.stringify(parseTags(m.tags)),
        status: "subscribed",
        source: "import",
        subscribedAt: now,
      })
      .run();
    inserted++;
    // Set updated in-loop so intra-file duplicates (same email twice in one
    // CSV) are caught on the second occurrence, not just against pre-existing
    // rows.
    emailSet.add(key);
  }

  await logActivity(
    "contacts.import",
    `Imported ${inserted} contact${inserted === 1 ? "" : "s"} from CSV`,
  );
  revalidatePath("/campaigns/contacts");
  return { ok: true, inserted, duplicates, invalid, suppressedSkipped };
}
