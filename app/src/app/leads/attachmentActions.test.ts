// Run: npm test -- src/app/leads/attachmentActions.test.ts
//
// The message-box actions that take attachment tickets, on a scratch business
// with a stand-in WhatsApp bridge and stand-in tickets:
// - addLeadNoteAction keeps the files on the note row and sends nothing;
// - sendLeadWhatsAppAction and sendClientWhatsAppAction hand the files to
//   sendWhatsApp and return the refused ones in `failed`;
// - a bad ticket refuses the whole send before anything goes;
// - every action without tickets behaves as before.
import Module from "node:module";
import type { OutgoingMediaFile } from "@/lib/whatsapp/types";

type Call = { kind: "text"; to: string; text: string } | { kind: "media"; to: string; file: OutgoingMediaFile };
let calls: Call[] = [];
const refuseNames = new Set<string>();
let seq = 0;
const fakeBridge = () => ({
  sendText: async (to: string, text: string) => {
    calls.push({ kind: "text", to, text });
    return { providerMessageId: `t-${++seq}` };
  },
  sendMedia: async (to: string, file: OutgoingMediaFile) => {
    if (file.name && refuseNames.has(file.name)) throw new Error("WhatsApp send failed (413): too large");
    calls.push({ kind: "media", to, file });
    return { providerMessageId: `m-${++seq}` };
  },
});
const fakeFiles = new Map<string, unknown>();

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/whatsapp") return { isWhatsAppConfigured: () => true, getWhatsAppBridge: () => fakeBridge() };
  if (request === "@/lib/auth") {
    return { requireUser: async () => ({ id: 1, name: "Aoife Staff" }), requireAdmin: async () => ({ id: 1 }), getCurrentMembership: async () => null };
  }
  if (request === "@/lib/leadScore") return { scoreLead: async () => null };
  if (request === "@/lib/attachments/load") {
    return {
      loadAttachments: (tokens: string[] | undefined) =>
        (tokens ?? []).map((t) => {
          const f = fakeFiles.get(t);
          if (!f) throw new Error("That attachment has expired. Attach it again.");
          return f;
        }),
    };
  }
  return realLoad.call(this, request, ...rest);
};

import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";

import type { MessageMedia } from "@/lib/inbox/mediaModel";
import type { OutgoingFile } from "@/lib/attachments/outgoingModel";

const SLUG = "attach-actions-test";

let fileSeq = 0;
function file(kind: MessageMedia["kind"], mime: string, name?: string): OutgoingFile {
  const hex = (++fileSeq).toString(16).padStart(32, "0");
  const bytes = Buffer.from(`bytes of ${name ?? kind}`);
  return { media: { kind, file: `${hex}.bin`, mime, ...(name ? { name } : {}), size: bytes.length }, bytes };
}

