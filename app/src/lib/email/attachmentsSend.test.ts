// Run: npm test -- src/lib/email/attachmentsSend.test.ts
//
// Files on one-to-one email, through all four senders on a scratch business:
// Gmail (upload endpoint, multipart/mixed message), the Mailgun route (one
// `attachment` form field per file), SMTP (nodemailer attachments) and Resend
// (attachments array). A text-only send goes exactly as before. A set over
// 18 MB is refused before anything is sent. The sent files are noted on the
// stored rows: client_emails, lead_messages and the inbox's email_messages.
// Every provider is a stand-in: nothing leaves the machine.
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;

type SentMail = Record<string, unknown>;
const smtpSent: SentMail[] = [];
const resendSent: SentMail[] = [];
let scratchTenant: { id: number; slug: string; name: string; dbFile: string; isActive: boolean; createdAt: Date } | null = null;
const fakeFiles = new Map<string, unknown>();

mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "nodemailer") {
    return {
      createTransport: () => ({
        sendMail: async (opts: SentMail) => {
          smtpSent.push(opts);
          return { messageId: `<smtp${smtpSent.length}@mail.test>` };
        },
        close: () => undefined,
      }),
    };
  }
  if (request === "resend") {
    return {
      Resend: class {
        emails = {
          send: async (opts: SentMail) => {
            resendSent.push(opts);
            return { data: { id: `re_${resendSent.length}` }, error: null };
          },
        };
      },
    };
  }
  if (request === "@/lib/db/tenant") {
    const real = realLoad.call(this, request, ...rest) as Record<string, unknown>;
    return new Proxy(real, {
      get(t, k) {
        if (k === "getCurrentTenant") {
          return () => {
            if (!scratchTenant) throw new Error("no tenant");
            return scratchTenant;
          };
        }
        return t[k as string];
      },
    });
  }
  if (request === "@/lib/auth") {
    return { requireUser: async () => ({ id: 1 }), requireAdmin: async () => ({ id: 1 }), getCurrentMembership: async () => null };
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
import { eq } from "drizzle-orm";

import type { MessageMedia } from "@/lib/inbox/mediaModel";
import type { OutgoingFile } from "@/lib/attachments/outgoingModel";

// Everything from the app is loaded AFTER the stubs above are in place (a
// static import would be hoisted and load the real nodemailer first).
const SLUG = "email-attach-test";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let providerSeq = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, init });
  if (url.includes("gmail.googleapis.com")) {
    return new Response(JSON.stringify({ id: `g${++providerSeq}`, threadId: "t1" }), { status: 200 });
  }
  if (url.includes("mailgun.net")) {
    return new Response(JSON.stringify({ id: `<mg${++providerSeq}@mg.attach-test.ie>`, message: "Queued" }), { status: 200 });
  }
  return new Response("{}", { status: 500 });
}) as typeof fetch;

let seq = 0;
function file(kind: MessageMedia["kind"], mime: string, name: string | undefined, size: number): OutgoingFile {
  const hex = (++seq).toString(16).padStart(32, "0");
  const bytes = Buffer.alloc(size, 0x41 + seq);
  return { media: { kind, file: `${hex}.bin`, mime, ...(name ? { name } : {}), size }, bytes };
}

