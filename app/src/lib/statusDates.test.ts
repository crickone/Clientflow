import assert from "node:assert/strict";
import { appointmentStatusDates, membershipStatusDates } from "./statusDates";

const now = new Date("2026-10-02T12:00:00Z");

assert.deepEqual(appointmentStatusDates("scheduled", "cancelled", now), { cancelledAt: now, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates("confirmed", "no_show", now), { cancelledAt: now, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates("cancelled", "no_show", now), {}, "keeps the original date");
assert.deepEqual(appointmentStatusDates("cancelled", "scheduled", now), { cancelledAt: null, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates("scheduled", "completed", now), {});
assert.deepEqual(appointmentStatusDates(null, "no_show", now), { cancelledAt: now, cancelledAtApprox: false });
assert.deepEqual(appointmentStatusDates(null, "scheduled", now), {});

assert.deepEqual(membershipStatusDates("active", "cancelled", now), { endedAt: now });
assert.deepEqual(membershipStatusDates("active", "expired", now), { endedAt: now });
assert.deepEqual(membershipStatusDates("expired", "cancelled", now), {});
assert.deepEqual(membershipStatusDates("cancelled", "active", now), { endedAt: null });
assert.deepEqual(membershipStatusDates(null, "active", now), {});

console.log("statusDates.test.ts: ok");
