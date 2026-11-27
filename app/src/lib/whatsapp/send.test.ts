// Run: npm test -- src/lib/whatsapp/send.test.ts
//
// sendWhatsApp with files, on a scratch business with a stand-in bridge: the
// text goes first, then one message and one row per file (media on the row);
// a file the provider refuses is stored failed with its reason and the rest
// still go; nothing stored and an error thrown when nothing went; a text-only
// send behaves exactly as before. No real provider is reached.
import Module from "node:module";
import type { OutgoingMediaFile } from "./types";

type Call = { kind: "text"; to: string; text: string } | { kind: "media"; to: string; file: OutgoingMediaFile };
let calls: Call[] = [];
let failText = false;
let failNames = new Set<string>();
let withMedia = true;
let seq = 0;
const fakeBridge = () => ({
  sendText: async (to: string, text: string) => {
    if (failText) throw new Error("WhatsApp send failed (500): down");
    calls.push({ kind: "text", to, text });
    return { providerMessageId: `t-${++seq}` };
  },
  ...(withMedia
    ? {
        sendMedia: async (to: string, file: OutgoingMediaFile) => {
          if (file.name && failNames.has(file.name)) throw new Error("WhatsApp send failed (413): too large");
          calls.push({ kind: "media", to, file });
          return { providerMessageId: `m-${++seq}` };
        },
      }
    : {}),
});

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/whatsapp") return { isWhatsAppConfigured: () => true, getWhatsAppBridge: () => fakeBridge() };
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

fs.rmSync(path.join(process.cwd(), "data", "tenants", "wa-send-test"), { recursive: true, force: true });
const scratch = makeScratchTenant("wa-send-test");

let fileSeq = 0;
function file(kind: MessageMedia["kind"], mime: string, name?: string): OutgoingFile {
  const hex = (++fileSeq).toString(16).padStart(32, "0");
  const bytes = Buffer.from(`bytes of ${name ?? kind}`);
  return { media: { kind, file: `${hex}.bin`, mime, ...(name ? { name } : {}), size: bytes.length }, bytes };
}

