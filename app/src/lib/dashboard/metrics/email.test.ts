// Run: npm test -- src/lib/dashboard/metrics/email.test.ts
import assert from "node:assert/strict";
import { campaignRates, countsFromStats, linkGroup, linkLabel, netDeltaPct, sumCounts } from "./email";

const c = { queued: 0, sent: 5, delivered: 60, opened: 20, clicked: 10, unsubscribed: 5, complained: 5, bounced: 20, failed: 3 };
// reached = 60+20+10+5+5 = 100; opens = 30; bounced 20 -> denominator 120
const r = campaignRates(c);
assert.equal(r.reached, 100);
assert.equal(r.openRate, 30);
assert.equal(r.clickRate, 10);
assert.equal(r.deliveredRate, 83.3, "reached / (reached + bounced)");
assert.equal(r.bounceRate, 16.7);
assert.equal(r.complaintRate, 4.2);
assert.equal(r.unsubscribeRate, 5);
assert.equal(campaignRates({}).openRate, null, "nothing reached");
assert.equal(campaignRates({}).bounceRate, null);
assert.equal(campaignRates({ bounced: 2 }).bounceRate, 100);

assert.deepEqual(sumCounts([{ delivered: 2, opened: 1 }, { delivered: 3, bounced: 1 }]), { delivered: 5, opened: 1, bounced: 1 });
assert.equal(campaignRates(sumCounts([{ delivered: 9, opened: 1 }, { delivered: 90, opened: 0 }])).openRate, 1, "recipient-weighted");

assert.deepEqual(countsFromStats(null), {});
assert.deepEqual(countsFromStats({ counts: { sent: 3, junk: "x", opened: 2 } }), { sent: 3, opened: 2 });
assert.deepEqual(countsFromStats({ other: 1 }), {});

assert.equal(linkGroup("https://example.com/book?utm=1#x"), "https://example.com/book");
assert.equal(linkGroup("not a url?x=1"), "not a url");
assert.equal(linkLabel("https://www.example.com/book/now"), "example.com/book/now");
assert.equal(linkLabel("https://example.com/" + "a".repeat(80)).length, 48);
assert.ok(linkLabel("https://example.com/" + "a".repeat(80)).endsWith("..."));

assert.equal(netDeltaPct(10, 5), 100);
assert.equal(netDeltaPct(-2, -4), 50, "improvement on a negative base is positive");
assert.equal(netDeltaPct(3, 0), null);

console.log("email.test.ts: ok");
