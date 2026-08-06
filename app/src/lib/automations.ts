import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { automationLog, automationMessages, automationTriggers, clients } from "@/lib/db/schema";
import {
  applyShortcodes,
  DEFAULT_MESSAGES,
  TRIGGER_CATALOG,
  TRIGGER_LABELS,
  type Channel,
  type IntervalUnit,
  type MessageInput,
  type TriggerInput,
} from "@/lib/automationModel";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";
import { renderEmailShell, sendEmail, textToParagraphs } from "@/lib/email";

const VALID_KEYS = new Set(TRIGGER_CATALOG.map((t) => t.key));

export interface TriggerListRow {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  messageCount: number;
}

/** Merge the fixed catalog with saved state (enabled + message counts). */
export function listTriggers(): TriggerListRow[] {
  const states = db.select().from(automationTriggers).all();
  const stateByKey = new Map(states.map((s) => [s.key, s]));
  const counts = new Map<string, number>();
  for (const m of db.select({ triggerKey: automationMessages.triggerKey }).from(automationMessages).all()) {
    counts.set(m.triggerKey, (counts.get(m.triggerKey) ?? 0) + 1);
  }
  return TRIGGER_CATALOG.map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
    enabled: stateByKey.get(t.key)?.enabled ?? false,
    messageCount: counts.get(t.key) ?? 0,
  }));
}

export interface TriggerDetail extends TriggerInput {
  label: string;
  description: string;
}

export function getTrigger(key: string): TriggerDetail | null {
  const def = TRIGGER_CATALOG.find((t) => t.key === key);
  if (!def) return null;
  const state = db.select().from(automationTriggers).where(eq(automationTriggers.key, key)).get();
  const messages = db
    .select()
    .from(automationMessages)
    .where(eq(automationMessages.triggerKey, key))
    .orderBy(asc(automationMessages.position))
    .all();
  // No message configured yet → offer a ready-made starter template.
  const mapped =
    messages.length > 0
      ? messages.map((m) => ({
          id: m.id,
          channel: m.channel as Channel,
          subject: m.subject,
          template: m.template ?? "",
          attachmentFilename: m.attachmentFilename,
          attachmentOriginal: m.attachmentOriginal,
          delayValue: m.delayValue,
          delayUnit: m.delayUnit as IntervalUnit,
        }))
      : (DEFAULT_MESSAGES[key] ?? []).map((m) => ({ ...m }));
  return {
    key,
    label: def.label,
    description: def.description,
    enabled: state?.enabled ?? false,
    externalEnabled: state?.externalEnabled ?? false,
    messages: mapped,
  };
}

function upsertTriggerState(key: string, patch: { enabled?: boolean; externalEnabled?: boolean }) {
  const existing = db.select().from(automationTriggers).where(eq(automationTriggers.key, key)).get();
  if (existing) {
    db.update(automationTriggers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(automationTriggers.key, key))
      .run();
  } else {
    db.insert(automationTriggers)
      .values({ key, enabled: patch.enabled ?? false, externalEnabled: patch.externalEnabled ?? false })
      .run();
  }
}

export function setTriggerEnabled(key: string, enabled: boolean) {
  if (!VALID_KEYS.has(key)) return;
  upsertTriggerState(key, { enabled });
}

export function saveTrigger(input: TriggerInput) {
  if (!VALID_KEYS.has(input.key)) return;
  db.transaction((tx) => {
    const existing = tx.select().from(automationTriggers).where(eq(automationTriggers.key, input.key)).get();
    if (existing) {
      tx.update(automationTriggers)
        .set({ enabled: input.enabled, externalEnabled: input.externalEnabled, updatedAt: new Date() })
        .where(eq(automationTriggers.key, input.key))
        .run();
    } else {
      tx.insert(automationTriggers)
        .values({ key: input.key, enabled: input.enabled, externalEnabled: input.externalEnabled })
        .run();
    }
    tx.delete(automationMessages).where(eq(automationMessages.triggerKey, input.key)).run();
    input.messages.forEach((m: MessageInput, i) => {
      tx.insert(automationMessages)
        .values({
          triggerKey: input.key,
          position: i,
          channel: m.channel,
          subject: m.subject,
          template: m.template,
          attachmentFilename: m.attachmentFilename,
          attachmentOriginal: m.attachmentOriginal,
          delayValue: m.delayValue,
          delayUnit: m.delayUnit,
        })
        .run();
    });
  });
}

