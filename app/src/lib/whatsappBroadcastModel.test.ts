// Run: npm test -- src/lib/whatsappBroadcastModel.test.ts
//
// WhatsApp broadcasts: what each member gets, who stops them, and when it's
// allowed to send.
import assert from "node:assert/strict";

import { inSendingHours, isStopReply, renderBroadcast, sendDuration, STOP_LINE, validateBroadcast } from "./whatsappBroadcastModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const m = renderBroadcast("Hi [FIRST_NAME], [business_name] has a new class on Saturday.", { firstName: "Aoife" }, "Inspire");
check("merge fields are filled", m.startsWith("Hi Aoife, Inspire has a new class"));
check("every message ends with how to stop", m.endsWith(STOP_LINE));
check("no first name still reads", renderBroadcast("Hi [FIRST_NAME]", { firstName: " " }, "X").startsWith("Hi there"));

check("an empty message is refused", validateBroadcast("  ") !== null);
check("an unknown merge field is refused", validateBroadcast("Hi [LAST_NAME]") !== null);
check("known ones are fine", validateBroadcast("Hi [FIRST_NAME] from [BUSINESS_NAME]") === null);
check("too long is refused", validateBroadcast("x".repeat(1001)) !== null);

check("STOP stops", isStopReply("STOP") && isStopReply(" stop. ") && isStopReply("Unsubscribe") && isStopReply("stop all"));
check("a sentence with stop in it doesn't", !isStopReply("can I stop by later?") && !isStopReply("Stop the class at 7?"));

// 15 Oct 2026 is Irish summer time (UTC+1).
check("10:00 Irish time sends", inSendingHours(Date.parse("2026-10-15T09:00:00Z")));
check("21:30 Irish time waits", !inSendingHours(Date.parse("2026-10-15T20:30:00Z")));
check("08:30 Irish time waits", !inSendingHours(Date.parse("2026-10-15T07:30:00Z")));
check("in winter, 09:00 UTC is 09:00 Irish and sends", inSendingHours(Date.parse("2026-12-15T09:00:00Z")));

check("duration reads plainly", sendDuration(2) === "about a minute" && sendDuration(30) === "about 10 minutes" && sendDuration(300) === "about 1.5 hours");

console.log(`whatsappBroadcastModel: ${passed} checks passed`);
