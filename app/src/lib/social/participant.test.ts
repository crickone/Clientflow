// Run: npm test -- src/lib/social/participant.test.ts
import assert from "node:assert/strict";

import { participantName } from "./participant";

const body = {
  data: [
    { participants: { data: [{ id: "111", name: "Optimal Health at Inspire" }, { id: "222", name: " Mary Walsh " }] } },
  ],
};
assert.equal(participantName(body, "222"), "Mary Walsh", "the sender, trimmed");
assert.equal(participantName(body, "333"), null, "someone not in the conversation");
assert.equal(participantName({ data: [{ participants: { data: [{ id: "222", name: "  " }] } }] }, "222"), null, "blank name");
assert.equal(participantName({ error: { message: "x" } }, "222"), null, "an error body");
assert.equal(participantName(null, "222"), null);
console.log("participant.test.ts: all assertions passed");
