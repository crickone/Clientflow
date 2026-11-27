// Run: npm test -- src/components/messaging/attachmentsModel.test.ts
//
// The message-box attachments refuse a bad file the moment it is picked,
// read the upload route's answer (including the non-JSON ones a proxy or a
// dropped connection gives), decide whether Send is ready, and word the line
// shown when some files did not go. After a send, only the files that went
// come off the tray: a refused file stays, and an expired ticket is marked as
// an error rather than left looking ready. All pure, so tested here.
import assert from "node:assert/strict";

import {
  composerReady,
  EXPIRED_CHIP_ERROR,
  failedFilesNote,
  trayAfterSend,
  parseUploadResponse,
  precheckFiles,
  readyTokens,
  type AttachmentItem,
} from "./attachmentsModel";
import {
  OUTGOING_EMPTY_ERROR,
  OUTGOING_TOO_BIG_ERROR,
  OUTGOING_TOO_MANY_ERROR,
  OUTGOING_TYPE_ERROR,
} from "@/lib/attachments/outgoingModel";

let checks = 0;
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = (a: unknown, b: unknown, msg: string) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

const MB = 1024 * 1024;
const item = (status: AttachmentItem["status"], token?: string): AttachmentItem => ({
  id: Math.random().toString(36),
  name: "x",
  size: 1,
  kind: "file",
  status,
  progress: status === "ready" ? 1 : 0,
  ...(token ? { token } : {}),
});

// ── precheck ────────────────────────────────────────────────────────────────

{
  const r = precheckFiles([], [
    { name: "plan.pdf", size: 1000, type: "application/pdf" },
    { name: "photo.jpg", size: 2000, type: "image/jpeg" },
    { name: "clip.mp4", size: 3 * MB, type: "video/mp4" },
    { name: "note.m4a", size: 3000, type: "audio/mp4" },
  ]);
  eq(r.map((x) => x.ok), [true, true, true, true], "allowed types pass");
  eq(r.map((x) => x.kind), ["file", "image", "video", "audio"], "kind per file");
}
{
  const [svg, exe, big, empty, notype] = precheckFiles([], [
    { name: "logo.svg", size: 100, type: "image/svg+xml" },
    { name: "setup.exe", size: 100, type: "application/octet-stream" },
    { name: "big.pdf", size: 16 * MB + 1, type: "application/pdf" },
    { name: "empty.pdf", size: 0, type: "application/pdf" },
    { name: "README", size: 10, type: "" },
  ]);
  eq(svg, { ok: false, kind: "file", error: OUTGOING_TYPE_ERROR }, "SVG refused");
  eq(exe.ok ? null : exe.error, OUTGOING_TYPE_ERROR, "exe refused");
  eq(big.ok ? null : big.error, OUTGOING_TOO_BIG_ERROR, "over 16 MB refused");
  eq(empty.ok ? null : empty.error, OUTGOING_EMPTY_ERROR, "empty refused");
  eq(notype.ok ? null : notype.error, OUTGOING_TYPE_ERROR, "no type, no extension refused");
}
{
  const exactly16 = precheckFiles([], [{ name: "a.pdf", size: 16 * MB, type: "application/pdf" }]);
  ok(exactly16[0].ok, "exactly 16 MB is allowed");
  const byExt = precheckFiles([], [{ name: "sheet.xlsx", size: 10, type: "" }]);
  ok(byExt[0].ok, "no browser type: falls back to the extension");
}
{
  // Cap: 3 live chips + 3 new -> 2 pass, the third is refused.
  const r = precheckFiles([item("ready"), item("uploading"), item("ready")], [
    { name: "a.pdf", size: 1, type: "application/pdf" },
    { name: "b.pdf", size: 1, type: "application/pdf" },
    { name: "c.pdf", size: 1, type: "application/pdf" },
  ]);
  eq(r.map((x) => x.ok), [true, true, false], "the sixth file is refused");
  eq(r[2].ok ? null : r[2].error, OUTGOING_TOO_MANY_ERROR, "with the 5-file copy");
}
{
  // Failed chips do not count towards the cap; refused new files don't take a slot.
  const r = precheckFiles([item("error"), item("error"), item("ready"), item("ready"), item("ready"), item("ready")], [
    { name: "bad.svg", size: 1, type: "image/svg+xml" },
    { name: "a.pdf", size: 1, type: "application/pdf" },
    { name: "b.pdf", size: 1, type: "application/pdf" },
  ]);
  eq(r.map((x) => x.ok), [false, true, false], "error chips free their slot; a refused file takes none");
}