(async () => {
  const { getTenantDbById, runWithTenant } = await import("@/lib/db/tenant");
  const schema = await import("@/lib/db/schema");
  const { makeScratchTenant } = await import("@/lib/leadFlows/testing/harness");
  const { parseMedia } = await import("@/lib/inbox/mediaModel");
  const { OUTGOING_EMAIL_TOTAL_ERROR } = await import("@/lib/attachments/outgoingModel");
  const { controlSqlite } = await import("@/lib/db/control");
  fs.rmSync(path.join(process.cwd(), "data", "tenants", SLUG), { recursive: true, force: true });
  const scratch = makeScratchTenant(SLUG);
  scratchTenant = { id: scratch.tid, slug: SLUG, name: SLUG, dbFile: `tenants/${SLUG}/${SLUG}.db`, isActive: true, createdAt: new Date() };

  const { sendEmailForTenant, setEmailSender } = await import("@/lib/email");
  const { emailAttachmentsFrom } = await import("./attachments");
  const { saveGmailConnection, deleteGmailConnection } = await import("@/lib/gmail");
  const { saveImapConnection, deleteImapConnection } = await import("@/lib/imapEmail");
  const { setMailgunRoute } = await import("@/lib/mailgunRoute");
  const { mailgunMultipart } = await import("@/lib/marketing/sender/mailgun");
  const { sendClientEmail } = await import("@/lib/clientEmail");
  const { setSentEmailMedia } = await import("./sentMedia");
  const { sendLeadEmailAction } = await import("@/app/leads/actions");
  const { replyEmailAction } = await import("@/app/communication/actions");

  const tid = scratch.tid;
  const tdb = getTenantDbById(tid);
  let n = 0;
  const ok = (c: boolean, m: string) => {
    n++;
    assert.ok(c, m);
  };

  const pdf = file("file", "application/pdf", "Clár.pdf", 3000);
  const jpg = file("image", "image/jpeg", undefined, 1200);
  const two = emailAttachmentsFrom([pdf, jpg]);
  const big = emailAttachmentsFrom([file("video", "video/mp4", "a.mp4", 9 * 1024 * 1024), file("video", "video/mp4", "b.mp4", 9 * 1024 * 1024 + 1)]);
  const base = { to: "buyer@example.com", subject: "Your plan", html: "<p>Attached.</p>" };

  const prevMgKey = process.env.MAILGUN_API_KEY;
  const prevMgRegion = process.env.MAILGUN_REGION;
  const prevResend = process.env.RESEND_API_KEY;
  process.env.MAILGUN_API_KEY = "key-test";
  process.env.MAILGUN_REGION = "eu";

  try {
    await runWithTenant(tid, async () => {
      // ── Mailgun multipart builder. ──
      const fields = new URLSearchParams({ from: "A <a@x.ie>", to: "b@y.ie", subject: "S" });
      const mp = mailgunMultipart(fields, two);
      const atts = mp.getAll("attachment") as File[];
      ok(atts.length === 2, "one attachment field per file");
      ok(atts[0].name === "Clár.pdf" && atts[0].type === "application/pdf" && atts[0].size === 3000, "pdf named, typed, sized");
      ok(atts[1].name === "Photo.jpg" && atts[1].type === "image/jpeg", "unnamed photo goes as Photo.jpg");
      ok(mp.get("from") === "A <a@x.ie>" && mp.get("to") === "b@y.ie" && mp.get("subject") === "S", "other fields carried over");

      // ── Gmail. ──
      saveGmailConnection({ tenantId: tid, email: "info@gmail-attach.test", refreshToken: "r", accessToken: "a", expiresIn: 3600, scope: "gmail.send" });
      calls = [];
      let res = await sendEmailForTenant(tid, { ...base, attachments: two, gmailThread: { threadId: "thread-9" } });
      ok(res.ok, `gmail with files sent: ${JSON.stringify(res)}`);
      ok(calls.length === 1, "one Gmail call");
      ok(calls[0].url === "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart", "files go through the upload endpoint");
      const ct = new Headers(calls[0].init?.headers).get("content-type") ?? "";
      ok(/^multipart\/related; boundary=/.test(ct), "upload is multipart/related");
      const upBoundary = /^multipart\/related; boundary="([^"]+)"$/.exec(ct)?.[1] ?? "";
      ok(upBoundary.startsWith("=_aa_"), "upload boundary is quoted (it holds '=')");
      const upBody = String(calls[0].init?.body);
      ok(upBody.startsWith(`--${upBoundary}\r\n`), "upload body opens on the quoted boundary's value");
      ok(upBody.includes('{"threadId":"thread-9"}'), "thread carried in the metadata part");
      ok(upBody.includes("Content-Type: message/rfc822") && upBody.includes("multipart/mixed"), "raw multipart/mixed message inside");
      ok(upBody.includes("filename*=UTF-8''Cl%C3%A1r.pdf") && upBody.includes('filename="Photo.jpg"'), "both files named in the message");

      calls = [];
      res = await sendEmailForTenant(tid, base);
      ok(res.ok && calls.length === 1, "gmail text only sent");
      ok(calls[0].url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", "text only: the JSON endpoint as before");
      const raw = JSON.parse(String(calls[0].init?.body)).raw as string;
      const decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      ok(decoded.includes('Content-Type: text/html; charset="UTF-8"') && !decoded.includes("multipart"), "text only: single-part message as before");

      calls = [];
      res = await sendEmailForTenant(tid, { ...base, attachments: big });
      ok(!res.ok && res.error === OUTGOING_EMAIL_TOTAL_ERROR, "gmail: over 18 MB refused with the plain reason");
      ok(calls.length === 0, "gmail: nothing sent");
      deleteGmailConnection(tid);

      // ── Mailgun route (IMAP mailbox, SMTP unreachable). ──
      saveImapConnection({
        tenantId: tid, email: "info@attach-test.ie", imapHost: "imap.example.test", imapPort: 993, imapSecure: true,
        smtpHost: "smtp.example.test", smtpPort: 465, smtpSecure: true, username: "info@attach-test.ie", password: "pw",
      });
      tdb.insert(schema.sendingDomains).values({ domain: "mg.attach-test.ie", state: "verified", verifiedAt: new Date() }).run();
      setMailgunRoute(true);
      calls = [];
      res = await sendEmailForTenant(tid, { ...base, attachments: two });
      ok(res.ok, `mailgun with files sent: ${JSON.stringify(res)}`);
      ok(calls.length === 1 && calls[0].url === "https://api.eu.mailgun.net/v3/mg.attach-test.ie/messages", "through the verified domain");
      const mgForm = calls[0].init?.body;
      ok(mgForm instanceof FormData, "files: multipart form");
      const mgAtts = (mgForm as FormData).getAll("attachment") as File[];
      ok(mgAtts.length === 2 && mgAtts[0].name === "Clár.pdf" && mgAtts[1].name === "Photo.jpg", "one attachment field per file");
      ok((mgForm as FormData).get("o:tracking") === "no" && (mgForm as FormData).get("h:Reply-To") === "info@attach-test.ie", "one-to-one fields kept");
      const mgId = res.ok ? res.id : "";
      setSentEmailMedia(mgId, [pdf.media, jpg.media]);
      const mgRow = tdb.select().from(schema.emailMessages).where(eq(schema.emailMessages.gmailMessageId, mgId)).get();
      ok(parseMedia(mgRow?.media).length === 2, "files noted on the inbox row the route wrote");

      calls = [];
      res = await sendEmailForTenant(tid, base);
      ok(res.ok && calls.length === 1 && calls[0].init?.body instanceof URLSearchParams, "mailgun text only: url-encoded form as before");
      ok(!(calls[0].init?.body as URLSearchParams).has("attachment"), "no attachment field");

      calls = [];
      res = await sendEmailForTenant(tid, { ...base, attachments: big });
      ok(!res.ok && res.error === OUTGOING_EMAIL_TOTAL_ERROR && calls.length === 0, "mailgun: over 18 MB refused, nothing sent");

      // ── SMTP. ──
      setMailgunRoute(false);
      res = await sendEmailForTenant(tid, { ...base, attachments: two });
      ok(res.ok && smtpSent.length === 1, `smtp with files sent: ${JSON.stringify(res)}`);
      const smtpAtts = smtpSent[0].attachments as Array<{ filename: string; content: Buffer; contentType: string }>;
      ok(smtpAtts.length === 2, "two nodemailer attachments");
      ok(smtpAtts[0].filename === "Clár.pdf" && smtpAtts[0].contentType === "application/pdf" && smtpAtts[0].content.equals(pdf.bytes), "pdf as given");
      ok(smtpAtts[1].filename === "Photo.jpg" && smtpAtts[1].contentType === "image/jpeg", "photo as given");
      res = await sendEmailForTenant(tid, base);
      ok(res.ok && smtpSent.length === 2 && !("attachments" in smtpSent[1]), "smtp text only: no attachments key");
      res = await sendEmailForTenant(tid, { ...base, attachments: big });
      ok(!res.ok && res.error === OUTGOING_EMAIL_TOTAL_ERROR && smtpSent.length === 2, "smtp: over 18 MB refused, nothing sent");
      deleteImapConnection(tid);

      // ── Resend. ──
      process.env.RESEND_API_KEY = "re_test";
      setEmailSender({ fromName: "Attach Test", fromEmail: "hello@attach-test.ie", replyTo: "" });
      res = await sendEmailForTenant(tid, { ...base, attachments: two });
      ok(res.ok && resendSent.length === 1, "resend with files sent");
      const reAtts = resendSent[0].attachments as Array<{ filename: string; content: Buffer; contentType: string }>;
      ok(reAtts.length === 2 && reAtts[0].filename === "Clár.pdf" && reAtts[0].content.equals(pdf.bytes) && reAtts[1].contentType === "image/jpeg", "resend attachments");
      res = await sendEmailForTenant(tid, base);
      ok(res.ok && resendSent.length === 2 && !("attachments" in resendSent[1]), "resend text only: no attachments key");
      res = await sendEmailForTenant(tid, { ...base, attachments: big });
      ok(!res.ok && res.error === OUTGOING_EMAIL_TOTAL_ERROR && resendSent.length === 2, "resend: over 18 MB refused, nothing sent");

      // ── Client email (lib/clientEmail), through Resend. ──
      const clientId = tdb.insert(schema.clients).values({ firstName: "Aoife", lastName: "Test", email: "aoife@example.com", phone: "0870000001" }).returning({ id: schema.clients.id }).get().id;
      const c1 = await sendClientEmail(clientId, { subject: "Plan", body: "Here it is.", attachments: [pdf, jpg] });
      ok(c1.ok && resendSent.length === 3, "client email with files sent");
      ok((resendSent[2].attachments as unknown[]).length === 2, "client email carried both files");
      let rows = tdb.select().from(schema.clientEmails).where(eq(schema.clientEmails.clientId, clientId)).all();
      ok(rows.length === 1 && parseMedia(rows[0].media).map((m) => m.file).join() === [pdf.media.file, jpg.media.file].join(), "files noted on the client_emails row");
      const c2 = await sendClientEmail(clientId, { subject: "Only a file", body: "", attachments: [pdf] });
      ok(c2.ok, "files alone are an email");
      const c3 = await sendClientEmail(clientId, { subject: "Words", body: "Hello" });
      ok(c3.ok && !("attachments" in resendSent[4]), "text only unchanged");
      const c4 = await sendClientEmail(clientId, { subject: "Too big", body: "x", attachments: [file("video", "video/mp4", "a.mp4", 10 * 1024 * 1024), file("video", "video/mp4", "b.mp4", 9 * 1024 * 1024)] });
      ok(!c4.ok && c4.error === OUTGOING_EMAIL_TOTAL_ERROR && resendSent.length === 5, "over 18 MB refused, nothing sent");
      const c5 = await sendClientEmail(clientId, { subject: "Nothing", body: "" });
      ok(!c5.ok && c5.error === "Message is required.", "no words and no files still refused");
      rows = tdb.select().from(schema.clientEmails).where(eq(schema.clientEmails.clientId, clientId)).all();
      ok(rows.length === 3, "refused sends leave no row");
      ok(rows.find((r) => r.subject === "Words")?.media === null, "text-only row has no media");

      // ── Lead email (sendLeadEmailAction -> lead_messages), through Resend. ──
      fakeFiles.set("tok-pdf", pdf);
      fakeFiles.set("tok-jpg", jpg);
      const leadId = tdb.insert(schema.leads).values({ firstName: "Seán", lastName: "Lead", email: "sean@example.com" }).returning({ id: schema.leads.id }).get().id;
      const l1 = await sendLeadEmailAction(leadId, { subject: "Plan", text: "Here it is.", attachments: ["tok-pdf", "tok-jpg"] });
      ok(l1.ok && (resendSent[5].attachments as unknown[]).length === 2, "lead email with files sent");
      const lm = l1.ok ? tdb.select().from(schema.leadMessages).where(eq(schema.leadMessages.id, l1.messageId)).get() : undefined;
      ok(lm?.content === "Here it is." && parseMedia(lm?.media).length === 2, "files noted on the lead_messages row");
      const l2 = await sendLeadEmailAction(leadId, { subject: "Plan", text: "", attachments: ["tok-pdf"] });
      const lm2 = l2.ok ? tdb.select().from(schema.leadMessages).where(eq(schema.leadMessages.id, l2.messageId)).get() : undefined;
      ok(l2.ok && lm2?.content === "[File]" && parseMedia(lm2?.media).length === 1, "files alone: placeholder content + media");
      const l3 = await sendLeadEmailAction(leadId, { subject: "Plan", text: "Words only" });
      const lm3 = l3.ok ? tdb.select().from(schema.leadMessages).where(eq(schema.leadMessages.id, l3.messageId)).get() : undefined;
      ok(l3.ok && lm3?.media === null && !("attachments" in resendSent[7]), "text only unchanged");
      const l4 = await sendLeadEmailAction(leadId, { subject: "Plan", text: "x", attachments: ["tok-gone"] });
      ok(!l4.ok && l4.error === "That attachment has expired. Attach it again." && resendSent.length === 8, "bad ticket: refused, nothing sent");
      const l5 = await sendLeadEmailAction(leadId, { subject: "Plan", text: "" });
      ok(!l5.ok && l5.error === "Write the email first.", "no words and no files still refused");

      // ── Inbox reply (replyEmailAction -> email_messages), through SMTP. ──
      delete process.env.RESEND_API_KEY;
      saveImapConnection({
        tenantId: tid, email: "info@attach-test.ie", imapHost: "imap.example.test", imapPort: 993, imapSecure: true,
        smtpHost: "smtp.example.test", smtpPort: 465, smtpSecure: true, username: "info@attach-test.ie", password: "pw",
      });
      const inId = tdb.insert(schema.emailMessages).values({
        gmailMessageId: "<in1@example.com>", gmailThreadId: "<in1@example.com>", direction: "in",
        fromEmail: "buyer@example.com", toEmail: "info@attach-test.ie", subject: "Question", internalDate: new Date(),
      }).returning({ id: schema.emailMessages.id }).get().id;
      const before = smtpSent.length;
      const r1 = await replyEmailAction(inId, "See attached.", ["tok-pdf", "tok-jpg"]);
      ok(r1.ok && smtpSent.length === before + 1, "inbox reply with files sent");
      ok((smtpSent[before].attachments as unknown[]).length === 2 && smtpSent[before].subject === "Re: Question", "reply carried both files");
      const outRow = tdb.select().from(schema.emailMessages).where(eq(schema.emailMessages.gmailMessageId, `<smtp${before + 1}@mail.test>`)).get();
      ok(outRow?.direction === "out" && parseMedia(outRow?.media).length === 2, "files noted on the reply's email_messages row");
      const r2 = await replyEmailAction(inId, "", ["tok-pdf"]);
      ok(r2.ok, "files alone are a reply");
      const r3 = await replyEmailAction(inId, "", undefined);
      ok(!r3.ok && r3.error === "Write a reply first", "no words and no files still refused");
      const r4 = await replyEmailAction(inId, "Words only");
      const out4 = tdb.select().from(schema.emailMessages).where(eq(schema.emailMessages.gmailMessageId, `<smtp${smtpSent.length}@mail.test>`)).get();
      ok(r4.ok && out4?.media === null && !("attachments" in smtpSent[smtpSent.length - 1]), "text-only reply unchanged");
      deleteImapConnection(tid);
    });
    console.log(`email attachments: ${n} checks passed.`);
  } finally {
    if (prevMgKey === undefined) delete process.env.MAILGUN_API_KEY; else process.env.MAILGUN_API_KEY = prevMgKey;
    if (prevMgRegion === undefined) delete process.env.MAILGUN_REGION; else process.env.MAILGUN_REGION = prevMgRegion;
    if (prevResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevResend;
    try { deleteGmailConnection(scratch.tid); } catch { /* already gone */ }
    controlSqlite.prepare("DELETE FROM imap_connections WHERE tenant_id = ?").run(scratch.tid);
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
