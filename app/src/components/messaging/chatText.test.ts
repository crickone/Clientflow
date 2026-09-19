// Run: npm test -- src/components/messaging/chatText.test.ts
//
// Two bits of plumbing were leaking into a conversation that is otherwise
// written for a person.
//
// Completing an approved action appended the tool's raw return value, so a
// friendly exchange ended with
//   {"result":"Replaced the image on / …","path":"/","siteId":1,"newSrc":"…"}
// And attaching a file put the marker the model needs — [Attached to the
// library: "x.jpg" — image #92] — into the operator's own message bubble.
//
// These are the two functions that decide what gets shown. They are pure, so
// they are tested here rather than through the component.
import assert from "node:assert/strict";

import { humanResult, splitAttachments } from "./chatText";

// ── what a finished action says ─────────────────────────────────────────────

assert.equal(
  humanResult(
    JSON.stringify({
      result: 'Replaced the image on / with "inbody-console-full.jpg". The change is live.',
      path: "/",
      siteId: 1,
      newSrc: "/library-media/2",
    }),
  ),
  'Replaced the image on / with "inbody-console-full.jpg". The change is live.',
  "THE SENTENCE IS SHOWN, not the record around it",
);

assert.equal(
  humanResult(JSON.stringify({ error: "That phrase appears 3 times on /about." })),
  "That phrase appears 3 times on /about.",
  "a refusal reads as a refusal",
);

// Never swallow something it cannot read: a raw line beats a silent one.
assert.equal(humanResult("Plain prose from some tool"), "Plain prose from some tool", "non-JSON is passed through");
assert.equal(humanResult("{not json"), "{not json", "malformed JSON is passed through");
assert.equal(
  humanResult(JSON.stringify({ path: "/", siteId: 1 })),
  JSON.stringify({ path: "/", siteId: 1 }),
  "JSON with neither key is passed through rather than shown as nothing",
);
assert.equal(
  humanResult(JSON.stringify({ result: "   " })),
  JSON.stringify({ result: "   " }),
  "…and so is a blank result, which would otherwise render an empty message",
);

// ── the attachment marker never reaches the bubble ──────────────────────────

const one = splitAttachments(
  'i want to replace the image of the woman and man on the inbody scan with this image\n\n[Attached to the library: "inbody-console-full.jpg" — image #92]',
);
assert.equal(
  one.body,
  "i want to replace the image of the woman and man on the inbody scan with this image",
  "THE OPERATOR READS WHAT THEY TYPED",
);
assert.deepEqual(
  one.attached,
  [{ name: "inbody-console-full.jpg", kind: "image", id: "92" }],
  "…and the attachment is returned to be drawn as a chip",
);

const many = splitAttachments(
  'here are both\n\n[Attached to the library: "a.pdf" — file #1]\n[Attached to the library: "b.jpg" — image #2]',
);
assert.equal(many.body, "here are both", "several attachments all come out of the text");
assert.equal(many.attached.length, 2);
assert.deepEqual(many.attached.map((a) => a.kind), ["file", "image"], "each keeps its kind");

const only = splitAttachments('[Attached to the library: "a.pdf" — file #1]');
assert.equal(only.body, "", "a message that is ONLY an attachment leaves no stray whitespace");
assert.equal(only.attached.length, 1, "…and still shows the chip");

const none = splitAttachments("just a normal question");
assert.equal(none.body, "just a normal question", "an ordinary message is untouched");
assert.deepEqual(none.attached, []);

// Text that merely mentions a filename must not be eaten: the marker is
// anchored to a whole line, so a sentence about one is left alone.
const mentions = splitAttachments('can you use [Attached to the library: "x"] as a heading?');
assert.match(mentions.body, /can you use/, "a malformed lookalike inside a sentence is left alone");
assert.deepEqual(mentions.attached, [], "…and is not treated as an attachment");

console.log("chatText.test.ts: all assertions passed");
