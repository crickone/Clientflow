"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientMemberships, clients, membershipPlans } from "@/lib/db/schema";
import { addInterval } from "@/lib/memberships";
import { logActivity } from "@/lib/queries";
import {
  dedupeKey,
  mapRow,
  normalizeDate,
  normalizeEmail,
  normalizePhone,
  parseCsv,
  validateRow,
  type ColumnMapping,
} from "@/lib/memberImport";

export interface ImportResult {
  ok: true;
  inserted: number;
  duplicates: number;
  invalid: number;
  updated: number;
  membershipsLinked: number;
}

const MAX_ROWS = 20000;

/**
 * Import members from a mapped CSV into the CURRENT tenant's clients table.
 * Tenant scoping is implicit and correct: this is an authed admin request, so
 * the `db` proxy resolves to the admin's active tenant. Re-parses + re-validates
 * + re-dedupes server-side (never trusts the client preview). Dedupe order:
 * email (case-insensitive), then phone (digits only), against existing clients
 * AND earlier rows in this same file.
 */
export async function importMembersAction(input: {
  csvText: string;
  mapping: ColumnMapping;
  createMemberships: boolean;
}): Promise<ImportResult | { ok: false; error: string }> {
  await requireAdmin();

  const csvText = String(input?.csvText ?? "");
  const mapping = (input?.mapping ?? {}) as ColumnMapping;
  const createMemberships = Boolean(input?.createMemberships);

  const { rows } = parseCsv(csvText);
  if (rows.length === 0) return { ok: false, error: "No rows to import." };
  if (rows.length > MAX_ROWS) {
    return { ok: false, error: `That file has too many rows (max ${MAX_ROWS.toLocaleString()}).` };
  }
  if (mapping.firstName === undefined && mapping.lastName === undefined) {
    return { ok: false, error: "Map at least a first or last name column." };
  }

  // Existing clients → dedupe sets (current tenant).
  const existing = db.select({ email: clients.email, phone: clients.phone }).from(clients).all();
  const emailSet = new Set(existing.map((e) => normalizeEmail(e.email ?? "")).filter(Boolean));
  const phoneSet = new Set(existing.map((e) => normalizePhone(e.phone ?? "")).filter(Boolean));

  // Membership plans by lowercased name (for name-matched linking).
  const plans = createMemberships
    ? db.select().from(membershipPlans).where(eq(membershipPlans.isActive, true)).all()
    : [];
  const planByName = new Map(plans.map((p) => [p.name.trim().toLowerCase(), p]));

  let inserted = 0;
  let duplicates = 0;
  let invalid = 0;
  let membershipsLinked = 0;

  for (const row of rows) {
    const m = mapRow(row, mapping);
    const v = validateRow(m);
    if (!v.ok) {
      invalid++;
      continue;
    }

    const key = dedupeKey(m);
    let dup = false;
    if (key.email && emailSet.has(key.email)) dup = true;
    if (!dup && key.phone && phoneSet.has(key.phone)) dup = true;
    if (dup) {
      duplicates++;
      continue;
    }

    let firstName = m.firstName;
    let lastName = m.lastName;
    if (!firstName) {
      firstName = lastName || "Member";
      lastName = "";
    }

    const joinIso = normalizeDate(m.joinDate);
    const [created] = db
      .insert(clients)
      .values({
        firstName,
        lastName,
        email: key.email,
        phone: m.phone || "",
        medicalNotes: m.notes || null,
        ...(joinIso ? { createdAt: new Date(`${joinIso}T00:00:00`) } : {}),
      })
      .returning({ id: clients.id })
      .all();
    inserted++;
    if (key.email) emailSet.add(key.email);
    if (key.phone) phoneSet.add(key.phone);

    if (createMemberships && m.membershipPlan) {
      const plan = planByName.get(m.membershipPlan.trim().toLowerCase());
      if (plan) {
        const startDate = joinIso ?? new Date().toISOString().slice(0, 10);
        db
          .insert(clientMemberships)
          .values({
            membershipId: plan.id,
            clientId: created.id,
            membershipName: plan.name,
            priceCents: plan.priceCents,
            status: "active",
            startDate,
            nextBillingDate: addInterval(startDate, plan.billingInterval, plan.billingCount),
          })
          .run();
        membershipsLinked++;
      }
    }
  }

  await logActivity("clients.import", `Imported ${inserted} member${inserted === 1 ? "" : "s"} from CSV`);
  revalidatePath("/clients");
  return { ok: true, inserted, duplicates, invalid, updated: 0, membershipsLinked };
}
