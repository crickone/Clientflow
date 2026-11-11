/**
 * Unit tests for the automations trigger catalog — the single source of
 * truth for which triggers actually fire (improvement-plan-2026-08.md Theme
 * D1). Pure, no I/O/DB. Run: npx tsx src/lib/automationModel.test.ts
 */
import assert from "node:assert/strict";

import {
  ACTIVE_TRIGGER_KEYS,
  blankMessage,
  inSendingHours,
  isMessageLive,
  liveChannelsFor,
  STOP_ON_BOOKED,
  STOP_ON_REPLY,
  LIVE_CHANNEL,
  LIVE_DELAY_VALUE,
  TRIGGER_CATALOG,
} from "./automationModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed++;
}

// The triggers verified to actually be dispatched today: fireTrigger()'s real
// call sites (clients/actions.ts, clients/appAccessActions.ts, the check-in
// submit in app/app/actions.ts, campaign sign-ups) and the birthday job
// (automations/scheduler.ts). Every other catalog entry is configurable
// in the UI but nothing ever calls fireTrigger() for it.
// Plus the lead follow-up sequences (new_lead, lead_booked, lead_no_show), started
// from upsertLead and the pipeline stage writer (lib/automations/nurture.ts).
const EXPECTED_ACTIVE = ["new_client_created", "client_check_in", "nutrition_plan_added", "workout_plan_added", "client_birthday", "campaign_signup", "new_lead", "lead_booked", "lead_no_show"];

check("TRIGGER_CATALOG has exactly 16 entries (the fixed Kahunas trigger list, the campaign sign-up sequence and the three lead sequences)", TRIGGER_CATALOG.length === 16);

check(
  "ACTIVE_TRIGGER_KEYS is exactly the 9 verified-active triggers, no more, no fewer",
  ACTIVE_TRIGGER_KEYS.size === EXPECTED_ACTIVE.length && EXPECTED_ACTIVE.every((k) => ACTIVE_TRIGGER_KEYS.has(k)),
);

// Single-source consistency: ACTIVE_TRIGGER_KEYS is DERIVED from each catalog
// entry's own `status` field, so cross-check they never disagree — this is
// what "single source of truth" (the brief's explicit D1 requirement) means
// in practice, not just that the derived Set happens to have the right size.
for (const t of TRIGGER_CATALOG) {
  check(
    `${t.key}: ACTIVE_TRIGGER_KEYS membership matches its own status field ("${t.status}")`,
    ACTIVE_TRIGGER_KEYS.has(t.key) === (t.status === "active"),
  );
}

const comingSoonKeys = TRIGGER_CATALOG.filter((t) => t.status === "coming_soon").map((t) => t.key);
check(
  "the other 7 catalog entries are status: coming_soon",
  comingSoonKeys.length === 7 &&
    ["initial_qa_form", "supplement_plan_added", "workout_plan_updated", "nutrition_plan_updated", "client_missed_check_in", "client_check_in_reminder", "supplement_plan_updated"].every(
      (k) => comingSoonKeys.includes(k),
    ),
);

// isMessageLive — the same predicate fireTrigger() (automations.ts) and the
// birthday job (automations/scheduler.ts) dispatch through; the message
// editor's channel/delay restriction reads LIVE_CHANNEL/LIVE_DELAY_VALUE too,
// so this pins the one definition all three sides agree on.
check("isMessageLive: email + immediate is live", isMessageLive({ channel: "email", delayValue: 0 }));
check("isMessageLive: email + delayed is NOT live", !isMessageLive({ channel: "email", delayValue: 5 }));
check("isMessageLive: push + immediate is NOT live", !isMessageLive({ channel: "push", delayValue: 0 }));
check("isMessageLive: chat + immediate is NOT live", !isMessageLive({ channel: "chat", delayValue: 0 }));
check("LIVE_CHANNEL is email", LIVE_CHANNEL === "email");
check("LIVE_DELAY_VALUE is 0", LIVE_DELAY_VALUE === 0);

// blankMessage() — a freshly-added message card should start in a state that
// actually sends, not one fireTrigger() silently drops.
const fresh = blankMessage();
check("blankMessage() defaults to the live channel", fresh.channel === LIVE_CHANNEL);
check("blankMessage() defaults to the live delay", fresh.delayValue === LIVE_DELAY_VALUE);
check("blankMessage() starts live end-to-end (via isMessageLive)", isMessageLive(fresh));

// Lead follow-up sequences (replacing GoHighLevel workflows): WhatsApp is a
// live channel for them, and only for them; an immediate client trigger
// still sends email only.
check("lead sequences send WhatsApp and email", liveChannelsFor("new_lead").join() === "email,whatsapp");
check("a delayed WhatsApp lead message is live", isMessageLive({ channel: "whatsapp", delayValue: 2 }, "lead_no_show"));
check("a client trigger never sends WhatsApp", !isMessageLive({ channel: "whatsapp", delayValue: 0 }, "new_client_created"));
check("replying stops the nudges but not the booking messages", STOP_ON_REPLY.includes("new_lead") && !STOP_ON_REPLY.includes("lead_booked"));
check("booking stops the new-lead nudges", STOP_ON_BOOKED.includes("new_lead") && STOP_ON_BOOKED.includes("campaign_signup"));

// Sending hours: WhatsApp 9:00-21:00 Irish time; email any time.
const dublin = (iso: string) => new Date(iso).getTime(); // November: Dublin = UTC
check("WhatsApp at 14:00 goes at 14:00", inSendingHours(dublin("2026-11-11T14:00:00Z"), "whatsapp") === dublin("2026-11-11T14:00:00Z"));
check("WhatsApp at 02:30 waits until 09:00", inSendingHours(dublin("2026-11-11T02:30:00Z"), "whatsapp") === dublin("2026-11-11T09:00:00Z"));
check("WhatsApp at 22:15 waits until 09:00 next day", inSendingHours(dublin("2026-11-11T22:15:00Z"), "whatsapp") === dublin("2026-11-12T09:00:00Z"));
check("WhatsApp in summer time respects Irish hours", inSendingHours(dublin("2026-07-01T07:30:00Z"), "whatsapp") === dublin("2026-07-01T08:00:00Z"));
check("email at 02:30 goes at 02:30", inSendingHours(dublin("2026-11-11T02:30:00Z"), "email") === dublin("2026-11-11T02:30:00Z"));

console.log(`automationModel: ${passed} checks passed.`);
