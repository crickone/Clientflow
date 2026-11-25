import "server-only";
import { isTriggerEnabled } from "@/lib/automations/nurture";

import { asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { automationLog, automationMessages, automationTriggers, clients } from "@/lib/db/schema";
import {
  ACTIVE_TRIGGER_KEYS,
  applyShortcodes,
  DEFAULT_MESSAGES,
  isMessageLive,
  TRIGGER_CATALOG,
  TRIGGER_LABELS,
  type Channel,
  type IntervalUnit,
  type MessageInput,
  type TriggerInput,
  type TriggerStatus,
} from "@/lib/automationModel";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";
import { renderEmailShell, sendEmail, textToParagraphs } from "@/lib/email";
import { flowFinish, flowStartColumn } from "@/lib/leadFlows/definitions";
import { CALL_BOOKED_FLOW, LEAD_FLOW_KEY_SET, columnRefFor, flowDefaults, hasFinishStep, isColumnRef, isColumnStartedFlow } from "@/lib/leadFlows/flowModel";
import { defaultMessagesFor } from "@/lib/leadFlows/presets";
import { flowTenant } from "@/lib/leadFlows/tenant";
import { listStages } from "@/lib/pipeline/stageRepo";

const VALID_KEYS = new Set(TRIGGER_CATALOG.map((t) => t.key));

export interface TriggerListRow {
  key: string;
  label: string;
  description: string;
  status: TriggerStatus;
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
    status: t.status,
    enabled: isTriggerEnabled(t.key, stateByKey.get(t.key)),
    messageCount: counts.get(t.key) ?? 0,
  }));
}

/** The flow settings the editor offers for a lead flow. */
export interface FlowEditorInfo {
  /** "Starts when a lead enters" is offered. */
  columnStarted: boolean;
  /** "If they have not replied by the end, move them to" is offered. */
  finishable: boolean;
  /** Call booked: later messages are counted back from the call. */
  beforeCall: boolean;
  /** The main board's columns, as column references. */
  columns: { ref: string; name: string }[];
}

export interface TriggerDetail extends TriggerInput {
  label: string;
  description: string;
  status: TriggerStatus;
  /** Lead flows only. */
  flow: FlowEditorInfo | null;
  /** This business's starter wording (its preset, else the neutral default), for "Use the default wording". */
  defaults: MessageInput[];
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
  const defaults = defaultMessagesFor(key, flowTenant()?.slug);
  // No message configured yet → offer the ready-made starter messages.
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
          matchInterest: m.matchInterest ?? null,
        }))
      : defaults.map((m) => ({ ...m }));
  const isFlow = LEAD_FLOW_KEY_SET.has(key);
  const finish = isFlow ? flowFinish(key, state) : null;
  const fd = flowDefaults(key);
  return {
    key,
    label: def.label,
    description: def.description,
    status: def.status,
    enabled: isTriggerEnabled(key, state),
    externalEnabled: state?.externalEnabled ?? false,
    messages: mapped,
    startColumn: isFlow ? (flowStartColumn(key, state) ?? "") : null,
    finishColumn: isFlow ? (finish?.column ?? "") : null,
    finishAfterValue: state?.finishAfterValue ?? fd.finishAfter?.value ?? 7,
    finishAfterUnit: (state?.finishAfterUnit as IntervalUnit | null | undefined) ?? fd.finishAfter?.unit ?? "days",
    flow: isFlow
      ? {
          columnStarted: isColumnStartedFlow(key),
          finishable: hasFinishStep(key),
          beforeCall: key === CALL_BOOKED_FLOW,
          columns: listStages().map((s) => ({ ref: columnRefFor(s), name: s.name })),
        }
      : null,
    defaults,
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
  // Coming-soon triggers can only ever be OFF — fireTrigger() already guards
  // on ACTIVE_TRIGGER_KEYS so this can't cause a real send either way, but
  // persisting `enabled: true` for one would still be a lie sitting in the
  // DB (Theme D1). Turning one off is always allowed.
  const persisted = enabled && ACTIVE_TRIGGER_KEYS.has(key);
  upsertTriggerState(key, { enabled: persisted });
}

/** A column reference to store: "" = none, a valid ref, else null (the default). */
function storedRef(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "") return "";
  return isColumnRef(t) ? t : null;
}

/** The flow columns of automation_triggers for a save (empty for a trigger that is not a lead flow). */
function flowColumns(input: TriggerInput) {
  if (!LEAD_FLOW_KEY_SET.has(input.key)) return {};
  const finishable = hasFinishStep(input.key);
  return {
    startColumn: isColumnStartedFlow(input.key) ? storedRef(input.startColumn) : null,
    finishColumn: finishable ? storedRef(input.finishColumn) : null,
    finishAfterValue: finishable && input.finishAfterValue != null ? Math.max(0, Math.min(1000, Math.round(input.finishAfterValue))) : null,
    finishAfterUnit: finishable && input.finishAfterUnit ? input.finishAfterUnit : null,
  };
}

export function saveTrigger(input: TriggerInput) {
  if (!VALID_KEYS.has(input.key)) return;
  const enabled = input.enabled && ACTIVE_TRIGGER_KEYS.has(input.key); // see setTriggerEnabled's comment
  db.transaction((tx) => {
    const existing = tx.select().from(automationTriggers).where(eq(automationTriggers.key, input.key)).get();
    if (existing) {
      tx.update(automationTriggers)
        .set({ enabled, externalEnabled: input.externalEnabled, ...flowColumns(input), updatedAt: new Date() })
        .where(eq(automationTriggers.key, input.key))
        .run();
    } else {
      tx.insert(automationTriggers)
        .values({ key: input.key, enabled, externalEnabled: input.externalEnabled, ...flowColumns(input) })
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
          matchInterest: m.matchInterest?.trim() || null,
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
 *
 * Only dispatches ACTIVE_TRIGGER_KEYS (automationModel.ts) — the other 7
 * catalog entries are "coming_soon": configurable in the UI, but nothing
 * calls fireTrigger() for them, and even if something did, this guard stops
 * it from silently doing anything (improvement-plan-2026-08.md Theme D1).
 */
export async function fireTrigger(triggerKey: string, clientId: number): Promise<void> {
  try {
    if (!VALID_KEYS.has(triggerKey)) return;
    if (!ACTIVE_TRIGGER_KEYS.has(triggerKey)) return;
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

    const emailMessages = messages.filter((m) => isMessageLive(m) && m.template.trim());
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
