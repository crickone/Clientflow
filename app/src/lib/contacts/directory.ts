import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { buildDirectory, type DirectoryRecord, type Person } from "./directoryModel";

/**
 * Everyone in the system for the Contacts page: clients, leads (with their
 * column, and the Inbox-only conversations), the email mailing list and the
 * business's WhatsApp contacts, joined into one row per person
 * (lib/contacts/directoryModel). Read fresh each time; nothing is copied.
 * Runs in the ambient tenant.
 */
export function loadDirectory(): Person[] {
  const leadLast = new Map(
    db
      .select({ id: schema.leadMessages.leadId, at: sql<number>`max(${schema.leadMessages.createdAt})` })
      .from(schema.leadMessages)
      .groupBy(schema.leadMessages.leadId)
      .all()
      .map((r) => [r.id, Number(r.at)]),
  );
  const clientLast = new Map(
    db
      .select({ id: schema.clientMessages.clientId, at: sql<number>`max(${schema.clientMessages.createdAt})` })
      .from(schema.clientMessages)
      .groupBy(schema.clientMessages.clientId)
      .all()
      .map((r) => [r.id, Number(r.at)]),
  );
  const fullName = (a: string | null, b: string | null) => [a, b].filter(Boolean).join(" ").trim();

  const records: DirectoryRecord[] = [];
  for (const c of db.select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName, email: schema.clients.email, phone: schema.clients.phone }).from(schema.clients).all()) {
    records.push({ kind: "client", id: c.id, name: fullName(c.firstName, c.lastName), email: c.email, phone: c.phone || null, lastAt: clientLast.get(c.id) ?? null });
  }
  const leads = db
    .select({
      id: schema.leads.id,
      firstName: schema.leads.firstName,
      lastName: schema.leads.lastName,
      email: schema.leads.email,
      phone: schema.leads.phone,
      inboxOnly: schema.leads.inboxOnly,
      createdAt: schema.leads.createdAt,
      stage: schema.pipelineStages.name,
    })
    .from(schema.leads)
    .leftJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.leads.stageId))
    .all();
  for (const l of leads) {
    records.push({
      kind: "lead",
      id: l.id,
      name: fullName(l.firstName, l.lastName),
      email: l.email,
      phone: l.phone,
      stage: l.inboxOnly ? null : l.stage ?? null,
      inboxOnly: l.inboxOnly,
      createdAt: l.createdAt.getTime(),
      lastAt: leadLast.get(l.id) ?? null,
    });
  }
  for (const m of db.select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email, phone: schema.contacts.phone }).from(schema.contacts).all()) {
    records.push({ kind: "mailing", id: m.id, name: m.name, email: m.email, phone: m.phone });
  }
  for (const w of db.select().from(schema.whatsappContacts).all()) {
    records.push({ kind: "whatsapp", id: w.id, name: w.name, phone: w.phone, lastAt: w.lastChatAt, hidden: w.hidden });
  }
  return buildDirectory(records);
}
