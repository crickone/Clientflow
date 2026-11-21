// Run: npm test -- src/lib/settingsCards.test.ts
import assert from "node:assert/strict";

import { SETTINGS_CARDS, displayValue, mergeForSave, parseCard, type PlatformSettings } from "./settingsCards";

const saved: PlatformSettings = {
  monthlyPriceCents: 24900, vatRateBp: 2300, emailCreditPricePer1000Cents: 150, emailIncludedPerMonth: 5000,
  aiCreditMarginBp: 3000, voicePricePerMinuteCents: 45, voiceIncludedMinutes: 60, voiceTrialMinutes: 10, provider: "dev",
};

// Every saved number belongs to exactly one card, so none is lost.
const keys = SETTINGS_CARDS.flatMap((c) => c.fields.map((f) => f.key)).sort();
assert.deepEqual(keys, Object.keys(saved).filter((k) => k !== "provider").sort());

// Plan card: only its two fields come out.
const plan = parseCard("plan", { monthlyPrice: "199.50", vatRate: "23" });
assert.deepEqual(plan, { ok: true, patch: { monthlyPriceCents: 19950, vatRateBp: 2300 } });

// Other cards' values in the form data are ignored; missing ones are an error, never zero.
const voice = parseCard("voice", { voicePrice: "0.50", voiceIncluded: "100", voiceTrial: "5", monthlyPrice: "1" });
assert.deepEqual(voice, { ok: true, patch: { voicePricePerMinuteCents: 50, voiceIncludedMinutes: 100, voiceTrialMinutes: 5 } });
assert.equal(parseCard("ai", {}).ok, false);
assert.equal(parseCard("ai", { aiMargin: "" }).ok, false);

// Saving one card leaves every other value as loaded.
const body = mergeForSave(saved, (parseCard("ai", { aiMargin: "35" }) as { patch: object }).patch);
assert.deepEqual(body, {
  monthlyPriceCents: 24900, vatRateBp: 2300, emailCreditPricePer1000Cents: 150, emailIncludedPerMonth: 5000,
  aiCreditMarginBp: 3500, voicePricePerMinuteCents: 45, voiceIncludedMinutes: 60, voiceTrialMinutes: 10,
});

// Validation.
assert.equal(parseCard("plan", { monthlyPrice: "-1", vatRate: "23" }).ok, false);
assert.equal(parseCard("plan", { monthlyPrice: "10", vatRate: "101" }).ok, false);
assert.equal(parseCard("email", { emailIncluded: "1.5", emailPrice: "1" }).ok, false);
assert.equal(parseCard("voice", { voicePrice: "21", voiceIncluded: "1", voiceTrial: "1" }).ok, false);
assert.equal(parseCard("plan", { monthlyPrice: "abc", vatRate: "1" }).ok, false);

// Display.
const emailFields = SETTINGS_CARDS.find((c) => c.id === "email")!.fields;
assert.equal(displayValue(emailFields[0], saved), "5000");
assert.equal(displayValue(emailFields[1], saved), "1.50");

console.log("settingsCards ok");
