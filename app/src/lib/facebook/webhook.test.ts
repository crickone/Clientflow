// Run: npm test -- src/lib/facebook/webhook.test.ts
//
// Pure tests for the Facebook leadgen webhook helpers (verifyFacebookSignature,
// parseLeadgenEvents). No env/DB/server-only, so they import cleanly under the
// plain-tsx runner (same reasoning as humanName.test.ts). The HMAC shape mirrors
// the Mailgun signature tests: correct sig -> true; tampered/short/missing ->
// false; fail-closed when the app secret is missing; malformed inputs never throw.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { verifyFacebookSignature, parseLeadgenEvents, parseMessagingEvents } from "./webhook";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-fb-app-secret";
const body = JSON.stringify({ object: "page", entry: [] });
const goodSig = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");

// ── verifyFacebookSignature ──
check("correct signature -> true", verifyFacebookSignature(body, goodSig, SECRET) === true);
check("tampered body -> false", verifyFacebookSignature(body + "x", goodSig, SECRET) === false);
check("wrong secret -> false", verifyFacebookSignature(body, goodSig, "other-secret") === false);
check("missing signature header -> false", verifyFacebookSignature(body, null, SECRET) === false);
check("missing app secret -> false (fail closed)", verifyFacebookSignature(body, goodSig, undefined) === false);
check("short/garbage signature -> false", verifyFacebookSignature(body, "sha256=deadbeef", SECRET) === false);
assert.doesNotThrow(
  () => verifyFacebookSignature(body, "not-even-prefixed", SECRET),
  "malformed signature must not throw",
);
passed++;
console.log("  ✓ malformed signature does not throw");

// ── parseLeadgenEvents ──
{
  const payload = {
    object: "page",
    entry: [
      {
        id: "PAGE1",
        time: 1700000000,
        changes: [
          { field: "leadgen", value: { leadgen_id: "L1", page_id: "PAGE1", form_id: "F1", created_time: 1700000001 } },
          { field: "feed", value: { something: "ignore me" } },
        ],
      },
      { id: "PAGE2", changes: [{ field: "leadgen", value: { leadgen_id: "L2", page_id: "PAGE2" } }] },
    ],
  };
  const events = parseLeadgenEvents(payload);
  check("parses both leadgen events, ignores the feed change", events.length === 2);
  check("first: leadgenId", events[0].leadgenId === "L1");
  check("first: pageId", events[0].pageId === "PAGE1");
  check("first: formId", events[0].formId === "F1");
  check("second (no form) still parses", events[1].leadgenId === "L2" && events[1].pageId === "PAGE2");
}

// missing leadgen_id or page_id -> skipped
check(
  "change missing leadgen_id -> skipped",
  parseLeadgenEvents({ entry: [{ changes: [{ field: "leadgen", value: { page_id: "P" } }] }] }).length === 0,
);

// malformed shapes -> [] (never throws)
check("null payload -> []", parseLeadgenEvents(null).length === 0);
check("no entry array -> []", parseLeadgenEvents({}).length === 0);
check("entry not an array -> []", parseLeadgenEvents({ entry: "nope" }).length === 0);

// ── parseMessagingEvents (Messenger + Instagram DMs) ──
{
  const messenger = parseMessagingEvents({
    object: "page",
    entry: [{ id: "PAGE1", messaging: [
      { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 1700000000000, message: { mid: "m1", text: " Hi there " } },
      { sender: { id: "PAGE1" }, recipient: { id: "PSID1" }, timestamp: 1700000001000, message: { mid: "m2", text: "Reply", is_echo: true } },
      { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 1700000002000, read: { watermark: 1 } },
      { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 1700000003000, message: { mid: "m3", attachments: [{ type: "image" }] } },
    ] }],
  });
  check("messenger: reads are skipped, 3 messages kept", messenger.length === 3);
  check("messenger: channel + account + customer", messenger[0].channel === "messenger" && messenger[0].accountId === "PAGE1" && messenger[0].customerId === "PSID1");
  check("messenger: text is trimmed", messenger[0].text === "Hi there");
  check("echo: customer is the recipient", messenger[1].isEcho && messenger[1].customerId === "PSID1");
  check("attachment-only message gets a placeholder", messenger[2].text === "[Photo]");

  const ig = parseMessagingEvents({
    object: "instagram",
    entry: [{ id: "IG1", messaging: [{ sender: { id: "IGSID1" }, recipient: { id: "IG1" }, timestamp: 5, message: { mid: "i1", text: "yo" } }] }],
  });
  check("instagram: channel + account", ig.length === 1 && ig[0].channel === "instagram" && ig[0].accountId === "IG1");
  check("deleted message is skipped", parseMessagingEvents({ object: "instagram", entry: [{ id: "IG1", messaging: [{ sender: { id: "a" }, message: { mid: "x", is_deleted: true } }] }] }).length === 0);
  check("leadgen payload yields no messages", parseMessagingEvents({ object: "page", entry: [{ id: "P", changes: [{ field: "leadgen" }] }] }).length === 0);
  check("unknown object -> []", parseMessagingEvents({ object: "user", entry: [] }).length === 0);
  check("garbage never throws", parseMessagingEvents("nope").length === 0 && parseMessagingEvents(null).length === 0);
  check("text message has no attachments", messenger[0].attachments.length === 0);
  check("attachment without a link keeps the placeholder and no download", messenger[2].attachments.length === 0);
}

// ── attachments keep their link (photos and files in the inbox) ──
{
  const IMG = "https://cdn.example.test/v/photo.jpg?sig=abc&exp=1";
  const DOC = "https://cdn.example.test/v/Price%20list.pdf?sig=def";
  const evs = parseMessagingEvents({
    object: "page",
    entry: [{ id: "PAGE1", messaging: [
      { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 1, message: { mid: "a1", attachments: [{ type: "image", payload: { url: IMG } }] } },
      { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 2, message: { mid: "a2", text: "Here you go", attachments: [{ type: "file", payload: { url: DOC } }, { type: "audio", payload: { url: "https://cdn.example.test/a.mp4" } }] } },
      { sender: { id: "PAGE1" }, recipient: { id: "PSID1" }, timestamp: 3, message: { mid: "a3", is_echo: true, attachments: [{ type: "video", payload: { url: "https://cdn.example.test/v.mp4" } }] } },
      { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 4, message: { mid: "a4", attachments: [{ type: "fallback", payload: { url: "https://example.test/link" } }, { type: "image", payload: { url: "http://cdn.example.test/insecure.jpg" } }] } },
    ] }],
  });
  check("photo-only: placeholder text kept", evs[0].text === "[Photo]");
  check("photo-only: the CDN link is kept exactly", evs[0].attachments.length === 1 && evs[0].attachments[0].type === "image" && evs[0].attachments[0].url === IMG);
  check("caption + file + audio: text kept, both links kept", evs[1].text === "Here you go" && evs[1].attachments.map((a) => a.type).join() === "file,audio" && evs[1].attachments[0].url === DOC);
  check("echo with a video keeps its link", evs[2].isEcho && evs[2].attachments.length === 1 && evs[2].attachments[0].type === "video");
  check("fallback links and non-https links are not downloaded", evs[3].attachments.length === 0);
}

console.log(`\nfacebook/webhook.test.ts: ${passed} checks passed.`);
