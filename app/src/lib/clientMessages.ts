import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { clientMessages, clients, type ClientMessage } from "./db/schema";
import { normalizePhone } from "./whatsapp/phone";

export function getClientMessages(clientId: number): ClientMessage[] {
  return db
    .select()
    .from(clientMessages)
    .where(eq(clientMessages.clientId, clientId))
    .orderBy(clientMessages.createdAt)
    .all();
}

export function addClientMessage(input: {
  clientId: number;
  direction: "outbound" | "inbound" | "note";
  channel?: "email" | "sms" | "whatsapp" | "call" | "manual" | "system" | null;
  content: string;
  aiGenerated?: boolean;
  providerMessageId?: string | null;
  status?: "queued" | "sent" | "delivered" | "read" | "failed" | null;
  sentAt?: Date | null;
}): ClientMessage {
  return db
    .insert(clientMessages)
    .values({
      clientId: input.clientId,
      direction: input.direction,
      channel: input.channel ?? null,
      content: input.content,
      aiGenerated: input.aiGenerated ?? false,
      providerMessageId: input.providerMessageId ?? null,
      status: input.status ?? null,
      sentAt: input.sentAt ?? null,
    })
    .returning()
    .all()[0];
}

export function findClientMessageByProviderId(providerMessageId: string) {
  return db
    .select()
    .from(clientMessages)
    .where(eq(clientMessages.providerMessageId, providerMessageId))
    .get();
}

export function setClientMessageStatus(
  id: number,
  status: "queued" | "sent" | "delivered" | "read" | "failed",
) {
  db.update(clientMessages).set({ status }).where(eq(clientMessages.id, id)).run();
}

/** Find a client by normalized phone match (for inbound routing). */
export function findClientByPhone(normalized: string) {
  if (!normalized) return undefined;
  const rows = db.select().from(clients).where(sql`${clients.phone} IS NOT NULL`).all();
  return rows.find((c) => normalizePhone(c.phone) === normalized);
}