(async () => {
  const { runWithTenant } = await import("@/lib/db/tenant");
  const { db } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { makeScratchTenant } = await import("@/lib/leadFlows/testing/harness");
  const { parseMedia } = await import("@/lib/inbox/mediaModel");
  fs.rmSync(path.join(process.cwd(), "data", "tenants", SLUG), { recursive: true, force: true });
  const scratch = makeScratchTenant(SLUG);
  const { addLeadNoteAction, sendLeadWhatsAppAction } = await import("@/app/leads/actions");
  const { sendClientWhatsAppAction } = await import("@/app/clients/actions");

  let n = 0;
  const ok = (c: boolean, m: string) => {
    assert.ok(c, m);
    n++;
  };

  const pdf = file("file", "application/pdf", "price-list.pdf");
  const jpg = file("image", "image/jpeg", "room.jpg");
  const big = file("video", "video/mp4", "tour.mp4");
  fakeFiles.set("tok-pdf", pdf);
  fakeFiles.set("tok-jpg", jpg);
  fakeFiles.set("tok-big", big);

  try {
    await runWithTenant(scratch.tid, async () => {
      const [lead] = db.insert(schema.leads).values({ source: "whatsapp", firstName: "Example", phone: "087 000 0001" }).returning().all();
      const [client] = db.insert(schema.clients).values({ firstName: "Client", lastName: "Example", phone: "+353870000002" }).returning().all();
      const leadRows = () => db.select().from(schema.leadMessages).where(eq(schema.leadMessages.leadId, lead.id)).orderBy(asc(schema.leadMessages.id)).all();

      // ── Team note ──
      calls = [];
      const n1 = await addLeadNoteAction(lead.id, "Their plan", ["tok-pdf", "tok-jpg"]);
      ok(n1.ok, `note with files saved: ${JSON.stringify(n1)}`);
      const note1 = leadRows().find((r) => n1.ok && r.id === n1.messageId);
      ok(note1?.direction === "note" && note1.content === "Aoife: Their plan", "note keeps the author and text");
      const m1 = parseMedia(note1?.media);
      ok(m1.length === 2 && m1[0].name === "price-list.pdf" && m1[1].name === "room.jpg", "both files on the note row, in order");
      ok(calls.length === 0, "a note sends nothing");

      const n2 = await addLeadNoteAction(lead.id, "  ", ["tok-pdf"]);
      const note2 = leadRows().find((r) => n2.ok && r.id === n2.messageId);
      ok(n2.ok && note2?.content === "Aoife: [File]" && parseMedia(note2?.media).length === 1, "files alone make a note with a placeholder");

      const before = leadRows().length;
      const n3 = await addLeadNoteAction(lead.id, "x", ["tok-gone"]);
      ok(!n3.ok && n3.error === "That attachment has expired. Attach it again." && leadRows().length === before, "bad ticket: refused, nothing stored");
      const n4 = await addLeadNoteAction(lead.id, "");
      ok(!n4.ok && n4.error === "Write the note first.", "no words and no files still refused");
      const n5 = await addLeadNoteAction(lead.id, "Words only");
      const note5 = leadRows().find((r) => n5.ok && r.id === n5.messageId);
      ok(n5.ok && note5?.media === null, "text-only note unchanged");

      // ── Lead WhatsApp ──
      calls = [];
      const w1 = await sendLeadWhatsAppAction(lead.id, "Here you go", undefined, ["tok-pdf", "tok-jpg"]);
      ok(w1.ok && w1.failed.length === 0, `lead WhatsApp with files sent: ${JSON.stringify(w1)}`);
      ok(calls.length === 3 && calls[0].kind === "text" && calls[1].kind === "media" && calls[2].kind === "media", "text then each file");
      ok(calls[1].kind === "media" && calls[1].file.name === "price-list.pdf" && calls[1].file.bytes.equals(pdf.bytes), "the bridge gets the file's bytes");

      refuseNames.add("tour.mp4");
      calls = [];
      const w2 = await sendLeadWhatsAppAction(lead.id, "", undefined, ["tok-big", "tok-jpg"]);
      ok(w2.ok && w2.failed.length === 1 && /^tour\.mp4: /.test(w2.failed[0]), "the refused file comes back in failed");
      const failedRow = leadRows().find((r) => r.status === "failed");
      ok(!!failedRow && !!failedRow.error && parseMedia(failedRow.media)[0]?.name === "tour.mp4", "refused file stored failed with its reason");

      calls = [];
      const w3 = await sendLeadWhatsAppAction(lead.id, "Hi", undefined, ["tok-gone"]);
      ok(!w3.ok && w3.error === "That attachment has expired. Attach it again." && calls.length === 0, "bad ticket: nothing sent");

      const w4 = await sendLeadWhatsAppAction(lead.id, "Just words");
      ok(w4.ok && w4.failed.length === 0 && calls.length === 1 && calls[0].kind === "text", "text-only unchanged");

      // ── Client WhatsApp ──
      calls = [];
      const c1 = await sendClientWhatsAppAction(client.id, "", ["tok-jpg"]);
      ok(c1.ok && c1.failed.length === 0 && calls.length === 1 && calls[0].kind === "media", "client WhatsApp: a file alone goes");
      const crow = db.select().from(schema.clientMessages).where(eq(schema.clientMessages.clientId, client.id)).all();
      ok(crow.length === 1 && parseMedia(crow[0].media)[0]?.name === "room.jpg", "client file row carries its media");
      const c2 = await sendClientWhatsAppAction(client.id, "Hello");
      ok(c2.ok && c2.failed.length === 0, "client text-only unchanged");
    });
    console.log(`attachment actions: ${n} checks passed.`);
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
