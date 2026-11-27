// Run: npm test -- src/lib/social/dmSend.test.ts
//
// Files on Messenger / Instagram replies. The multipart builder maps each kind
// to Meta's attachment type and carries the window's messaging type (the
// HUMAN_AGENT tag past 24 hours); the reply-window rules refuse a send with
// files exactly as they refuse text; and sendDm, on a scratch business with a
// stand-in Graph API, posts the text as JSON then each file as multipart,
// one row each, a refused file stored failed with its reason.
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/facebook/pages") return { getPageTokenForTenant: () => "page-token-test" };
  if (request === "@/lib/facebook/health") return { notePageRefusal: async () => false };
  return realLoad.call(this, request, ...rest);
};

import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";

import { runWithTenant } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { makeScratchTenant } from "@/lib/leadFlows/testing/harness";
import { parseMedia, type MessageMedia } from "@/lib/inbox/mediaModel";
import type { OutgoingFile } from "@/lib/attachments/outgoingModel";

fs.rmSync(path.join(process.cwd(), "data", "tenants", "dm-send-test"), { recursive: true, force: true });
const scratch = makeScratchTenant("dm-send-test");

let fileSeq = 0;
function file(kind: MessageMedia["kind"], mime: string, name?: string): OutgoingFile {
  const hex = (++fileSeq).toString(16).padStart(32, "0");
  const bytes = Buffer.from(`bytes of ${name ?? kind}`);
  return { media: { kind, file: `${hex}.bin`, mime, ...(name ? { name } : {}), size: bytes.length }, bytes };
}

type Posted = { json?: Record<string, unknown>; form?: FormData; url: string };
let posted: Posted[] = [];
let refuseMime = "";
let seq = 0;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const p: Posted = { url: String(url) };
  if (init.body instanceof FormData) p.form = init.body;
  else p.json = JSON.parse(String(init.body));
  const mime = p.form ? (p.form.get("filedata") as File).type : "";
  if (refuseMime && mime === refuseMime) {
    return new Response(JSON.stringify({ error: { message: "(#100) Upload attachment failure." } }), { status: 400 });
  }
  posted.push(p);
  return new Response(JSON.stringify({ recipient_id: "psid-1", message_id: `mid.${++seq}` }), { status: 200 });
}) as typeof fetch;

