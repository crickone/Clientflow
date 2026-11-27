// Run: npm test -- src/lib/gmailMime.test.ts
//
// The raw message Gmail sends. With no attachments it must stay byte for byte
// what it was before attachments existed (golden: a frozen copy of the old
// builder, plus one literal message). With files it is multipart/mixed: the
// html part first, then one base64 part per file in lines of 76, names
// encoded so a non-ASCII name survives. Pure: nothing is sent.
import assert from "node:assert/strict";

import { attachmentHeaders, base64Lines, buildMime, gmailUploadBody } from "./gmailMime";
import { emailAttachmentName, emailAttachmentsFrom, emailAttachmentsRefusal } from "./email/attachments";
import { OUTGOING_EMAIL_TOTAL_ERROR, OUTGOING_TOO_MANY_ERROR } from "./attachments/outgoingModel";

let n = 0;
const ok = (c: boolean, m: string) => {
  n++;
  assert.ok(c, m);
};

// ── Golden: the builder as it was before this change (commit 7dceeaa8), frozen. ──
function legacyEncodeHeaderWord(value: string): string {
  return /[^\x00-\x7F]/.test(value) ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=` : value;
}
function legacyBuildMime(opts: {
  fromName: string; fromEmail: string; to: string; subject: string; html: string; inReplyTo?: string; references?: string;
}): string {
  const headers = [
    `From: ${legacyEncodeHeaderWord(opts.fromName)} <${opts.fromEmail}>`,
    `To: ${opts.to}`,
    `Subject: ${legacyEncodeHeaderWord(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);
  const body = Buffer.from(opts.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

const cases = [
  { fromName: "Optimal Health", fromEmail: "info@oh.test", to: "a@b.test", subject: "Hello", html: "<p>Hi</p>" },
  { fromName: "Clínica Ó", fromEmail: "info@oh.test", to: "a@b.test, c@d.test", subject: "Fáilte — booking", html: "<p>Dia duit</p>" },
  { fromName: "X", fromEmail: "x@x.test", to: "y@y.test", subject: "Re: thread", html: "<p>" + "long ".repeat(200) + "</p>", inReplyTo: "<m1@x>", references: "<t1@x>" },
  // 57 bytes -> exactly 76 base64 chars: the old builder leaves a trailing CRLF; it must still.
  { fromName: "X", fromEmail: "x@x.test", to: "y@y.test", subject: "S", html: "a".repeat(57) },
  { fromName: "X", fromEmail: "x@x.test", to: "y@y.test", subject: "S", html: "" },
];
for (const [i, c] of cases.entries()) {
  ok(buildMime(c) === legacyBuildMime(c), `golden ${i}: no attachments is byte-identical`);
  ok(buildMime({ ...c, attachments: [] }) === legacyBuildMime(c), `golden ${i}: empty attachments is byte-identical`);
}
const literal =
  "From: Optimal Health <info@oh.test>\r\n" +
  "To: a@b.test\r\n" +
  "Subject: Hello\r\n" +
  "MIME-Version: 1.0\r\n" +
  'Content-Type: text/html; charset="UTF-8"\r\n' +
  "Content-Transfer-Encoding: base64\r\n" +
  "\r\n" +
  "PHA+SGk8L3A+";
ok(buildMime(cases[0]) === literal, "golden literal message");
ok(buildMime(cases[3]).endsWith("\r\n"), "76-char body keeps its trailing CRLF, as before");

// ── With two files. ──
const pdf = Buffer.alloc(200, 0x25);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const multi = buildMime({
  fromName: "Optimal Health",
  fromEmail: "info@oh.test",
  to: "a@b.test",
  subject: "Your plan",
  html: "<p>Attached.</p>",
  inReplyTo: "<m1@x>",
  references: "<t1@x>",
  boundary: "=_aa_test",
  attachments: [
    { filename: "plan.pdf", mime: "application/pdf", content: pdf },
    { filename: "photo.png", mime: "image/png", content: png },
  ],
});
const [head, rest] = [multi.slice(0, multi.indexOf("\r\n\r\n")), multi.slice(multi.indexOf("\r\n\r\n") + 4)];
ok(head.includes('Content-Type: multipart/mixed; boundary="=_aa_test"'), "top level is multipart/mixed");
ok(!head.includes("Content-Transfer-Encoding"), "no transfer encoding on the multipart container");
ok(head.includes("In-Reply-To: <m1@x>") && head.includes("References: <t1@x>"), "threading headers kept");
ok(head.startsWith("From: Optimal Health <info@oh.test>\r\nTo: a@b.test\r\nSubject: Your plan\r\nMIME-Version: 1.0"), "address headers as before");
const parts = rest.split("--=_aa_test");
ok(parts[0] === "", "body opens on the boundary");
ok(parts[parts.length - 1] === "--\r\n", "closing boundary");
const body = parts.slice(1, -1);
ok(body.length === 3, "html + 2 files");
ok(body[0].startsWith('\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n'), "html part first");
ok(Buffer.from(body[0].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8") === "<p>Attached.</p>", "html decodes");
ok(body[1].includes('Content-Type: application/pdf; name="plan.pdf"'), "pdf type + name");
ok(body[1].includes('Content-Disposition: attachment; filename="plan.pdf"'), "pdf disposition");
ok(body[1].includes("Content-Transfer-Encoding: base64"), "pdf base64");
const pdfB64 = body[1].split("\r\n\r\n")[1];
ok(pdfB64.split("\r\n").filter(Boolean).every((l) => l.length <= 76), "base64 lines at most 76");
ok(pdfB64.split("\r\n").filter(Boolean)[0].length === 76, "full lines are 76");
ok(Buffer.from(pdfB64.replace(/\r\n/g, ""), "base64").equals(pdf), "pdf bytes round trip");
ok(body[2].includes('Content-Type: image/png; name="photo.png"'), "png type + name");
ok(Buffer.from(body[2].split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").equals(png), "png bytes round trip");
ok(multi.split("\r\n").every((l) => l.length <= 998), "no line over the RFC 5322 limit");
ok(!/(^|[^\r])\n/.test(multi), "every line break is CRLF");

// A random boundary when none is given, never inside base64.
const rnd = buildMime({ ...cases[0], attachments: [{ filename: "a.txt", mime: "text/plain", content: Buffer.from("hi") }] });
const b = /boundary="([^"]+)"/.exec(rnd)?.[1] ?? "";
ok(/^=_aa_[a-z0-9]{24}$/.test(b), "random boundary shape");
ok(rnd.split(`--${b}`).length === 4, "boundary appears exactly at the 3 part edges");

// ── Names. ──
const irish = attachmentHeaders({ filename: "Clár ama — Fómhar.pdf", mime: "application/pdf" });
ok(/^Content-Type: application\/pdf; name="=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?="$/.test(irish[0]), "non-ASCII name as an encoded word");
ok(irish[1].includes(`filename*=UTF-8''Cl%C3%A1r%20ama%20%E2%80%94%20F%C3%B3mhar.pdf`), "non-ASCII name as RFC 2231 filename*");
const word = /B\?([^?]+)\?=/.exec(irish[0])?.[1] ?? "";
ok(Buffer.from(word, "base64").toString("utf8") === "Clár ama — Fómhar.pdf", "encoded word decodes to the real name");
ok(irish.every((l) => /^[\x20-\x7E]*$/.test(l)), "headers are pure ASCII");
const tricky = attachmentHeaders({ filename: 'my "best"\\plan\r\nBcc: x@y.pdf', mime: "application/pdf\r\nX: y" });
ok(tricky.every((l) => !/[\r\n]/.test(l)), "no header injection via CR/LF");
ok(tricky[0].includes('name="my \\"best\\"\\\\planBcc: x@y.pdf"'), "quotes and backslashes escaped");
ok(tricky[0].startsWith("Content-Type: application/pdfXy;"), "mime stripped to safe characters");
ok(attachmentHeaders({ filename: "  ", mime: "" })[0] === 'Content-Type: application/octet-stream; name="attachment"', "blank name and type fall back");

// ── base64Lines. ──
ok(base64Lines(Buffer.alloc(0)) === "", "empty");
ok(base64Lines(Buffer.alloc(57)).indexOf("\r\n") === -1, "exactly one line, no trailing CRLF");
ok(base64Lines(Buffer.alloc(58)).split("\r\n").length === 2, "two lines");

// ── Gmail upload body. ──
const up = gmailUploadBody("RAW", "thread-1", "up_b");
ok(
  up === '--up_b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"threadId":"thread-1"}\r\n--up_b\r\nContent-Type: message/rfc822\r\n\r\nRAW\r\n--up_b--',
  "upload body: metadata then the raw message",
);
ok(gmailUploadBody("RAW", undefined, "b").includes("\r\n\r\n{}\r\n"), "no thread -> empty metadata");

// ── emailAttachments helpers. ──
ok(emailAttachmentName({ kind: "file", mime: "application/pdf", name: " plan.pdf " }) === "plan.pdf", "sender's name kept, trimmed");
ok(emailAttachmentName({ kind: "image", mime: "image/jpeg" }) === "Photo.jpg", "no name: Photo.jpg");
ok(emailAttachmentName({ kind: "file", mime: "application/pdf", name: "" }) === "File.pdf", "blank name: File.pdf");
ok(emailAttachmentName({ kind: "file", mime: "text/plain", name: "a\r\nb.txt" }) === "ab.txt", "CR/LF dropped from names");
const from = emailAttachmentsFrom([
  { media: { kind: "file", file: "a".repeat(32) + ".pdf", mime: "application/pdf", name: "x.pdf", size: 3 }, bytes: Buffer.from("abc") },
]);
ok(from.length === 1 && from[0].filename === "x.pdf" && from[0].mime === "application/pdf" && from[0].content.toString() === "abc", "OutgoingFile -> EmailAttachment");
ok(emailAttachmentsFrom(undefined).length === 0, "none -> []");
const mb = 1024 * 1024;
const att = (size: number) => ({ content: Buffer.alloc(size) });
ok(emailAttachmentsRefusal(undefined) === null && emailAttachmentsRefusal([]) === null, "no files: nothing to refuse");
ok(emailAttachmentsRefusal([att(10 * mb), att(10 * mb)]) === null, "exactly 20 MB ok");
ok(emailAttachmentsRefusal([att(10 * mb), att(10 * mb + 1)]) === OUTGOING_EMAIL_TOTAL_ERROR, "over 20 MB refused");
ok(emailAttachmentsRefusal([att(1), att(1), att(1), att(1), att(1), att(1)]) === OUTGOING_TOO_MANY_ERROR, "6 files refused");

console.log(`gmailMime: ${n} checks passed.`);
