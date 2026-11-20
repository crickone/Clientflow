// Run: npm test -- src/lib/stripe/hostedOnboarding.test.ts
//
// Hosted onboarding: the account Adonis makes for a business behaves like a
// Standard account, and an account from the other mode (test vs live) or one
// Stripe hasn't switched charges on for never shows Buy buttons.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

const { accountCreateParams, keyMode, STANDARD_CONTROLLER } = requireLocal("./api") as typeof import("./api");
const { formEncode } = requireLocal("./encode") as typeof import("./encode");
const { canTakePayments, usableInMode } = requireLocal("./connection") as typeof import("./connection");

// Standard-style account: own full dashboard, Stripe carries losses, the business pays its own fees.
assert.deepEqual(STANDARD_CONTROLLER, { stripe_dashboard: { type: "full" }, losses: { payments: "stripe" }, fees: { payer: "account" }, requirement_collection: "stripe" });
const body = formEncode(accountCreateParams({ email: "owner@gym.ie", businessName: "Optimal Health", tenantId: 1028 }));
for (const part of [
  "controller%5Bstripe_dashboard%5D%5Btype%5D=full",
  "controller%5Blosses%5D%5Bpayments%5D=stripe",
  "controller%5Bfees%5D%5Bpayer%5D=account",
  "controller%5Brequirement_collection%5D=stripe",
  "email=owner%40gym.ie",
  "business_profile%5Bname%5D=Optimal%20Health",
  "metadata%5Btenant_id%5D=1028",
]) assert.ok(body.includes(part), `missing ${part} in ${body}`);
// No email or name: left out, not sent empty.
const bare = formEncode(accountCreateParams({ email: null, businessName: null, tenantId: 7 }));
assert.ok(!bare.includes("email=") && !bare.includes("business_profile"), bare);

// Key mode.
assert.equal(keyMode("sk_live_abc"), "live");
assert.equal(keyMode("rk_live_abc"), "live");
assert.equal(keyMode("sk_test_abc"), "test");
assert.equal(keyMode(undefined), null);

// A test account is unusable on the live key, and the reverse.
assert.equal(usableInMode(false, "live"), false);
assert.equal(usableInMode(true, "test"), false);
assert.equal(usableInMode(true, "live"), true);
assert.equal(usableInMode(false, "test"), true);
assert.equal(usableInMode(true, null), true);

// Buy buttons: a live account only once Stripe switched charges on.
assert.equal(canTakePayments(null), false);
assert.equal(canTakePayments({ livemode: true, chargesEnabled: false }), false);
assert.equal(canTakePayments({ livemode: true, chargesEnabled: true }), true);
assert.equal(canTakePayments({ livemode: false, chargesEnabled: false }), true);

console.log("stripe/hostedOnboarding: ok");
