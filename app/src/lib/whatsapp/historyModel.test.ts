// Run: npm test -- src/lib/whatsapp/historyModel.test.ts
import assert from "node:assert/strict";
import { missingMessages, parseChatHistory, parseChatMessage, phoneSentFromWebhook } from "./historyModel";

const CHAT = "353870000001@s.whatsapp.net";
const base = { chat_id: CHAT, from: "353870000001", timestamp: 1794488812 };

// A GoHighLevel template sent from the clinic's number.
const hsm = parseChatMessage({ ...base, id: "h1", from_me: true, type: "hsm", source: "mobile", hsm: { body: "Hi Example,\n\nJust checking in." } });
assert.deepEqual(hsm, { id: "h1", fromMe: true, at: 1794488812000, text: "Hi Example,\n\nJust checking in.", source: "mobile" });

assert.equal(parseChatMessage({ ...base, id: "t1", from_me: false, type: "text", text: { body: " Saturday suits " } })?.text, "Saturday suits");
assert.equal(parseChatMessage({ ...base, id: "i1", type: "image", image: { caption: "my back" } })?.text, "Photo: my back");
assert.equal(parseChatMessage({ ...base, id: "i2", type: "image", image: {} })?.text, "Photo");
assert.equal(parseChatMessage({ ...base, id: "v1", type: "voice", voice: {} })?.text, "Voice message");
assert.equal(parseChatMessage({ ...base, id: "d1", type: "document", document: { file_name: "form.pdf" } })?.text, "Document: form.pdf");
assert.equal(parseChatMessage({ ...base, id: "a1", type: "action", action: { type: "reaction" } }), null, "reactions are not messages");
assert.equal(parseChatMessage({ ...base, id: "g1", chat_id: "1203630@g.us", type: "text", text: { body: "group" } }), null, "never group chats");
assert.equal(parseChatMessage({ ...base, id: "", type: "text", text: { body: "x" } }), null, "no id, no message");
assert.equal(parseChatMessage({ ...base, id: "ms", timestamp: 1794488812000, type: "text", text: { body: "x" } })?.at, 1794488812000, "millisecond timestamps kept");

const history = parseChatHistory({
  messages: [
    { ...base, id: "b", timestamp: 300, type: "text", text: { body: "later" } },
    { ...base, id: "a", timestamp: 100, from_me: true, type: "hsm", hsm: { body: "first" } },
    { ...base, id: "c", timestamp: 200, type: "action", action: {} },
  ],
});
assert.deepEqual(history.map((m) => m.id), ["a", "b"], "oldest first, non-messages dropped");
assert.deepEqual(parseChatHistory({}), []);
assert.deepEqual(missingMessages(history, new Set(["a"])).map((m) => m.id), ["b"], "already stored ones are left out");

// Webhook: only what the business sent itself, never what Adonis sent through the API, never their messages.
const sent = phoneSentFromWebhook({
  messages: [
    { ...base, id: "p1", from_me: true, source: "mobile", type: "text", text: { body: "Typed on the phone" } },
    { ...base, id: "p2", from_me: true, source: "api", type: "text", text: { body: "Sent by Adonis" } },
    { ...base, id: "p3", from_me: false, source: "mobile", type: "text", text: { body: "Their reply" } },
  ],
});
assert.deepEqual(sent.map((m) => [m.id, m.toPhoneDigits]), [["p1", "353870000001"]]);

console.log("historyModel: 17 checks passed.");
