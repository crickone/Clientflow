// Run: npm test -- src/lib/leadFlows/activityModel.test.ts
import assert from "node:assert/strict";
import { countRuns, nextStepLabel, runProgress, statusLabel } from "./activityModel";

const p = runProgress([
  { kind: "message", channel: "whatsapp", status: "sent", dueAt: 1, sentAt: 10 },
  { kind: "message", channel: "email", status: "sent", dueAt: 1, sentAt: 12 },
  { kind: "message", channel: "whatsapp", status: "failed", dueAt: 5, sentAt: null },
  { kind: "message", channel: "whatsapp", status: "queued", dueAt: 50, sentAt: null },
  { kind: "move", channel: "whatsapp", status: "queued", dueAt: 90, sentAt: null },
]);
assert.equal(p.messages, 4, "moves are not messages");
assert.equal(p.sent, 2);
assert.equal(p.failed, 1);
assert.equal(p.lastSentAt, 12, "latest send");
assert.deepEqual(p.next, { channel: "whatsapp", dueAt: 50, kind: "message" }, "the earliest queued step is next");
assert.equal(nextStepLabel(p.next, (ms) => `t${ms}`), "WhatsApp, t50");
assert.equal(nextStepLabel({ channel: "whatsapp", dueAt: 90, kind: "move" }, (ms) => `t${ms}`), "Move on, t90");
assert.equal(statusLabel("active", null), "Active");
assert.equal(statusLabel("stopped", "replied"), "Stopped: Replied");
assert.equal(statusLabel("stopped", null), "Stopped: by hand");
assert.deepEqual(
  countRuns([{ status: "active", stopReason: null }, { status: "stopped", stopReason: "replied" }, { status: "stopped", stopReason: "won or lost" }, { status: "finished", stopReason: null }]),
  { entered: 4, active: 1, finished: 1, stopped: 2, replied: 1 },
);
console.log("activityModel: 11 checks passed.");
