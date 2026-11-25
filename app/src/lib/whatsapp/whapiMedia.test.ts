// Run: npm test -- src/lib/whatsapp/whapiMedia.test.ts
//
// WhatsApp photos, voice notes and documents used to be dropped by
// parseInboundWebhook (anything not type "text" was skipped). Now they arrive
// with their caption (or a placeholder) as the text and a download plan; text
// messages parse exactly as before. Fixtures are made up: no real numbers.
import assert from "node:assert/strict";
import { WhapiBridge } from "./whapi";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const bridge = new WhapiBridge({ token: "tok-test", baseUrl: "https://gate.example.test/", webhookSecret: "s" });
const FROM = "353800000001";
const base = { from: FROM, chat_id: `${FROM}@s.whatsapp.net`, from_me: false, timestamp: 1700000000 };

// Text: unchanged.
const text = bridge.parseInboundWebhook({ messages: [{ ...base, id: "t1", type: "text", text: { body: "Hello" } }] });
check("text: body, id, phone, seconds -> ms", !!text && text.text === "Hello" && text.providerMessageId === "t1" && text.fromPhone === FROM && text.timestamp === 1700000000000);
check("text: no media", !!text && text.media === undefined);

// Image with caption.
const img = bridge.parseInboundWebhook({
  messages: [{ ...base, id: "i1", type: "image", image: { id: "media-img-1", mime_type: "image/jpeg", file_size: 12345, link: "https://files.example.test/i1.jpg", caption: "My knee after the session" } }],
});
check("image: caption becomes the text", !!img && img.text === "My knee after the session");
check(
  "image: kind, media id, link, mime, size",
  !!img && img.media?.length === 1 && img.media[0].kind === "image" && img.media[0].mediaId === "media-img-1" && img.media[0].link === "https://files.example.test/i1.jpg" && img.media[0].mime === "image/jpeg" && img.media[0].size === 12345,
);
const sources = img?.media ? bridge.mediaSources(img.media[0]) : [];
check("image: the link is tried first, with no token", sources[0]?.url === "https://files.example.test/i1.jpg" && !sources[0].headers);
check(
  "image: then Whapi's media endpoint, with the bearer token",
  sources[1]?.url === "https://gate.example.test/media/media-img-1" && sources[1].headers?.Authorization === "Bearer tok-test",
);

// Voice note, no caption, no link.
const voice = bridge.parseInboundWebhook({
  messages: [{ ...base, id: "v1", type: "voice", voice: { id: "media-voice-1", mime_type: "audio/ogg; codecs=opus", file_size: 8000, seconds: 6 } }],
});
check("voice: placeholder text", !!voice && voice.text === "[Voice note]");
check("voice: audio kind with the media id", !!voice && voice.media?.[0].kind === "audio" && voice.media[0].mediaId === "media-voice-1" && voice.media[0].mime === "audio/ogg; codecs=opus");
check("voice: only the media endpoint to try", voice?.media ? bridge.mediaSources(voice.media[0]).length === 1 : false);

// Document keeps its file name.
const doc = bridge.parseInboundWebhook({
  messages: [{ ...base, id: "d1", type: "document", document: { id: "media-doc-1", mime_type: "application/pdf", filename: "referral.pdf", file_size: 2048 } }],
});
check("document: placeholder text and file name", !!doc && doc.text === "[File]" && doc.media?.[0].kind === "file" && doc.media[0].name === "referral.pdf");

// Still skipped: own messages, groups, unknown types, a media message with nothing to download.
check("from_me media is skipped", bridge.parseInboundWebhook({ messages: [{ ...base, id: "x1", from_me: true, type: "image", image: { id: "m" } }] }) === null);
check("group media is skipped", bridge.parseInboundWebhook({ messages: [{ ...base, id: "x2", chat_id: "1203@g.us", type: "image", image: { id: "m" } }] }) === null);
check("location is skipped", bridge.parseInboundWebhook({ messages: [{ ...base, id: "x3", type: "location", location: { latitude: 1 } }] }) === null);
check("image with no id or link is skipped", bridge.parseInboundWebhook({ messages: [{ ...base, id: "x4", type: "image", image: { caption: "hi" } }] }) === null);
check("prototype keys are not media types", bridge.parseInboundWebhook({ messages: [{ ...base, id: "x5", type: "constructor", constructor: { id: "m" } }] }) === null);

console.log(`\nwhapiMedia: ${passed} checks passed.`);