(async () => {
  const { sendWhatsApp } = await import("./send");
  let n = 0;
  const ok = (c: boolean, m: string) => {
    assert.ok(c, m);
    n++;
  };
  try {
    await runWithTenant(scratch.tid, async () => {
      const [lead] = db.insert(schema.leads).values({ source: "whatsapp", firstName: "Example", phone: "087 000 0001" }).returning().all();
      const [client] = db.insert(schema.clients).values({ firstName: "Client", lastName: "Example", phone: "+353870000002" }).returning().all();
      const leadRows = () => db.select().from(schema.leadMessages).where(eq(schema.leadMessages.leadId, lead.id)).orderBy(asc(schema.leadMessages.id)).all();

      // Text only: as before.
      const t = await sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "  Hello there  " });
      let rows = leadRows();
      ok(rows.length === 1 && rows[0].content === "Hello there" && rows[0].status === "sent" && rows[0].media === null && rows[0].error === null, "text only: one row, no media, no error");
      ok(t.messageId === rows[0].id && t.providerMessageId === rows[0].providerMessageId && t.failed.length === 0, "text only: the same return fields, nothing failed");
      ok(calls.length === 1 && calls[0].kind === "text", "text only: one text send");

      // Text and two files: three messages, text first.
      calls = [];
      const pdf = file("file", "application/pdf", "price-list.pdf");
      const photo = file("image", "image/jpeg", "room.jpg");
      const r = await sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "Here you go", attachments: [pdf, photo] });
      rows = leadRows().slice(1);
      ok(calls.map((c) => c.kind).join() === "text,media,media", "text first, then each file");
      ok(rows.length === 3, "three rows");
      ok(rows[0].content === "Here you go" && rows[0].media === null, "the text row has no media");
      ok(parseMedia(rows[1].media)[0]?.file === pdf.media.file && parseMedia(rows[2].media)[0]?.file === photo.media.file, "each file row carries its own media");
      ok(rows[1].content === "[File]" && rows[2].content === "[Photo]", "file rows keep the placeholder the thread hides");
      ok(rows.every((x) => x.status === "sent" && x.direction === "outbound" && x.channel === "whatsapp" && x.providerMessageId), "all sent with provider ids");
      ok(r.messageId === rows[0].id && r.failed.length === 0, "returns the text's row");
      const sentDoc = calls[1].kind === "media" ? calls[1].file : null;
      ok(!!sentDoc && sentDoc.kind === "file" && sentDoc.name === "price-list.pdf" && sentDoc.mime === "application/pdf" && sentDoc.bytes.equals(pdf.bytes), "the bridge gets the file's kind, name, mime and bytes");

      // One file fails: its row is failed with the reason, the others go.
      calls = [];
      failNames = new Set(["big.mp4"]);
      const big = file("video", "video/mp4", "big.mp4");
      const audio = file("audio", "audio/mpeg", "note.mp3");
      const before = leadRows().length;
      const p = await sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "", attachments: [big, audio] });
      rows = leadRows().slice(before);
      ok(rows.length === 2, "both files have a row");
      ok(rows[0].status === "failed" && rows[0].providerMessageId === null && /413/.test(rows[0].error ?? "") && parseMedia(rows[0].media)[0]?.file === big.media.file, "the refused file: failed, reason kept, media kept");
      ok(rows[1].status === "sent" && rows[1].error === null, "the next file still went");
      ok(rows[0].id < rows[1].id, "rows stay in the order the files were attached");
      ok(p.messageId === rows[1].id && p.failed.length === 1 && p.failed[0].startsWith("big.mp4: "), "failed lists the file by name with the reason");
      ok(p.failedFiles.length === 1 && p.failedFiles[0] === big.media.file, "failedFiles names the refused file's stored name, in step with failed");
      ok(r.failedFiles.length === 0, "everything went: no failedFiles");

      // Nothing goes: throws, stores nothing.
      failNames = new Set(["a.pdf", "b.pdf"]);
      const beforeNone = leadRows().length;
      await assert.rejects(() => sendWhatsApp({ subjectType: "lead", subjectId: lead.id, attachments: [file("file", "application/pdf", "a.pdf"), file("file", "application/pdf", "b.pdf")] }), /Nothing was sent/);
      ok(leadRows().length === beforeNone, "nothing sent: nothing stored");
      failNames = new Set();

      // Empty message.
      await assert.rejects(() => sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "   " }), /Message is empty\./);
      await assert.rejects(() => sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "", attachments: [] }), /Message is empty\./);
      n += 2;

      // Text refused: throws before any file goes.
      calls = [];
      failText = true;
      await assert.rejects(() => sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "Hi", attachments: [file("image", "image/png", "x.png")] }), /down/);
      ok(calls.length === 0, "a refused text stops the files");
      failText = false;

      // Six files: refused before sending.
      calls = [];
      const six = Array.from({ length: 6 }, (_, i) => file("image", "image/png", `p${i}.png`));
      await assert.rejects(() => sendWhatsApp({ subjectType: "lead", subjectId: lead.id, attachments: six }), /up to 5 files/);
      ok(calls.length === 0, "six files: nothing sent");

      // A bridge that can't send files.
      withMedia = false;
      await assert.rejects(() => sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "Hi", attachments: [file("image", "image/png", "y.png")] }), /can't send files/);
      n++;
      const txt = await sendWhatsApp({ subjectType: "lead", subjectId: lead.id, text: "Still fine" });
      ok(txt.failed.length === 0, "text still sends on a bridge without files");
      withMedia = true;

      // Clients get the same.
      const c = await sendWhatsApp({ subjectType: "client", subjectId: client.id, text: "For you", attachments: [file("file", "application/pdf", "plan.pdf")] });
      const crow = db.select().from(schema.clientMessages).where(eq(schema.clientMessages.clientId, client.id)).orderBy(asc(schema.clientMessages.id)).all();
      ok(crow.length === 2 && crow[0].content === "For you" && parseMedia(crow[1].media)[0]?.name === "plan.pdf" && c.messageId === crow[0].id, "client: text row then file row");
    });
    console.log(`whatsapp send: ${n} checks passed.`);
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  scratch.cleanup();
  process.exit(1);
});
