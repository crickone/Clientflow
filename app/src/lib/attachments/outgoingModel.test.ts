// Run: npm test -- src/lib/attachments/outgoingModel.test.ts
//
// The outgoing file rules: the type allowlist (and what is refused), the
// 16 MB per-file cap, 5 files per message, 18 MB per email, and the
// first-bytes check against the declared type.
import assert from "node:assert/strict";

import {
  OUTGOING_ACCEPT,
  OUTGOING_EMAIL_TOTAL_ERROR,
  OUTGOING_LIMITS,
  OUTGOING_TOO_BIG_ERROR,
  OUTGOING_TOO_MANY_ERROR,
  OUTGOING_TYPE_ERROR,
  checkOutgoingFile,
  checkOutgoingSet,
  sniffMatches,
} from "./outgoingModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const MB = 1024 * 1024;

// Limits, verbatim.
check("limits", OUTGOING_LIMITS.maxFiles === 5 && OUTGOING_LIMITS.maxFileBytes === 16 * MB && OUTGOING_LIMITS.maxEmailBytes === 18 * MB);

// Every allowed type is ok, with the kind it is shown as.
const allowed: Array<[string, string, string]> = [
  ["photo.jpg", "image/jpeg", "image"],
  ["photo.png", "image/png", "image"],
  ["photo.webp", "image/webp", "image"],
  ["anim.gif", "image/gif", "image"],
  ["plan.pdf", "application/pdf", "file"],
  ["old.doc", "application/msword", "file"],
  ["new.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "file"],
  ["old.xls", "application/vnd.ms-excel", "file"],
  ["new.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "file"],
  ["old.ppt", "application/vnd.ms-powerpoint", "file"],
  ["new.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "file"],
  ["notes.txt", "text/plain", "file"],
  ["list.csv", "text/csv", "file"],
  ["clip.mp4", "video/mp4", "video"],
  ["clip.mov", "video/quicktime", "video"],
  ["song.mp3", "audio/mpeg", "audio"],
  ["memo.m4a", "audio/mp4", "audio"],
  ["voice.ogg", "audio/ogg", "audio"],
];
for (const [name, mime, kind] of allowed) {
  const r = checkOutgoingFile({ name, size: 1000, mime });
  check(`${mime} allowed`, r.ok === true && r.kind === kind && r.mime === mime);
  check(`${mime} in accept`, OUTGOING_ACCEPT.includes(mime));
}

// Parameters and case on the mime are ignored.
const withParams = checkOutgoingFile({ name: "v.ogg", size: 10, mime: "Audio/OGG; codecs=opus" });
check("mime parameters stripped", withParams.ok && withParams.mime === "audio/ogg");

// Refused types, with the plain reason.
const refused: Array<[string, string]> = [
  ["logo.svg", "image/svg+xml"],
  ["logo.svg", "image/png"], // an svg name is refused whatever the browser claims
  ["setup.exe", "application/x-msdownload"],
  ["setup.exe", "application/pdf"],
  ["run.sh", "text/plain"],
  ["page.html", "text/html"],
  ["bundle.zip", "application/zip"],
  ["photo.heic", "image/heic"],
  ["clip.webm", "video/webm"],
  ["mystery", ""],
  ["mystery.bin", "application/octet-stream"],
];
for (const [name, mime] of refused) {
  const r = checkOutgoingFile({ name, size: 1000, mime });
  check(`${name} (${mime || "no type"}) refused`, r.ok === false && r.error === OUTGOING_TYPE_ERROR);
}

// No type from the browser: the extension decides.
const noType = checkOutgoingFile({ name: "Report.PDF", size: 10, mime: "" });
check("no type, .pdf -> pdf", noType.ok && noType.mime === "application/pdf");
const octet = checkOutgoingFile({ name: "memo.m4a", size: 10, mime: "application/octet-stream" });
check("octet-stream, .m4a -> audio/mp4", octet.ok && octet.mime === "audio/mp4" && octet.kind === "audio");
// Windows labels a CSV as Excel.
const winCsv = checkOutgoingFile({ name: "members.csv", size: 10, mime: "application/vnd.ms-excel" });
check("csv labelled as excel -> text/csv", winCsv.ok && winCsv.mime === "text/csv");

// Size.
check("exactly 16 MB ok", checkOutgoingFile({ name: "a.pdf", size: 16 * MB, mime: "application/pdf" }).ok);
const big = checkOutgoingFile({ name: "a.pdf", size: 16 * MB + 1, mime: "application/pdf" });
check("16 MB + 1 refused", !big.ok && big.error === OUTGOING_TOO_BIG_ERROR);
check("empty refused", !checkOutgoingFile({ name: "a.pdf", size: 0, mime: "application/pdf" }).ok);

// The set.
const five = Array.from({ length: 5 }, () => ({ size: 1000 }));
const six = Array.from({ length: 6 }, () => ({ size: 1000 }));
check("5 files ok", checkOutgoingSet(five, "whatsapp").ok);
for (const ch of ["whatsapp", "messenger", "instagram", "email", "note"] as const) {
  const r = checkOutgoingSet(six, ch);
  check(`6 files refused on ${ch}`, !r.ok && r.error === OUTGOING_TOO_MANY_ERROR);
}
check("no files ok", checkOutgoingSet([], "email").ok);
const twoBig = [{ size: 9 * MB }, { size: 9 * MB + 1 }];
const emailOver = checkOutgoingSet(twoBig, "email");
check("email over 18 MB total refused", !emailOver.ok && emailOver.error === OUTGOING_EMAIL_TOTAL_ERROR);
check("email exactly 18 MB ok", checkOutgoingSet([{ size: 9 * MB }, { size: 9 * MB }], "email").ok);
check("same 18 MB plus a byte on WhatsApp ok (no total rule)", checkOutgoingSet(twoBig, "whatsapp").ok);
check("one file over 16 MB in a set refused", !checkOutgoingSet([{ size: 16 * MB + 1 }], "note").ok);

// Sniff table.
const b = (...bytes: number[]) => new Uint8Array(bytes);
const s = (str: string, pad = 0) => new Uint8Array([...Array(pad).fill(0x20), ...Array.from(str, (c) => c.charCodeAt(0))]);
const ftyp = new Uint8Array([0, 0, 0, 0x18, ...Array.from("ftypisom", (c) => c.charCodeAt(0))]);
const ftypM4a = new Uint8Array([0, 0, 0, 0x20, ...Array.from("ftypM4A ", (c) => c.charCodeAt(0))]);
const moov = new Uint8Array([0, 0, 0, 0x18, ...Array.from("moov", (c) => c.charCodeAt(0))]);
const webp = new Uint8Array([...Array.from("RIFF", (c) => c.charCodeAt(0)), 1, 2, 3, 4, ...Array.from("WEBPVP8 ", (c) => c.charCodeAt(0))]);
const riffWav = new Uint8Array([...Array.from("RIFF", (c) => c.charCodeAt(0)), 1, 2, 3, 4, ...Array.from("WAVEfmt ", (c) => c.charCodeAt(0))]);
const zip = b(0x50, 0x4b, 0x03, 0x04, 0x14, 0);
const ole = b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1);
const pdf = s("%PDF-1.7");
const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const pptx = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const yes: Array<[string, Uint8Array]> = [
  ["image/jpeg", b(0xff, 0xd8, 0xff, 0xe0)],
  ["image/png", b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)],
  ["image/gif", s("GIF89a")],
  ["image/webp", webp],
  ["application/pdf", pdf],
  [docx, zip],
  [xlsx, zip],
  [pptx, zip],
  ["application/msword", ole],
  ["application/vnd.ms-excel", ole],
  ["application/vnd.ms-powerpoint", ole],
  ["video/mp4", ftyp],
  ["video/quicktime", ftyp],
  ["video/quicktime", moov],
  ["audio/mp4", ftypM4a],
  ["audio/mpeg", s("ID3\x04")],
  ["audio/mpeg", b(0xff, 0xfb, 0x90, 0x00)],
  ["audio/ogg", s("OggS")],
  ["text/plain", s("Hello there,\nsee you Tuesday.")],
  ["text/csv", s("name,phone\nMary,0861234567\n")],
];
for (const [mime, head] of yes) check(`sniff ${mime} matches`, sniffMatches(mime, head));

const no: Array<[string, Uint8Array]> = [
  ["image/png", pdf],
  ["image/jpeg", b(0x89, 0x50, 0x4e, 0x47)],
  ["image/gif", s("GIF7")],
  ["image/webp", riffWav],
  ["application/pdf", s(" %PDF", 0)],
  [docx, ole],
  ["application/msword", zip],
  ["video/mp4", moov],
  ["audio/mp4", pdf],
  ["audio/mpeg", b(0xff, 0xd8, 0xff)],
  ["audio/ogg", s("RIFF")],
  ["text/plain", b(0x48, 0x69, 0x00, 0x48)],
  ["text/csv", b(0x50, 0x4b, 0x03, 0x04, 0x00)],
  ["image/svg+xml", s("<svg")],
  ["application/zip", zip],
  ["image/png", b()],
];
for (const [mime, head] of no) check(`sniff ${mime} mismatch refused`, !sniffMatches(mime, head));

// A NUL after the first 1 KB does not count.
const longText = new Uint8Array(2048).fill(0x61);
longText[1500] = 0;
check("text: NUL past 1 KB ignored", sniffMatches("text/plain", longText));

console.log(`outgoing file rules: ${passed} checks passed.`);
