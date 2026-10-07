/**
 * Inbox display helpers: sender names, entity decoding, and the
 * people / notifications / promotions split.
 * Run: npx tsx src/lib/inbox/emailDisplay.test.ts
 */
import assert from "node:assert/strict";

import { brandFromDomain, classifyEmail, cleanSnippet, decodeEntities, displaySender, splitAddress } from "./emailDisplay";

// Entities
assert.equal(decodeEntities("there&#39;s still time"), "there's still time");
assert.equal(decodeEntities("tomorrow&#x27;s &amp; today&rsquo;s"), "tomorrow's & today’s");
assert.equal(decodeEntities("&bogus; stays"), "&bogus; stays");

// The header that broke the old parser.
assert.deepEqual(splitAddress('"noreply - legitfit < >" <noreply@purchased-services.legitfit.com>'), {
  name: "noreply - legitfit < >",
  email: "noreply@purchased-services.legitfit.com",
});
assert.deepEqual(splitAddress("plain@example.com"), { name: "", email: "plain@example.com" });

// A row stored before the fix: the whole header sits in the address field.
assert.deepEqual(
  displaySender(null, '"noreply - legitfit < >" <noreply@transactions.legitfit.com>'),
  { name: "Legitfit", email: "noreply@transactions.legitfit.com" },
);
// Name present but noisy.
assert.equal(displaySender("noreply - legitfit < >", "noreply@reminders.legitfit.com").name, "Legitfit");
// A real person is left alone.
assert.equal(displaySender("Bill O'Flynn", "bill@bofsports.ie").name, "Bill O'Flynn");
assert.equal(displaySender("Stephanie Williford, CEO, EB Medicine", "news@ebmedicine.net").name, "Stephanie Williford, CEO, EB Medicine");
// No name at all: the brand in the domain.
assert.equal(displaySender("", "hello@acme.co.uk").name, "Acme");
assert.equal(brandFromDomain("x@mg.inspirehealthandfitness.ie"), "Inspirehealthandfitness");

// A personal address says nothing about the brand: show the address.
assert.equal(displaySender("", "keegancormac16@gmail.com").name, "keegancormac16@gmail.com");
assert.equal(cleanSnippet("Hi\u034f \u200c\u00a0 there&#39;s   more"), "Hi there's more");

// Buckets
assert.equal(classifyEmail({ direction: "in", fromEmail: "noreply@legitfit.com", fromName: null, hasUnsubscribe: true }), "notifications");
assert.equal(classifyEmail({ direction: "in", fromEmail: "no-reply@x.com", fromName: null, hasUnsubscribe: false }), "notifications");
assert.equal(classifyEmail({ direction: "in", fromEmail: "news@ebmedicine.net", fromName: "Stephanie", hasUnsubscribe: true }), "promotions");
assert.equal(classifyEmail({ direction: "in", fromEmail: "dan@bofsports.ie", fromName: "Dan", hasUnsubscribe: false }), "people");
assert.equal(classifyEmail({ direction: "out", fromEmail: "noreply@x.com", fromName: null, hasUnsubscribe: true }), "people");

assert.equal(classifyEmail({ direction: "in", fromEmail: "failed-payments+acct_1s2c@stripe.com", fromName: "Post It Local", hasUnsubscribe: false }), "notifications");
assert.equal(classifyEmail({ direction: "in", fromEmail: "sarah.payne@gmail.com", fromName: "Sarah", hasUnsubscribe: false }), "people");

console.log("emailDisplay: all checks passed.");