export interface SentRow {
  id: number;
  triggerName: string;
  channel: string;
  subject: string | null;
  sentTo: string | null;
  status: string;
  sentAt: number;
}

/** Sent-automation log (empty until a sending engine is wired up). */
export function listSent(): SentRow[] {
  return db
    .select()
    .from(automationLog)
    .orderBy(desc(automationLog.sentAt))
    .all()
    .map((r) => ({
      id: r.id,
      triggerName: r.triggerName || TRIGGER_LABELS[r.triggerKey] || r.triggerKey,
      channel: r.channel,
      subject: r.subject,
      sentTo: r.sentTo,
      status: r.status,
      sentAt: r.sentAt.getTime(),
    }));
}

// ── Sending engine (email channel) ──────────────────────────────────────────

/**
 * Fire an automation trigger for a client. v1 delivers the EMAIL-channel
 * messages with no delay, personalising short-codes and logging each send.
 * Never throws — a failed automation must not break the action that called it.
 * (Push/chat channels and delayed messages need the client-app + scheduler and
 * are skipped for now.)
 */
export async function fireTrigger(triggerKey: string, clientId: number): Promise<void> {
  try {
    if (!VALID_KEYS.has(triggerKey)) return;
    const state = db.select().from(automationTriggers).where(eq(automationTriggers.key, triggerKey)).get();
    if (!state?.enabled) return;

    // Configured messages, or the ready-made default if none saved.
    const saved = db
      .select()
      .from(automationMessages)
      .where(eq(automationMessages.triggerKey, triggerKey))
      .orderBy(asc(automationMessages.position))
      .all();
    const messages: Pick<MessageInput, "channel" | "subject" | "template" | "delayValue">[] =
      saved.length > 0
        ? saved.map((m) => ({ channel: m.channel as Channel, subject: m.subject, template: m.template ?? "", delayValue: m.delayValue }))
        : (DEFAULT_MESSAGES[triggerKey] ?? []).map((m) => ({ channel: m.channel, subject: m.subject, template: m.template, delayValue: m.delayValue }));

    const emailMessages = messages.filter((m) => m.channel === "email" && m.delayValue === 0 && m.template.trim());
    if (emailMessages.length === 0) return;

    const client = db
      .select({ firstName: clients.firstName, lastName: clients.lastName, email: clients.email })
      .from(clients)
      .where(eq(clients.id, clientId))
      .get();
    if (!client?.email) return; // no address to send to

    const businessName = getBusinessProfile().businessName;
    const accent = getTheme().accent;
    const label = TRIGGER_LABELS[triggerKey] ?? triggerKey;
    const vars = { firstName: client.firstName, lastName: client.lastName, businessName };

    for (const m of emailMessages) {
      const subject = applyShortcodes((m.subject ?? "").trim() || `A message from ${businessName}`, vars);
      const bodyText = applyShortcodes(m.template, vars);
      const html = renderEmailShell({
        businessName,
        accent,
        bodyHtml: textToParagraphs(bodyText),
        footer: `Sent by ${businessName}.`,
      });
      const res = await sendEmail({ to: client.email, subject, html, text: bodyText });
      db.insert(automationLog)
        .values({
          triggerKey,
          triggerName: label,
          channel: "email",
          subject,
          sentTo: client.email,
          status: res.ok ? "sent" : "failed",
          sentAt: new Date(),
        })
        .run();
    }
  } catch {
    // swallow — never break the calling action
  }
}
