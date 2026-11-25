/**
 * Which steps of a flow an imported person still gets, and when. Pure.
 *
 * A person who was N days into a GoHighLevel stage carries on from there:
 * steps at most N days into the flow were sent by GoHighLevel and are left
 * out. Of the rest, a step whose time (inside sending hours) has passed is
 * skipped, never sent late, and only the first step on the import day is
 * kept, so nobody gets a burst. A flow whose finish move time has passed has
 * ended: the caller moves the person on as the flow's finish says.
 */
import { cascadeDueTimes, finishDueAt } from "@/lib/leadFlows/flowPlan";

export const DAY_MS = 86_400_000;

export interface PlacementMessage {
  channel: string;
  /** Offset from the start of the flow. */
  delayMs: number;
}

export interface PlacedStep {
  /** Index into the person's picked message list (lib/leadFlows/flowPlan pickForInterest). */
  step: number;
  channel: string;
  dueAt: number;
}

export type SkipReason = "done in GoHighLevel" | "past" | "one a day on the import day" | "no address";

export interface StepPlan {
  steps: PlacedStep[];
  skipped: { step: number; reason: SkipReason }[];
  /** When the finish move happens; null when the flow has no finish or has ended. */
  finishAt: number | null;
  /** Nothing of the flow is left: no message to send and no finish still to come. */
  ended: boolean;
}

export function planSteps(input: {
  /** The person's messages in order (already picked for their interest). */
  messages: PlacementMessage[];
  /** When the flow started for them: the day they entered the stage, or now for a fresh start. */
  startAt: number;
  /** Steps with an offset at most this were done in GoHighLevel; null = none were. */
  doneThroughMs: number | null;
  now: number;
  /** The flow's finish move, counted from its start; null = it has none. */
  finishAfterMs: number | null;
  /** Sending hours: the first allowed moment at or after `at` on that channel. */
  fit: (at: number, channel: string) => number;
  /** The local date of an instant ("YYYY-MM-DD"). */
  dayOf: (at: number) => string;
  /** Whether the person has an address on this channel. */
  canReceive: (channel: string) => boolean;
}): StepPlan {
  const { messages, now } = input;
  const skipped: StepPlan["skipped"] = [];
  const kept: number[] = [];
  messages.forEach((m, i) => {
    if (input.doneThroughMs != null && m.delayMs <= input.doneThroughMs) skipped.push({ step: i, reason: "done in GoHighLevel" });
    else kept.push(i);
  });
  const delays = kept.map((i) => messages[i].delayMs);
  const dues = cascadeDueTimes(input.startAt, delays, (at, j) => input.fit(at, messages[kept[j]].channel));

  const today = input.dayOf(now);
  let usedToday = false;
  const steps: PlacedStep[] = [];
  kept.forEach((i, j) => {
    const dueAt = dues[j];
    const channel = messages[i].channel;
    if (!input.canReceive(channel)) return void skipped.push({ step: i, reason: "no address" });
    if (dueAt < now) return void skipped.push({ step: i, reason: "past" });
    if (input.dayOf(dueAt) === today) {
      if (usedToday) return void skipped.push({ step: i, reason: "one a day on the import day" });
      usedToday = true;
    }
    steps.push({ step: i, channel, dueAt });
  });
  skipped.sort((a, b) => a.step - b.step);

  if (input.finishAfterMs == null) return { steps, skipped, finishAt: null, ended: steps.length === 0 };
  // The flow's own end, from its schedule (not from which steps this person gets).
  const finishAt = finishDueAt(input.startAt, dues, delays, input.finishAfterMs);
  if (finishAt <= now) {
    for (const s of steps) skipped.push({ step: s.step, reason: "past" });
    skipped.sort((a, b) => a.step - b.step);
    return { steps: [], skipped, finishAt: null, ended: true };
  }
  return { steps, skipped, finishAt, ended: false };
}