// ── upload answers ──────────────────────────────────────────────────────────

{
  const media = { kind: "file", file: "abc.pdf", mime: "application/pdf", name: "plan.pdf", size: 10 };
  eq(
    parseUploadResponse(200, JSON.stringify({ ok: true, token: "t.s", media })),
    { ok: true, token: "t.s", media },
    "a good answer gives the ticket and the record",
  );
  eq(
    parseUploadResponse(400, JSON.stringify({ ok: false, error: "That file isn't what its name says. Attach a different file." })),
    { ok: false, error: "That file isn't what its name says. Attach a different file." },
    "the route's own refusal is passed through",
  );
  const proxy = parseUploadResponse(413, "<html><body>Request Entity Too Large</body></html>");
  ok(!proxy.ok && /16 MB/.test(proxy.error), "a proxy's HTML 413 becomes the size sentence");
  const dropped = parseUploadResponse(0, "");
  ok(!dropped.ok && /connection/.test(dropped.error), "a dropped connection says so");
  const signedOut = parseUploadResponse(401, "Unauthorized");
  ok(!signedOut.ok && /signed out/.test(signedOut.error), "signed out says so");
  const noToken = parseUploadResponse(200, JSON.stringify({ ok: true, media }));
  ok(!noToken.ok, "ok without a ticket is not trusted");
  const junk = parseUploadResponse(500, "oops");
  ok(!junk.ok && junk.error.length > 0, "anything else gets a plain sentence");
}

// ── send readiness and tickets ──────────────────────────────────────────────

ok(!composerReady("", []), "nothing to send");
ok(!composerReady("   ", []), "whitespace is nothing");
ok(composerReady("Hello", []), "text alone sends");
ok(composerReady("", [item("ready", "t1")]), "a ready file alone sends");
ok(!composerReady("Hello", [item("ready", "t1"), item("uploading")]), "never while a file is uploading");
ok(!composerReady("", [item("error")]), "a failed chip is not something to send");
ok(composerReady("Hi", [item("error")]), "text with a failed chip still sends");
eq(readyTokens([item("ready", "a"), item("error"), item("uploading"), item("ready", "b")]), ["a", "b"], "only ready tickets, in order");

// ── the not-sent line ───────────────────────────────────────────────────────

eq(failedFilesNote([]), null, "nothing failed: no line");
eq(failedFilesNote(undefined), null, "no list: no line");
eq(failedFilesNote(["plan.pdf: The file is too large"]), "Not sent: plan.pdf: The file is too large", "one file");
eq(
  failedFilesNote(["a.pdf: Too large", "Photo: Refused."]),
  "2 files were not sent. a.pdf: Too large. Photo: Refused.",
  "several files, each ends with a full stop",
);

// What a send does to the tray.
{
  const T0 = 1_000_000;
  const media = (file: string) => ({ kind: "file" as const, file, mime: "application/pdf", size: 1 });
  const sent = [
    { id: "a", media: media("a".repeat(32) + ".pdf"), expiresAt: T0 - 1 },
    { id: "b", media: media("b".repeat(32) + ".pdf"), expiresAt: T0 + 60_000 },
    { id: "c", media: media("c".repeat(32) + ".pdf"), expiresAt: T0 + 60_000 },
  ];
  const all = trayAfterSend(sent, { ok: true }, T0);
  eq(all.remove.join(","), "a,b,c", "all went: every sent chip comes off");
  const part = trayAfterSend(sent, { ok: true, failedFiles: ["b".repeat(32) + ".pdf"] }, T0);
  eq(part.remove.join(","), "a,c", "partial: the refused file stays");
  eq(part.expire.length, 0, "partial: nothing marked expired");
  const exp = trayAfterSend(sent, { ok: false, error: "That attachment has expired. Attach it again." }, T0);
  eq(exp.expire.join(","), "a", "expired: only the chip whose ticket ran out is marked");
  eq(exp.remove.length, 0, "expired: nothing taken off");
  const gone = trayAfterSend([sent[1], sent[2]], { ok: false, error: "That attachment has expired. Attach it again." }, T0);
  eq(gone.expire.join(","), "b,c", "expired but none look old (file gone): all sent chips marked");
  const other = trayAfterSend(sent, { ok: false, error: "WhatsApp is not connected." }, T0);
  eq(other.remove.length + other.expire.length, 0, "other refusal: tray left as it was");
  eq(EXPIRED_CHIP_ERROR, "Expired. Attach it again.", "expired chip copy");
}

console.log(`attachmentsModel: ${checks} checks passed`);
