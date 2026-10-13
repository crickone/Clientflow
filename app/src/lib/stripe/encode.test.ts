// Run: npm test -- src/lib/stripe/encode.test.ts
//
// Stripe's bracketed form encoding, and the webhook signature check that
// stands between the open /api/stripe/webhook route and anyone who can POST.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { formEncode, verifyStripeSignature } from "./encode";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const enc = formEncode({
  mode: "payment",
  line_items: [{ price_data: { currency: "eur", unit_amount: 4900, product_data: { name: "2 HBOT & 2 infrared" } }, quantity: 1 }],
  phone_number_collection: { enabled: true },
  customer_email: undefined,
  metadata: { order_id: 12 },
});
check("nested arrays and objects use brackets", enc.includes("line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=4900"));
check("values are encoded", enc.includes("2%20HBOT%20%26%202%20infrared"));
check("booleans become true", enc.includes("phone_number_collection%5Benabled%5D=true"));
check("undefined is left out", !enc.includes("customer_email"));

const secret = "whsec_test_secret";
const body = '{"id":"evt_1","type":"checkout.session.completed"}';
const t = 1_800_000_000;
const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
check("a good signature passes", verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 10));
check("any of several v1 signatures passes", verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)},v1=${sig}`, secret, t));
check("a changed body fails", !verifyStripeSignature(body.replace("evt_1", "evt_2"), `t=${t},v1=${sig}`, secret, t));
check("the wrong secret fails", !verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_other", t));
check("an old timestamp fails", !verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 301));
check("a missing header fails", !verifyStripeSignature(body, null, secret, t));
check("no secret configured fails", !verifyStripeSignature(body, `t=${t},v1=${sig}`, "", t));
check("garbage fails", !verifyStripeSignature(body, "nonsense", secret, t));

console.log(`stripe/encode: ${passed} checks passed`);
