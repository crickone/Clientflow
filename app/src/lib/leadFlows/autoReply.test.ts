import assert from "node:assert/strict";

import { isAutoReply } from "./autoReply";

assert.equal(isAutoReply({ "Auto-Submitted": "auto-replied" }, "Re: Hello"), true, "auto-replied");
assert.equal(isAutoReply({ "auto-submitted": "auto-generated" }, "Re: Hello"), true, "auto-generated, lower case name");
assert.equal(isAutoReply({ "Auto-Submitted": "no" }, "Re: Hello"), false, "Auto-Submitted: no is a person");
assert.equal(isAutoReply({ "X-Autoreply": "yes" }, "Re: Hello"), true, "X-Autoreply");
assert.equal(isAutoReply({ "X-Autorespond": "" }, "Re: Hello"), true, "X-Autorespond present");
assert.equal(isAutoReply({ Precedence: "auto_reply" }, "Re: Hello"), true, "Precedence auto_reply");
assert.equal(isAutoReply({ Precedence: "bulk" }, "Re: Hello"), true, "Precedence bulk");
assert.equal(isAutoReply({ Precedence: "junk" }, "Re: Hello"), true, "Precedence junk");
assert.equal(isAutoReply({ Precedence: "normal" }, "Re: Hello"), false, "Precedence normal");
assert.equal(isAutoReply({ From: "aoife@example.com" }, "Re: Booking for Thursday"), false, "a normal reply");
assert.equal(isAutoReply(undefined, "Automatic reply: Hello"), true, "subject fallback, Outlook");
assert.equal(isAutoReply(null, "Out of office: back on Monday"), true, "subject fallback, out of office");
assert.equal(isAutoReply({}, "Auto reply - on leave"), true, "subject fallback, auto reply");
assert.equal(isAutoReply({}, "Re: Out of office hours at the clinic?"), false, "a Re: subject that mentions office hours is a person");
assert.equal(isAutoReply({}, null), false, "no subject");

console.log("autoReply tests passed");
