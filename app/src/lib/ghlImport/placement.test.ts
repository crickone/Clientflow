// Run: npm test -- src/lib/ghlImport/placement.test.ts
//
// Placing a person part-way through a flow: steps GoHighLevel already sent
// are left out, steps whose time has passed are skipped (no catch-up), one
// message at most on the import day, steps inside sending hours, and the
// flow's end. Boundaries at day 77, the last nurture step.
import assert from "node:assert/strict";

import { delayToMs } from "../automationModel";
import { pickForInterest } from "../leadFlows/flowPlan";
import { FLOW_PRESETS } from "../leadFlows/presets";
import { fitToWindow, todayIn } from "../leadFlows/sendingWindow";
import { DAY_MS, planSteps, type PlacementMessage } from "./placement";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const DAY = DAY_MS;
// Wednesday 16 January 2030, 10:00 Irish time (winter: Irish time = UTC).
const NOW = Date.parse("2030-01-16T10:00:00Z");
const EXPORT_MORNING = Date.parse("2030-01-16T09:00:00Z");
const anyTime = (at: number) => at;
const dayOf = (at: number) => todayIn(at);
const always = () => true;

// Optimal Health's Long-term nurture, the "everyone else" versions: weeks 1, 2, 3, 6, 8, 10, 12.
const nurture: PlacementMessage[] = pickForInterest(
  FLOW_PRESETS["optimal-health"].lead_nurture.map((m) => ({ channel: m.channel as string, delayMs: delayToMs(m.delayValue, m.delayUnit), matchInterest: m.matchInterest ?? null })),
  null,
).map((m) => ({ channel: m.channel, delayMs: m.delayMs }));
assert.deepEqual(nurture.map((m) => m.delayMs / DAY), [0, 7, 14, 35, 49, 63, 77]);
n++;

const resume = (daysInStage: number, extra: Partial<Parameters<typeof planSteps>[0]> = {}) =>
  planSteps({
    messages: nurture,
    startAt: EXPORT_MORNING - daysInStage * DAY,
    doneThroughMs: daysInStage * DAY,
    now: NOW,
    finishAfterMs: null,
    fit: anyTime,
    dayOf,
    canReceive: always,
    ...extra,
  });

// Day 30: weeks 6, 8, 10 and 12 are left, due 5, 19, 33 and 47 days after the export.
{
  const p = resume(30);
  assert.deepEqual(p.steps.map((s) => s.step), [3, 4, 5, 6]);
  n++;
  ok(p.steps[0].dueAt === EXPORT_MORNING + 5 * DAY, "week 6 lands 35 days after they entered");
  ok(p.skipped.filter((s) => s.reason === "done in GoHighLevel").length === 3, "weeks 1 to 3 were done in GoHighLevel");
  ok(!p.ended && p.finishAt === null, "nurture has no finish move");
}

// Day 76: only week 12 is left, tomorrow. Day 77: nothing is left.
{
  const p76 = resume(76);
  ok(p76.steps.length === 1 && p76.steps[0].step === 6 && p76.steps[0].dueAt === EXPORT_MORNING + DAY, "day 76: week 12 tomorrow");
  const p77 = resume(77);
  ok(p77.steps.length === 0 && p77.ended, "day 77: past the end");
  ok(resume(200).ended, "day 200: past the end");
}

// No catch-up: exported three days before the import, a step due in between is skipped.
{
  const exportedEarlier = EXPORT_MORNING - 3 * DAY;
  const p = planSteps({ messages: nurture, startAt: exportedEarlier - 33 * DAY, doneThroughMs: 33 * DAY, now: NOW, finishAfterMs: null, fit: anyTime, dayOf, canReceive: always });
  ok(p.skipped.some((s) => s.step === 3 && s.reason === "past"), "week 6 fell due between the export and the import: skipped");
  ok(p.steps[0].step === 4 && p.steps[0].dueAt > NOW, "the first message is the next future one");
}

// A fresh start: the first step is now, and only one message goes on the import day.
{
  const twoAtOnce: PlacementMessage[] = [
    { channel: "whatsapp", delayMs: 0 },
    { channel: "email", delayMs: 0 },
    { channel: "whatsapp", delayMs: 2 * DAY },
  ];
  const p = planSteps({ messages: twoAtOnce, startAt: NOW, doneThroughMs: null, now: NOW, finishAfterMs: null, fit: anyTime, dayOf, canReceive: always });
  ok(p.steps.length === 2 && p.steps[0].step === 0 && p.steps[0].dueAt === NOW, "the first message is due now");
  ok(p.skipped.some((s) => s.step === 1 && s.reason === "one a day on the import day"), "the second message the same day is skipped");
  ok(p.steps[1].step === 2, "later days still go");
}

// No address for a channel: that step is skipped, the rest go.
{
  const p = planSteps({
    messages: [{ channel: "whatsapp", delayMs: 0 }, { channel: "email", delayMs: DAY }],
    startAt: NOW,
    doneThroughMs: null,
    now: NOW,
    finishAfterMs: null,
    fit: anyTime,
    dayOf,
    canReceive: (ch) => ch === "email",
  });
  ok(p.steps.length === 1 && p.steps[0].channel === "email" && p.skipped[0].reason === "no address", "no phone: the WhatsApp is skipped");
}

// A flow with a finish move: No answer (WhatsApps at 0 and 2 days, move after 4).
{
  const noAnswer: PlacementMessage[] = [{ channel: "whatsapp", delayMs: 0 }, { channel: "whatsapp", delayMs: 2 * DAY }];
  const at = (days: number) =>
    planSteps({ messages: noAnswer, startAt: EXPORT_MORNING - days * DAY, doneThroughMs: days * DAY, now: NOW, finishAfterMs: 4 * DAY, fit: anyTime, dayOf, canReceive: always });
  const d1 = at(1);
  ok(d1.steps.length === 1 && d1.steps[0].dueAt === EXPORT_MORNING + DAY && d1.finishAt === EXPORT_MORNING + 3 * DAY, "day 1: one WhatsApp left, then the move");
  const d3 = at(3);
  ok(d3.steps.length === 0 && d3.finishAt === EXPORT_MORNING + DAY && !d3.ended, "day 3: no message left, the move tomorrow");
  const d5 = at(5);
  ok(d5.ended && d5.finishAt === null && d5.steps.length === 0, "day 5: the flow has ended");
}

// Sending hours: Monday to Saturday 09:00-18:00. A step due on a Sunday goes on Monday morning.
{
  const OH = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };
  const sunday0900 = Date.parse("2030-01-20T09:00:00Z");
  const p = planSteps({
    messages: [{ channel: "whatsapp", delayMs: 14 * DAY }],
    startAt: sunday0900 - 14 * DAY,
    doneThroughMs: 10 * DAY,
    now: NOW,
    finishAfterMs: null,
    fit: (at, ch) => fitToWindow(at, ch, OH),
    dayOf,
    canReceive: always,
  });
  ok(p.steps[0].dueAt === Date.parse("2030-01-21T09:00:00Z"), "Sunday becomes Monday 09:00");
}

console.log(`ghlImport placement: ${n} checks passed.`);
