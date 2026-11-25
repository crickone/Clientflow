import "server-only";

import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { TRIGGER_LABELS, delayToMs, isMessageLive, type Channel, type IntervalUnit } from "@/lib/automationModel";
import type { FollowUpKey } from "@/lib/pipeline/followUpColumns";
import type { StageRole } from "@/lib/pipeline/roles";

import { columnMatches, flowDefaults, isTriggerEnabled, LEAD_FLOW_KEYS, type ColumnRef } from "./flowModel";
import { defaultMessagesFor } from "./presets";
import { flowTenant } from "./tenant";

/** One message of a flow, ready to schedule. */
export interface FlowMessage {
  channel: Channel;
  subject: string | null;
  template: string;
  /** Offset from the start of the flow, as the editor shows it. */
  delayMs: number;
  matchInterest: string | null;
}

/** What a flow does in this business right now: saved settings, else the defaults. */
export interface FlowDefinition {
  key: string;
  label: string;
  enabled: boolean;
  /** In position order; only live channels and non-empty templates. */
  messages: FlowMessage[];
  startColumn: ColumnRef | null;
  finish: { column: ColumnRef; afterMs: number } | null;
}

type TriggerRow = typeof schema.automationTriggers.$inferSelect;

/** null = use the default; "" = none. */
function columnSetting(saved: string | null | undefined, fallback: ColumnRef | null): ColumnRef | null {
  if (saved == null) return fallback;
  return saved.trim() || null;
}

export function flowStartColumn(key: string, state: TriggerRow | undefined): ColumnRef | null {
  return columnSetting(state?.startColumn, flowDefaults(key).startColumn);
}

export function flowFinish(key: string, state: TriggerRow | undefined): { column: ColumnRef; afterMs: number } | null {
  const d = flowDefaults(key);
  const column = columnSetting(state?.finishColumn, d.finishColumn);
  if (!column) return null;
  const afterMs =
    state?.finishAfterValue != null
      ? delayToMs(state.finishAfterValue, (state.finishAfterUnit ?? "days") as IntervalUnit)
      : d.finishAfter
        ? delayToMs(d.finishAfter.value, d.finishAfter.unit)
        : 0;
  return { column, afterMs };
}

/** A flow's effective definition for the ambient tenant. */
export function getFlowDefinition(key: string): FlowDefinition {
  const state = db.select().from(schema.automationTriggers).where(eq(schema.automationTriggers.key, key)).get();
  const saved = db
    .select()
    .from(schema.automationMessages)
    .where(eq(schema.automationMessages.triggerKey, key))
    .orderBy(asc(schema.automationMessages.position))
    .all();
  const source =
    saved.length > 0
      ? saved.map((m) => ({
          channel: m.channel as Channel,
          subject: m.subject,
          template: m.template ?? "",
          delayValue: m.delayValue,
          delayUnit: m.delayUnit as IntervalUnit,
          matchInterest: m.matchInterest ?? null,
        }))
      : defaultMessagesFor(key, flowTenant()?.slug).map((m) => ({ ...m, matchInterest: m.matchInterest ?? null }));
  const messages = source
    .filter((m) => isMessageLive(m, key) && m.template.trim())
    .map((m) => ({
      channel: m.channel,
      subject: m.subject,
      template: m.template,
      delayMs: delayToMs(m.delayValue, m.delayUnit),
      matchInterest: m.matchInterest?.trim() || null,
    }));
  return {
    key,
    label: TRIGGER_LABELS[key] ?? key,
    enabled: isTriggerEnabled(key, state),
    messages,
    startColumn: flowStartColumn(key, state),
    finish: flowFinish(key, state),
  };
}

/** The switched-on flow a lead entering this column starts, if any (catalog order; the first match wins). */
export function flowForStage(stage: { id: number; role: StageRole | null; systemKey?: FollowUpKey | null }): string | null {
  const states = new Map(db.select().from(schema.automationTriggers).all().map((s) => [s.key, s]));
  for (const key of LEAD_FLOW_KEYS) {
    const state = states.get(key);
    if (!isTriggerEnabled(key, state)) continue;
    const ref = flowStartColumn(key, state);
    if (ref && columnMatches(ref, stage)) return key;
  }
  return null;
}
