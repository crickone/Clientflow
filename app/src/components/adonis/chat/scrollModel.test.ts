// Run: npm test -- src/components/adonis/chat/scrollModel.test.ts
//
// When the chat follows new content, when it shows "Jump to latest", and how
// far the on-screen keyboard pushes the composer up.
import assert from "node:assert/strict";

import { distanceFromBottom, JUMP_AFTER_PX, keyboardInset, shouldShowJump, stickAfterScroll } from "./scrollModel";

assert.equal(distanceFromBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), 0);
assert.equal(distanceFromBottom({ scrollTop: 100, clientHeight: 400, scrollHeight: 1000 }), 500);
assert.equal(distanceFromBottom({ scrollTop: 700, clientHeight: 400, scrollHeight: 1000 }), 0, "never negative (overscroll)");

assert.equal(stickAfterScroll(10, false, true), true, "scrolling to the bottom yourself starts following");
assert.equal(stickAfterScroll(400, true, true), false, "scrolling up yourself stops following");
assert.equal(stickAfterScroll(400, true, false), true, "the page's own scrolling never changes it");
assert.equal(stickAfterScroll(0, false, false), false);

assert.equal(shouldShowJump({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 + JUMP_AFTER_PX }), false);
assert.equal(shouldShowJump({ scrollTop: 0, clientHeight: 400, scrollHeight: 401 + JUMP_AFTER_PX }), true);

assert.equal(keyboardInset(844, 844, 0), 0, "no keyboard");
assert.equal(keyboardInset(844, 508, 0), 336, "the keyboard's height");
assert.equal(keyboardInset(844, 508, 120), 216, "less what the browser already scrolled");
assert.equal(keyboardInset(844, 900, 0), 0);

console.log("scrollModel: all checks passed");
