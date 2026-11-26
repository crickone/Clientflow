"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { addToPipeline, upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { hideWhatsAppContact, syncWhatsAppContacts } from "@/lib/whatsapp/contactsSync";

type Result = { ok: true; leadId: number } | { ok: false; error: string };

/**
 * Put someone from the Contacts page on the board: an Inbox-only conversation
 * is added as it is; a WhatsApp contact or a mailing-list contact becomes a
 * new lead (no automatic follow-up: neither is an enquiry). Safe to click twice.
 */
export async function addContactAsLeadAction(from: { kind: "inbox" | "whatsapp" | "mailing"; id: number }): Promise<Result> {
  await requireUser();
  if (!Number.isInteger(from.id) || from.id <= 0) return { ok: false, error: "This contact was not found." };
  let leadId: number | null = null;
  let label = "";
  if (from.kind === "inbox") {
    const r = addToPipeline(from.id, "user");
    if (!r) return { ok: false, error: "This contact was not found." };
    leadId = r.lead.id;
    label = [r.lead.firstName, r.lead.lastName].filter(Boolean).join(" ") || r.lead.phone || "";
  } else if (from.kind === "whatsapp") {
    const w = db.select().from(schema.whatsappContacts).where(eq(schema.whatsappContacts.id, from.id)).get();
    if (!w) return { ok: false, error: "This contact was not found." };
    const { lead } = upsertLead({ source: "whatsapp", sourceLeadId: `wa:${w.phone}`, phone: `+${w.phone}`, fullName: w.name, actor: "user" });
    leadId = lead.id;
    label = w.name || `+${w.phone}`;
  } else {
    const m = db.select().from(schema.contacts).where(eq(schema.contacts.id, from.id)).get();
    if (!m) return { ok: false, error: "This contact was not found." };
    const email = m.email.trim().toLowerCase();
    const { lead } = upsertLead({ source: "email", sourceLeadId: `email:${email}`, email, phone: m.phone, fullName: m.name, actor: "user" });
    leadId = lead.id;
    label = m.name || email;
  }
  await logActivity("lead.new", `Lead added from Contacts: ${label}`.trim(), { leadId });
  revalidatePath("/contacts");
  revalidatePath("/leads");
  return { ok: true, leadId };
}

/** Leave a WhatsApp-only contact (a friend, a supplier) out of the Contacts page. */
export async function hideWhatsAppContactAction(id: number): Promise<{ ok: boolean }> {
  await requireUser();
  const ok = Number.isInteger(id) && hideWhatsAppContact(id);
  revalidatePath("/contacts");
  return { ok };
}

/** Read the business's WhatsApp contacts again now. */
export async function refreshWhatsAppContactsAction(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await requireUser();
  const r = await syncWhatsAppContacts();
  revalidatePath("/contacts");
  return r;
}
