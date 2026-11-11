// Run: npm test -- src/lib/whatsapp/webhookHeader.test.ts
//
// The WhatsApp webhook secret moves from the address (?secret=, ends up in
// logs) to a header Whapi sends. Whapi only takes custom headers through its
// API, so moveSecretToHeader rewrites the channel's webhook there: our entry
// gets the clean address and the header, everything else is kept, and the
// change is confirmed before the app starts refusing the old address.
import assert from "node:assert/strict";
import { WhapiBridge } from "./whapi";

(async () => {
  const SECRET = "s3cr3t-0123456789";
  let stored: Record<string, unknown> = {
    offline_mode: true,
    webhooks: [
      { url: "https://other.example.com/hook", events: [{ type: "messages", method: "post" }], mode: "body" },
      { url: "https://app.adonisagent.ie/api/whatsapp/webhook?t=gym&secret=" + SECRET, events: [{ type: "messages", method: "post" }, { type: "statuses", method: "put" }], mode: "body" },
    ],
  };
  const patches: unknown[] = [];
  let refuse = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /\/settings$/);
    if ((init?.method ?? "GET") === "PATCH") {
      if (refuse) return new Response("nope", { status: 400 });
      const body = JSON.parse(String(init!.body));
      patches.push(body);
      stored = { ...stored, ...body };
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify(stored), { status: 200 });
  }) as typeof fetch;

  const clean = "https://app.adonisagent.ie/api/whatsapp/webhook?t=gym";
  await new WhapiBridge({ token: "tok", webhookSecret: SECRET }).moveSecretToHeader(clean);
  const hooks = (stored.webhooks as Array<{ url: string; events: unknown[]; headers?: Record<string, string> }>);
  const ours = hooks.find((h) => h.url.includes("/api/whatsapp/webhook"))!;
  assert.equal(ours.url, clean, "the address no longer carries the secret");
  assert.equal(ours.headers?.["x-webhook-secret"], SECRET, "the secret travels as a header");
  assert.equal(ours.events.length, 2, "our events are kept");
  assert.ok(hooks.some((h) => h.url === "https://other.example.com/hook"), "another webhook is left alone");
  assert.equal(hooks.filter((h) => h.url.includes("/api/whatsapp/webhook")).length, 1, "no duplicate of ours");
  assert.equal(stored.offline_mode, true, "other settings are written back unchanged");

  refuse = true;
  await assert.rejects(new WhapiBridge({ token: "tok", webhookSecret: SECRET }).moveSecretToHeader(clean), /did not accept/, "a refusal is reported, so the flag is not set");
  await assert.rejects(new WhapiBridge({ token: "tok", webhookSecret: "" }).moveSecretToHeader(clean), /No webhook secret/);
  console.log("webhookHeader: secret moved to a header, settings preserved, refusals reported; 8 checks passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
