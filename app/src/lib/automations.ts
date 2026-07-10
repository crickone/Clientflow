import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { automationLog, automationMessages, automationTriggers } from "@/lib/db/schema";
import {
  TRIGGER_CATALOG,
  TRIGGER_LABELS,
  type Channel,
  type IntervalUnit,
  type MessageInput,
  type TriggerInput,
} from "@/lib/automationModel";

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
  return {
    key,
    label: def.label,
    description: def.description,
    enabled: state?.enabled ?? false,
    externalEnabled: state?.externalEnabled ?? false,
    messages: messages.map((m) => ({
      id: m.id,
      channel: m.channel as Channel,
      subject: m.subject,
      template: m.template ?? "",
      attachmentFilename: m.attachmentFilename,
      attachmentOriginal: m.attachmentOriginal,
      delayValue: m.delayValue,
      delayUnit: m.delayUnit as IntervalUnit,
    })),
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
