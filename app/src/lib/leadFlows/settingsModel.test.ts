// Run: npm test -- src/lib/leadFlows/settingsModel.test.ts
//
// The lead follow-up settings: what an unreadable stored value falls back
// to, and what a save refuses, in plain words.
import assert from "node:assert/strict";

import { DEFAULT_LEAD_FLOW_SETTINGS, parseLeadFlowSettings, validateLeadFlowSettings } from "./settingsModel";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

// Reading what is stored.
assert.deepEqual(parseLeadFlowSettings(null), DEFAULT_LEAD_FLOW_SETTINGS);
n++;
ok(parseLeadFlowSettings("nonsense").window === null, "garbage reads as no hours set");
const read = parseLeadFlowSettings({ window: { days: [6, 1, 1, 9], start: "09:00", end: "18:00" }, defaultAssigneeUserId: 7, alertWhatsAppTo: " +353870000000 ", alertUserId: null });
assert.deepEqual(read.window, { days: [1, 6], start: "09:00", end: "18:00" }, "days are de-duplicated, sorted, out-of-range dropped");
n++;
ok(read.defaultAssigneeUserId === 7, "assignee kept");
ok(read.alertWhatsAppTo === "+353870000000", "alert number trimmed");
ok(parseLeadFlowSettings({ window: { days: [1], start: "18:00", end: "09:00" } }).window === null, "an end before the start reads as no hours set");
ok(parseLeadFlowSettings({ defaultAssigneeUserId: -3 }).defaultAssigneeUserId === null, "a bad assignee reads as nobody");

// Saving.
const good = validateLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: 3, alertWhatsAppTo: "087 000 0000", alertUserId: null });
ok(good.ok && good.value.window?.days.length === 6 && good.value.alertWhatsAppTo === "087 000 0000", "a full save is accepted");
ok(validateLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "", alertUserId: null }).ok, "nothing set is a valid save");
const blankAlert = validateLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "   ", alertUserId: null });
ok(blankAlert.ok && blankAlert.value.alertWhatsAppTo === null, "a blank alert number is stored as none");
const noDays = validateLeadFlowSettings({ window: { days: [], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null, alertUserId: null });
ok(!noDays.ok && noDays.error === "Pick at least one day.", "no days refused");
const badTime = validateLeadFlowSettings({ window: { days: [1], start: "9am", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null, alertUserId: null });
ok(!badTime.ok && badTime.error === "Use a time like 09:00.", "a bad time refused");
const backwards = validateLeadFlowSettings({ window: { days: [1], start: "18:00", end: "09:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null, alertUserId: null });
ok(!backwards.ok && backwards.error === "The end time must be after the start time.", "end before start refused");
const shortPhone = validateLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "0870", alertUserId: null });
ok(!shortPhone.ok && /area code/.test(shortPhone.error), "a too-short number refused");
const badUser = validateLeadFlowSettings({ window: null, defaultAssigneeUserId: 0, alertWhatsAppTo: null, alertUserId: null });
ok(!badUser.ok, "a non-positive assignee refused");

for (const bad of [null, undefined, "x", 5]) {
  const r = validateLeadFlowSettings(bad as never);
  ok(!r.ok && r.error === "Nothing to save.", `${String(bad)} is refused, not thrown`);
}

console.log(`settingsModel: ${n} checks passed.`);

// WhatsApp alerts go to a team member: their id travels with their mobile.
{
  const v = validateLeadFlowSettings;
  const base = { window: null, defaultAssigneeUserId: null };
  const ok = v({ ...base, alertWhatsAppTo: "087 000 0000", alertUserId: 7 });
  assert.ok(ok.ok && ok.value.alertUserId === 7 && ok.value.alertWhatsAppTo === "087 000 0000", "member and mobile saved together");
  const noPhone = v({ ...base, alertWhatsAppTo: null, alertUserId: 7 });
  assert.ok(!noPhone.ok && /mobile/.test(noPhone.error), "a member with no mobile is refused");
  const none = v({ ...base, alertWhatsAppTo: null, alertUserId: null });
  assert.ok(none.ok && none.value.alertUserId === null && none.value.alertWhatsAppTo === null, "no alerts");
}
