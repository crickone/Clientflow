import "server-only";

import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { ImportedPersonView } from "./types";

/** The GoHighLevel import record for a lead or client, for the staff pages. Ambient tenant. */
export function getImportedPerson(by: { leadId: number } | { clientId: number }): ImportedPersonView | null {
  const t = schema.ghlImportPeople;
  const row = db
    .select()
    .from(t)
    .where("leadId" in by ? eq(t.leadId, by.leadId) : eq(t.clientId, by.clientId))
    .orderBy(desc(t.id))
    .get();
  if (!row) return null;
  let tags: string[] = [];
  try {
    tags = row.tags ? (JSON.parse(row.tags) as string[]) : [];
  } catch {
    tags = [];
  }
  const leadDnc = "leadId" in by ? db.select({ v: schema.leads.doNotContact }).from(schema.leads).where(eq(schema.leads.id, by.leadId)).get()?.v : undefined;
  return {
    ghlStage: row.ghlStage,
    daysInStage: row.daysInStage,
    ghlSource: row.ghlSource,
    tags,
    treatment: row.treatment,
    usedBefore: row.usedBefore,
    town: row.town,
    staffMedicalNote: row.staffMedicalNote,
    doNotContact: leadDnc ?? row.doNotContact,
    importedAt: row.importedAt.getTime(),
  };
}

/**
 * A lead or client was deleted: drop the personal details the import kept
 * (the medical note, tags, custom fields). The GoHighLevel ids stay, so
 * importing the same files again does not bring the person back.
 */
export function forgetImportedPerson(by: { leadId?: number; clientId?: number }): void {
  const t = schema.ghlImportPeople;
  const blank = { staffMedicalNote: null, tags: null, treatment: null, usedBefore: null, town: null, ghlSource: null };
  if (by.leadId != null) db.update(t).set({ ...blank, leadId: null }).where(eq(t.leadId, by.leadId)).run();
  if (by.clientId != null) db.update(t).set({ ...blank, clientId: null }).where(eq(t.clientId, by.clientId)).run();
}

/** A person clears do not contact on the lead page. The do-not-email list and do-not-call are separate and stay. */
export function allowContactAgain(leadId: number): boolean {
  return db.update(schema.leads).set({ doNotContact: false }).where(eq(schema.leads.id, leadId)).run().changes > 0;
}
