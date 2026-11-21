// Run: cd app && npx tsx src/lib/platform/queueReason.test.ts
import assert from "node:assert/strict";

import { queueReason } from "./queueReason";

assert.equal(queueReason(null), null);
assert.equal(queueReason("   "), null);
assert.equal(queueReason("  WhatsApp\n  not connected "), "WhatsApp not connected");
const long = "word ".repeat(50);
assert.equal(queueReason(long)!.length, 120);
assert.ok(queueReason(long)!.endsWith("..."));
// Personal data and secrets never reach an alert.
assert.equal(queueReason("'to' is not a valid address: Marina.H@gmail.com"), "'to' is not a valid address: [email]");
assert.equal(queueReason("WhatsApp send failed (400): invalid phone +353 89 401 8010"), "WhatsApp send failed (400): invalid phone [number]");
assert.equal(queueReason("GET https://graph.facebook.com/v19.0/me?access_token=EAAB123&x=1 failed"), "GET https://graph.facebook.com/v19.0/me failed");
assert.equal(queueReason("Invalid OAuth token EAAGm0PX4ZCpsBAKZCZBz9qVZCZA1 for page"), "Invalid OAuth token [token] for page");
// Ordinary error text and small numbers stay readable.
assert.equal(queueReason("Mailgun 401: Forbidden"), "Mailgun 401: Forbidden");
// Redact before truncating: a token at the cut is never half-shown.
const cut = queueReason("x ".repeat(55) + "EAAGm0PX4ZCpsBAKZCZBz9qVZCZA1EAAGm0PX4ZCpsBAKZCZBz9qVZCZA1")!;
assert.ok(!/EAAG/.test(cut), cut);
console.log("queueReason: ok");
