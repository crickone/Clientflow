// Run: npm test -- src/lib/leadFlows/presets.test.ts
//
// The agreed Optimal Health copy: there for that business only, no phone
// number typed in, no emojis, no free consultation or money-back promise,
// and the long-term nurture weeks and treatment versions as agreed.
import assert from "node:assert/strict";

import { DEFAULT_MESSAGES, delayToMs } from "../automationModel";
import { defaultMessagesFor, FLOW_PRESETS } from "./presets";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const oh = FLOW_PRESETS["optimal-health"];
ok(!!oh, "Optimal Health has a preset");
const flows = ["new_lead", "lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking", "lead_nurture"];
for (const f of flows) ok((oh[f] ?? []).length > 0, `${f} has Optimal Health copy`);

const all = Object.values(oh).flat();
for (const m of all) {
  const text = `${m.subject ?? ""} ${m.template}`;
  ok(!/\p{Extended_Pictographic}/u.test(text), "no emojis");
  ok(!/\d{3}\s?\d{3}\s?\d{4}/.test(text), "no phone number typed in");
  ok(!/free consult|money.back|guarantee/i.test(text), "no free consultation or guarantee");
}
ok(all.filter((m) => /ring|call us/i.test(m.template) && /\[BUSINESS_PHONE\]/.test(m.template)).length >= 5, "the phone comes from the business profile");

// New lead: WhatsApp and email at once, then four WhatsApps at 2, 4, 5, 7 days.
const nl = oh.new_lead;
assert.deepEqual(nl.map((m) => [m.channel, delayToMs(m.delayValue, m.delayUnit) / 86_400_000]), [
  ["whatsapp", 0],
  ["email", 0],
  ["whatsapp", 2],
  ["whatsapp", 4],
  ["whatsapp", 5],
  ["whatsapp", 7],
]);
n++;
ok(nl[0].template.startsWith("Hi [FIRST_NAME], thanks for getting in touch with Optimal Health."), "the first WhatsApp as agreed");

// Call booked: at booking, then 1 hour (before the call).
assert.deepEqual(oh.lead_call_booked.map((m) => delayToMs(m.delayValue, m.delayUnit)), [0, 3_600_000]);
n++;
ok(/\[CALL_DAY\] at \[CALL_TIME\]/.test(oh.lead_call_booked[0].template), "the confirmation names the day and time");

// Long-term nurture: weeks 1, 2, 3, 6, 8, 10, 12; five versions of weeks 2 and 3.
const nurture = oh.lead_nurture;
const days = [...new Set(nurture.map((m) => delayToMs(m.delayValue, m.delayUnit) / 86_400_000))];
assert.deepEqual(days, [0, 7, 14, 35, 49, 63, 77]);
n++;
const week2 = nurture.filter((m) => delayToMs(m.delayValue, m.delayUnit) === 7 * 86_400_000);
const week3 = nurture.filter((m) => delayToMs(m.delayValue, m.delayUnit) === 14 * 86_400_000);
ok(week2.length === 5 && week2.every((m) => m.channel === "email") && week2.some((m) => m.matchInterest === "other"), "week 2: five email versions including the general one");
ok(week3.length === 5 && week3.every((m) => m.channel === "whatsapp") && week3.some((m) => m.matchInterest === "other"), "week 3: five WhatsApp versions");
ok(nurture.filter((m) => !m.matchInterest).length === 5, "weeks 1, 6, 8, 10 and 12 go to everyone");

// Other businesses get the neutral defaults.
assert.deepEqual(defaultMessagesFor("new_lead", "some-gym"), DEFAULT_MESSAGES.new_lead);
n++;
assert.deepEqual(defaultMessagesFor("lead_nurture", null), DEFAULT_MESSAGES.lead_nurture);
n++;
ok(defaultMessagesFor("lead_nurture", "optimal-health") !== oh.lead_nurture, "a copy, never the preset itself");
ok(defaultMessagesFor("client_birthday", "optimal-health").length === DEFAULT_MESSAGES.client_birthday.length, "no preset for a trigger falls back to the default");

console.log(`presets: ${n} checks passed.`);
