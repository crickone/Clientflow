// Run: npm test -- src/components/adonis/chat/followups.test.ts
//
// Adonis ends a reply with up to three suggested next questions in a
// <followups> block. The page hides the block and shows the lines as
// buttons, including while the reply is still streaming in.
import assert from "node:assert/strict";

import { MAX_FOLLOWUPS, splitFollowups, stripFollowups } from "./followups";

assert.deepEqual(splitFollowups("Massage is ahead."), { body: "Massage is ahead.", followups: [], complete: false }, "no block, nothing changes");

const full = "Massage is ahead.\n\n<followups>\n- Move budget to the bundle\n2. Draft the checkout email\n\"Show me last week\"\nA fourth one\n</followups>";
assert.deepEqual(
  splitFollowups(full),
  { body: "Massage is ahead.", followups: ["Move budget to the bundle", "Draft the checkout email", "Show me last week"], complete: true },
  "the block is hidden, bullets and quotes cleaned, capped at three",
);
assert.equal(MAX_FOLLOWUPS, 3);

assert.equal(splitFollowups("Done.\n<follo").body, "Done.", "a half-written opening tag is hidden while streaming");
assert.equal(splitFollowups("Done.\n<").body, "Done.", "even its first character");
assert.deepEqual(splitFollowups("Done.\n<followups>\nFirst que"), { body: "Done.", followups: ["First que"], complete: false }, "an open block is hidden before it closes");

const after = "Here's the change.\n<followups>\nUndo it\n</followups>\n\n_Approved automatically._";
assert.equal(splitFollowups(after).body, "Here's the change.\n\n_Approved automatically._", "lines the server adds after the block stay");

assert.deepEqual(splitFollowups("A\n<FollowUps>\nX\n</FOLLOWUPS>").followups, ["X"], "tags in any case");
assert.equal(splitFollowups("x <y> z").body, "x <y> z", "an unrelated tag mid-text is left alone");
assert.equal(splitFollowups("if a<b then").body, "if a<b then", "a < in the middle of a word is left alone");
assert.deepEqual(splitFollowups("A\n<followups>\n\n  \n- \n</followups>").followups, [], "empty lines are dropped");
assert.deepEqual(splitFollowups(`A\n<followups>\n${"x".repeat(200)}\n</followups>`).followups, [], "a runaway line is dropped");
assert.equal(stripFollowups(full), "Massage is ahead.");

console.log("followups: all checks passed");
