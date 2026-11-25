// Run: npm test -- src/lib/packageBalanceModel.test.ts
import assert from "node:assert/strict";
import { packageRefusal, sessionsLeft, usableOn } from "./packageBalanceModel";

assert.equal(sessionsLeft({ totalSessions: 2, sessionsUsed: 0 }, 0), 2);
assert.equal(sessionsLeft({ totalSessions: 2, sessionsUsed: 0 }, 2), 0, "two booked, none left to book");
assert.equal(sessionsLeft({ totalSessions: 2, sessionsUsed: 1 }, 1), 0, "one done, one booked");
assert.equal(sessionsLeft({ totalSessions: 2, sessionsUsed: 2 }, 1), 0, "never negative");
assert.equal(usableOn("2026-12-09", "2026-12-09"), true, "the last day counts");
assert.equal(usableOn("2026-12-09", "2026-12-10"), false, "a day late does not");
const fmt = (d: string) => d;
const pkg = { totalSessions: 2, sessionsUsed: 0, expiryDate: "2026-12-09", isActive: true, packageName: "Black Friday Infrared" };
assert.equal(packageRefusal(pkg, 0, "2026-12-01", fmt), null, "fine");
assert.match(packageRefusal(pkg, 0, "2026-12-12", fmt) ?? "", /has to be used by 2026-12-09/, "past the use-by date");
assert.match(packageRefusal(pkg, 2, "2026-12-01", fmt) ?? "", /no sessions left/, "all booked");
assert.match(packageRefusal({ ...pkg, isActive: false }, 0, "2026-12-01", fmt) ?? "", /no longer active/, "refunded");
import("./packageBalanceModel").then(({ perSessionValue }) => {
  assert.equal(perSessionValue({ pricePaidEur: 64, totalSessions: 1 }), 64, "a one-session EUR 64 package is worth 64");
  assert.equal(perSessionValue({ pricePaidEur: 200, totalSessions: 4 }), 50, "the bundle, 200 over 4");
  assert.equal(perSessionValue({ pricePaidEur: 100, totalSessions: 3 }), 33.33, "rounded to cents");
  assert.equal(perSessionValue({ pricePaidEur: 50, totalSessions: 0 }), 0, "never divides by zero");
  console.log("packageBalanceModel: 14 checks passed.");
});
