// Run: npm test -- src/lib/whatsapp/whapiSend.test.ts
//
// Sending files on Whapi: the payload builder picks the endpoint per kind
// (a file goes to /messages/document and carries its file name), the file
// travels inline as a data URL with its name encoded, and sendMedia posts it
// with the same auth and reply parsing as sendText. No real provider is hit.
import assert from "node:assert/strict";
import { WhapiBridge, whapiMediaPayload } from "./whapi";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const bytes = Buffer.from("%PDF-1.4 test");
const b64 = bytes.toString("base64");

const img = whapiMediaPayload("353800000001", { kind: "image", mime: "image/jpeg", name: "knee.jpg", bytes });
check("image -> /messages/image", img.path === "image");
check("image: data URL with name and base64", img.body.media === `data:image/jpeg;name=knee.jpg;base64,${b64}`);
check("image: no filename field", !("filename" in img.body));
check("image: no caption when none given", !("caption" in img.body));
check("image: to is kept", img.body.to === "353800000001");

check("video -> /messages/video", whapiMediaPayload("1", { kind: "video", mime: "video/mp4", bytes }).path === "video");
check("audio -> /messages/audio", whapiMediaPayload("1", { kind: "audio", mime: "audio/mpeg", bytes }).path === "audio");

const doc = whapiMediaPayload("1", { kind: "file", mime: "application/pdf", name: "price list é.pdf", bytes, caption: "  Our prices  " });
check("file -> /messages/document", doc.path === "document");
check("document: filename is the plain name", doc.body.filename === "price list é.pdf");
check("document: the name in the data URL is encoded", doc.body.media === `data:application/pdf;name=${encodeURIComponent("price list é.pdf")};base64,${b64}`);
check("document: caption trimmed", doc.body.caption === "Our prices");

const unnamed = whapiMediaPayload("1", { kind: "file", mime: "text/plain", bytes });
check("no name: no ;name= and no filename", unnamed.body.media.startsWith("data:text/plain;base64,") && !("filename" in unnamed.body));

const semicolon = whapiMediaPayload("1", { kind: "file", mime: "text/csv", name: "a;b,c.csv", bytes });
check("a name with ; and , cannot break the data URL", semicolon.body.media.startsWith(`data:text/csv;name=a%3Bb%2Cc.csv;base64,`));

(async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let reply: Response = new Response(JSON.stringify({ sent: true, message: { id: "wamid-1" } }), { status: 200 });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return reply;
  }) as typeof fetch;

  const bridge = new WhapiBridge({ token: "tok-test", baseUrl: "https://gate.example.test/" });
  const sent = await bridge.sendMedia("+353 80 000 0001", { kind: "file", mime: "application/pdf", name: "p.pdf", bytes });
  check("sendMedia returns the provider id", sent.providerMessageId === "wamid-1");
  check("posted to the document endpoint", calls[0].url === "https://gate.example.test/messages/document" && calls[0].init.method === "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  check("same bearer auth and JSON headers as text", headers.Authorization === "Bearer tok-test" && headers["Content-Type"] === "application/json");
  const body = JSON.parse(String(calls[0].init.body));
  check("phone normalised in the body", body.to === "353800000001" && body.filename === "p.pdf");

  reply = new Response(JSON.stringify({ id: "top-level-id" }), { status: 200 });
  check("a top-level id is read too", (await bridge.sendMedia("353800000001", { kind: "image", mime: "image/png", bytes })).providerMessageId === "top-level-id");

  reply = new Response("file too large", { status: 413 });
  await assert.rejects(() => bridge.sendMedia("353800000001", { kind: "video", mime: "video/mp4", bytes }), /WhatsApp send failed \(413\): file too large/);
  passed++;

  reply = new Response(JSON.stringify({ sent: true }), { status: 200 });
  await assert.rejects(() => bridge.sendMedia("353800000001", { kind: "audio", mime: "audio/ogg", bytes }), /no message id/);
  passed++;

  // sendText still parses the same way.
  reply = new Response(JSON.stringify({ message: { id: "txt-1" } }), { status: 200 });
  check("sendText unchanged", (await bridge.sendText("353800000001", "Hello")).providerMessageId === "txt-1" && calls[calls.length - 1].url.endsWith("/messages/text"));

  await assert.rejects(() => bridge.sendMedia("", { kind: "image", mime: "image/png", bytes }), /empty after normalization/);
  passed++;

  console.log(`whapi send: ${passed} checks passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