(async () => {
  const { dmAttachmentForm, dmSendRefusal, sendDm } = await import("./dm");
  let n = 0;
  const ok = (c: boolean, m: string) => {
    assert.ok(c, m);
    n++;
  };

  // The multipart builder.
  const bytes = Buffer.from("%PDF-1.4");
  const kinds: Array<[MessageMedia["kind"], string]> = [["image", "image"], ["video", "video"], ["audio", "audio"], ["file", "file"]];
  for (const [kind, type] of kinds) {
    const form = dmAttachmentForm({ recipientId: "psid-1", window: "open", file: { kind, mime: "application/pdf", name: "x.pdf", bytes } });
    ok(JSON.parse(String(form.get("message"))).attachment.type === type, `${kind} -> ${type}`);
  }
  const open = dmAttachmentForm({ recipientId: "psid-1", window: "open", file: { kind: "file", mime: "application/pdf", name: "price-list.pdf", bytes } });
  ok(JSON.parse(String(open.get("recipient"))).id === "psid-1", "recipient as a JSON string");
  ok(JSON.parse(String(open.get("message"))).attachment.payload.is_reusable === false, "not reusable");
  ok(open.get("messaging_type") === "RESPONSE" && open.get("tag") === null, "inside 24h: RESPONSE, no tag");
  const fd = open.get("filedata") as File;
  ok(fd instanceof Blob && fd.name === "price-list.pdf" && fd.type === "application/pdf" && fd.size === bytes.length, "filedata carries the name, type and bytes");
  const late = dmAttachmentForm({ recipientId: "psid-1", window: "human_only", file: { kind: "image", mime: "image/png", bytes } });
  ok(late.get("messaging_type") === "MESSAGE_TAG" && late.get("tag") === "HUMAN_AGENT", "past 24h: HUMAN_AGENT tag");
  ok((late.get("filedata") as File).name === "image", "an unnamed file still gets a name");

  // The window rules (the same for text and files).
  ok(dmSendRefusal("open", { label: "Messenger", humanAgentApproved: false }) === null, "open: allowed");
  ok(/within 7 days/.test(dmSendRefusal("closed", { label: "Messenger", humanAgentApproved: true }) ?? ""), "closed: refused");
  ok(/written by a person/.test(dmSendRefusal("human_only", { label: "Instagram", aiGenerated: true, humanAgentApproved: true }) ?? ""), "past 24h, AI: refused");
  ok(/Meta Business Suite/.test(dmSendRefusal("human_only", { label: "Messenger", humanAgentApproved: false }) ?? ""), "past 24h, no approval: refused");
  ok(dmSendRefusal("human_only", { label: "Messenger", humanAgentApproved: true }) === null, "past 24h, approved person: allowed");

  const prevApproved = process.env.META_HUMAN_AGENT_APPROVED;
  try {
    await runWithTenant(scratch.tid, async () => {
      const [lead] = db.insert(schema.leads).values({ source: "messenger", firstName: "Example", inboxOnly: true }).returning().all();
      db.insert(schema.socialContacts).values({ channel: "messenger", externalId: "psid-1", pageId: "page-1", ownerType: "lead", ownerId: lead.id, lastInboundAt: new Date(Date.now() - 60_000) }).run();
      const rows = () => db.select().from(schema.leadMessages).where(eq(schema.leadMessages.leadId, lead.id)).orderBy(asc(schema.leadMessages.id)).all();

      // Text only: JSON as before.
      const t = await sendDm({ subjectType: "lead", subjectId: lead.id, text: "Hello" });
      ok(posted.length === 1 && !!posted[0].json && (posted[0].json.message as { text: string }).text === "Hello" && posted[0].json.messaging_type === "RESPONSE", "text: JSON body, RESPONSE");
      ok(posted[0].url.includes("/page-1/messages?") && posted[0].url.includes("access_token=page-token-test"), "text: the page's messages endpoint with its token");
      ok(t.channel === "messenger" && t.failed.length === 0 && rows().length === 1 && rows()[0].media === null && rows()[0].status === "sent", "text: one row, as before");

      // Text and two files.
      posted = [];
      const pdf = file("file", "application/pdf", "price-list.pdf");
      const photo = file("image", "image/jpeg", "room.jpg");
      const r = await sendDm({ subjectType: "lead", subjectId: lead.id, text: "Here you go", attachments: [pdf, photo] });
      const after = rows().slice(1);
      ok(posted.length === 3 && !!posted[0].json && !!posted[1].form && !!posted[2].form, "text as JSON, then each file as multipart");
      ok(posted.every((p) => p.url.includes("/page-1/messages?")), "files go to the same endpoint");
      ok(JSON.parse(String(posted[1].form!.get("message"))).attachment.type === "file" && JSON.parse(String(posted[2].form!.get("message"))).attachment.type === "image", "types follow the files");
      ok(after.length === 3 && after[0].media === null && parseMedia(after[1].media)[0]?.name === "price-list.pdf" && parseMedia(after[2].media)[0]?.file === photo.media.file, "three rows, media on the file rows");
      ok(after.every((x) => x.status === "sent" && x.channel === "messenger" && x.providerMessageId?.startsWith("mid.")), "all sent with Meta's ids");
      ok(r.messageId === after[0].id && r.failed.length === 0, "returns the text's row");

      // One file refused: failed row with the reason, the other goes.
      posted = [];
      refuseMime = "video/mp4";
      const before = rows().length;
      const p = await sendDm({ subjectType: "lead", subjectId: lead.id, attachments: [file("video", "video/mp4", "clip.mp4"), file("audio", "audio/mpeg", "note.mp3")] });
      const part = rows().slice(before);
      ok(part.length === 2 && part[0].status === "failed" && /Upload attachment failure/.test(part[0].error ?? "") && part[0].providerMessageId === null, "the refused file: failed with Meta's reason");
      ok(part[1].status === "sent" && p.messageId === part[1].id && p.failed.length === 1 && p.failed[0].startsWith("clip.mp4: "), "the other file went, failed names the refused one");

      // Nothing goes: throws, nothing stored.
      const beforeNone = rows().length;
      await assert.rejects(() => sendDm({ subjectType: "lead", subjectId: lead.id, attachments: [file("video", "video/mp4", "only.mp4")] }), /only\.mp4: .*Upload attachment failure/);
      ok(rows().length === beforeNone, "nothing sent: nothing stored");
      refuseMime = "";

      await assert.rejects(() => sendDm({ subjectType: "lead", subjectId: lead.id, text: " " }), /Message is empty\./);
      n++;

      // Past 24 hours: files are held to the same rules as text.
      db.update(schema.socialContacts).set({ lastInboundAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }).run();
      delete process.env.META_HUMAN_AGENT_APPROVED;
      posted = [];
      await assert.rejects(() => sendDm({ subjectType: "lead", subjectId: lead.id, attachments: [file("image", "image/png", "a.png")] }), /Meta Business Suite/);
      ok(posted.length === 0, "past 24h without approval: no file sent");
      process.env.META_HUMAN_AGENT_APPROVED = "1";
      await assert.rejects(() => sendDm({ subjectType: "lead", subjectId: lead.id, aiGenerated: true, attachments: [file("image", "image/png", "a.png")] }), /written by a person/);
      ok(posted.length === 0, "past 24h, AI: no file sent");
      await sendDm({ subjectType: "lead", subjectId: lead.id, attachments: [file("image", "image/png", "a.png")] });
      ok(posted.length === 1 && posted[0].form!.get("messaging_type") === "MESSAGE_TAG" && posted[0].form!.get("tag") === "HUMAN_AGENT", "past 24h, approved person: the file goes with the HUMAN_AGENT tag");

      db.update(schema.socialContacts).set({ lastInboundAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }).run();
      posted = [];
      await assert.rejects(() => sendDm({ subjectType: "lead", subjectId: lead.id, text: "Hi", attachments: [file("image", "image/png", "b.png")] }), /within 7 days/);
      ok(posted.length === 0, "past 7 days: nothing sent");

      // Six files refused before anything goes.
      db.update(schema.socialContacts).set({ lastInboundAt: new Date() }).run();
      await assert.rejects(() => sendDm({ subjectType: "lead", subjectId: lead.id, attachments: Array.from({ length: 6 }, (_, i) => file("image", "image/png", `p${i}.png`)) }), /up to 5 files/);
      ok(posted.length === 0, "six files: nothing sent");

      // sendReply hands the files to the channel they last wrote on.
      const { sendReply } = await import("@/lib/messaging/reply");
      db.insert(schema.leadMessages).values({ leadId: lead.id, direction: "inbound", channel: "messenger", content: "Hi", providerMessageId: "mid.in-1" }).run();
      const reply = await sendReply({ subjectType: "lead", subjectId: lead.id, text: "", attachments: [file("file", "application/pdf", "menu.pdf")] });
      ok(reply.channel === "messenger" && posted.length === 1 && !!posted[0].form && reply.failed.length === 0, "sendReply: the file goes on Messenger");
    });
    console.log(`dm send: ${n} checks passed.`);
  } finally {
    if (prevApproved === undefined) delete process.env.META_HUMAN_AGENT_APPROVED;
    else process.env.META_HUMAN_AGENT_APPROVED = prevApproved;
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  scratch.cleanup();
  process.exit(1);
});
