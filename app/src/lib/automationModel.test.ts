/**
 * Unit tests for the automations trigger catalog — the single source of
 * truth for which triggers actually fire (improvement-plan-2026-08.md Theme
 * D1). Pure, no I/O/DB. Run: npx tsx src/lib/automationModel.test.ts
 */
import assert from "node:assert/strict";

import {
  ACTIVE_TRIGGER_KEYS,
  blankMessage,
  isMessageLive,
  LIVE_CHANNEL,
  LIVE_DELAY_VALUE,
  TRIGGER_CATALOG,
} from "./automationModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed++;
}

// The 4 triggers verified (improvement-plan-2026-08.md Theme D1) to actually
// be dispatched today: 3 via fireTrigger()'s real call sites
// (clients/actions.ts, clients/appAccessActions.ts) and 1 via the birthday
// job (automations/scheduler.ts). Every other catalog entry is configurable
// in the UI but nothing ever calls fireTrigger() for it.
const EXPECTED_ACTIVE = ["new_client_created", "nutrition_plan_added", "workout_plan_added", "client_birthday"];

check("TRIGGER_CATALOG has exactly 12 entries (the fixed Kahunas trigger list)", TRIGGER_CATALOG.length === 12);

check(
  "ACTIVE_TRIGGER_KEYS is exactly the 4 verified-active triggers, no more, no fewer",
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
  "the other 8 catalog entries are status: coming_soon",
  comingSoonKeys.length === 8 &&
    ["client_check_in", "initial_qa_form", "supplement_plan_added", "workout_plan_updated", "nutrition_plan_updated", "client_missed_check_in", "client_check_in_reminder", "supplement_plan_updated"].every(
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

console.log(`automationModel: ${passed} checks passed.`);
