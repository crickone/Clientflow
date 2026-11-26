import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { readKey, setKey } from "@/lib/settings";
import { fillLeadContact } from "@/lib/leads";
import { splitFullName } from "@/lib/humanName";
import { getWhatsAppBridge, isWhatsAppConfigured } from "@/lib/whatsapp";
import { mergeWaContacts, parseChatsPage, parseContactsPage, type WaContactRow } from "./contactsModel";

/**
 * Bring the business's WhatsApp contacts (its saved contacts and one-to-one
 * chats) into whatsapp_contacts, for the Contacts page. Runs when WhatsApp
 * connects, once a day, and from the page's Refresh button. Only fills that
 * table: it never makes a lead, starts a flow, sends anything or records
 * consent. A hidden contact stays hidden. Runs in the ambient tenant; fails
 * soft with a reason, kept in the setting whatsapp_contacts_sync.
 */

const PAGE = 500;
const MAX_PAGES = 20;
const SYNC_KEY = "whatsapp_contacts_sync";

export interface ContactsSyncState {
  /** When the last import ran (ms). */
  at: number | null;
  /** When an import last worked (ms). */
  okAt: number | null;
  count: number | null;
  error: string | null;
}

export function contactsSyncState(): ContactsSyncState {
  return readKey<ContactsSyncState>(SYNC_KEY, { at: null, okAt: null, count: null, error: null });
}

const running = new Set<number>();

async function readAll(fetchPage: (offset: number, count: number) => Promise<unknown>, parse: typeof parseContactsPage) {
  const items: ReturnType<typeof parseContactsPage>["items"] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { items: got, total } = parse(await fetchPage(page * PAGE, PAGE));
    items.push(...got);
    if ((page + 1) * PAGE >= total) break;
  }
  return items;
}

/** Upsert the rows: name, saved and last chat refreshed; hidden kept. Returns how many there are now. */
export function storeWhatsAppContacts(rows: WaContactRow[]): number {
  const now = Date.now();
  db.transaction((tx) => {
    for (const r of rows) {
      tx.insert(schema.whatsappContacts)
        .values({ phone: r.phone, name: r.name, saved: r.saved, lastChatAt: r.lastChatAt, createdAt: new Date(now), updatedAt: new Date(now) })
        .onConflictDoUpdate({
          target: schema.whatsappContacts.phone,
          set: {
            name: sql`coalesce(excluded.name, ${schema.whatsappContacts.name})`,
            saved: sql`excluded.saved`,
            lastChatAt: sql`coalesce(excluded.last_chat_at, ${schema.whatsappContacts.lastChatAt})`,
            updatedAt: new Date(now),
          },
        })
        .run();
    }
  });
  return db.select({ n: sql<number>`count(*)` }).from(schema.whatsappContacts).get()?.n ?? 0;
}

export async function syncWhatsAppContacts(): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const tenantId = getCurrentTenant()?.id ?? 0;
  const prev = contactsSyncState();
  const fail = (error: string) => {
    setKey(SYNC_KEY, { ...prev, at: Date.now(), error });
    return { ok: false as const, error };
  };
  if (!isWhatsAppConfigured()) return fail("WhatsApp is not connected.");
  if (running.has(tenantId)) return { ok: false, error: "An import is already running." };
  running.add(tenantId);
  try {
    const bridge = getWhatsAppBridge();
    if (!bridge.listContactsPage || !bridge.listChatsPage) return fail("This WhatsApp connection cannot list contacts.");
    let own: string | null = null;
    try {
      own = (await bridge.connectionStatus()).phone ?? null;
    } catch {
      // the business's own number is only used to leave it out
    }
    const contacts = await readAll((o, c) => bridge.listContactsPage!(o, c), parseContactsPage);
    const chats = await readAll((o, c) => bridge.listChatsPage!(o, c), parseChatsPage);
    const count = storeWhatsAppContacts(mergeWaContacts(contacts, chats, own));
    try {
      fillNamesFromWhatsApp();
    } catch (err) {
      console.error("[whatsapp contacts] naming leads failed:", err);
    }
    setKey(SYNC_KEY, { at: Date.now(), okAt: Date.now(), count, error: null } satisfies ContactsSyncState);
    return { ok: true, count };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The WhatsApp import failed.");
  } finally {
    running.delete(tenantId);
  }
}

/** Run the import once WhatsApp is connected and it has never worked. Never awaited by callers. */
export function syncWhatsAppContactsIfNever(): void {
  const state = contactsSyncState();
  // Never worked, and not tried in the last 10 minutes.
  if (state.okAt != null || (state.at != null && Date.now() - state.at < 10 * 60_000) || !isWhatsAppConfigured()) return;
  const tenantId = getCurrentTenant()?.id;
  if (!tenantId) return;
  // Bound to this business: it carries on after the request that started it.
  void runWithTenant(tenantId, () => syncWhatsAppContacts()).catch((err) => console.error("[whatsapp contacts] first import failed:", err));
}

/** The name for a phone number on the business's WhatsApp (as saved in the phone, else their own), or null. */
export function whatsappNameFor(phone: string | null | undefined): string | null {
  const key = (phone ?? "").replace(/\D/g, "").slice(-9);
  if (key.length < 7) return null;
  const row = db
    .select({ name: schema.whatsappContacts.name })
    .from(schema.whatsappContacts)
    .where(sql`substr(${schema.whatsappContacts.phone}, -9) = ${key} and ${schema.whatsappContacts.name} is not null`)
    .orderBy(sql`${schema.whatsappContacts.saved} desc`)
    .get();
  return row?.name?.trim() || null;
}

/**
 * Give a name to every lead (and Inbox conversation) that has none, from the
 * WhatsApp contact with the same number. Only blank names are filled; a name
 * someone typed is never changed. Returns how many were named.
 */
export function fillNamesFromWhatsApp(): number {
  const nameless = db
    .select({ id: schema.leads.id, phone: schema.leads.phone })
    .from(schema.leads)
    .where(sql`coalesce(trim(${schema.leads.firstName}), '') = '' and coalesce(trim(${schema.leads.lastName}), '') = '' and ${schema.leads.phone} is not null`)
    .all();
  let named = 0;
  for (const l of nameless) {
    const name = whatsappNameFor(l.phone);
    if (name && fillLeadContact(l.id, splitFullName(name))) named++;
  }
  return named;
}

/** Hide a contact from the Contacts page; later imports keep it hidden. */
export function hideWhatsAppContact(id: number): boolean {
  return db.update(schema.whatsappContacts).set({ hidden: true, updatedAt: new Date() }).where(eq(schema.whatsappContacts.id, id)).run().changes > 0;
}
