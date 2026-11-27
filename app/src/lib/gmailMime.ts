/**
 * The raw RFC 5322 message Gmail's send API takes. Pure (no fetch, no DB, no
 * `server-only`) so it can be tested byte for byte.
 *
 * With no attachments the message is exactly what it has always been: one
 * base64 text/html body. With attachments it becomes multipart/mixed, the
 * html part first, then one base64 part per file.
 */

import type { EmailAttachment } from "@/lib/email/attachments";

export function encodeHeaderWord(value: string): string {
  // RFC 2047 encode when non-ASCII, else pass through.
  return /[^\x00-\x7F]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

/** Base64 in lines of at most 76 characters, CRLF between lines (RFC 2045). */
export function base64Lines(buf: Buffer): string {
  const b64 = buf.toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join("\r\n");
}

/** A header-safe quoted string: no CR/LF/NUL, quotes and backslashes escaped. */
function quoted(value: string): string {
  return `"${value.replace(/[\r\n\0]/g, "").replace(/(["\\])/g, "\\$1")}"`;
}

/** RFC 5987 / 2231 ext-value: UTF-8''<percent-encoded>. */
function extValue(value: string): string {
  const pct = encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `UTF-8''${pct}`;
}

/**
 * The Content-Type and Content-Disposition lines for one file. An ASCII name
 * goes as a plain quoted string; a non-ASCII name as an RFC 2047 encoded word
 * (what most mail apps read) plus an RFC 2231 `filename*` (what the standard
 * says), so it arrives with its real name everywhere.
 */
export function attachmentHeaders(att: Pick<EmailAttachment, "filename" | "mime">): string[] {
  const name = att.filename.replace(/[\r\n\0]/g, "").trim() || "attachment";
  const mime = att.mime.replace(/[^\w.+\-/]/g, "") || "application/octet-stream";
  const ascii = !/[^\x20-\x7E]/.test(name);
  const shown = ascii ? quoted(name) : quoted(encodeHeaderWord(name));
  return [
    `Content-Type: ${mime}; name=${shown}`,
    ascii
      ? `Content-Disposition: attachment; filename=${shown}`
      : `Content-Disposition: attachment; filename=${shown}; filename*=${extValue(name)}`,
    "Content-Transfer-Encoding: base64",
  ];
}

export function newMimeBoundary(): string {
  const rand = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  return `=_aa_${rand}`;
}

export function buildMime(opts: {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string;
  attachments?: EmailAttachment[];
  /** Fixed boundary for tests; random otherwise. */
  boundary?: string;
}): string {
  const attachments = opts.attachments ?? [];
  if (attachments.length === 0) {
    // Byte-identical to the single-part message sent before attachments existed.
    const headers = [
      `From: ${encodeHeaderWord(opts.fromName)} <${opts.fromEmail}>`,
      `To: ${opts.to}`,
      `Subject: ${encodeHeaderWord(opts.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    ];
    if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    if (opts.references) headers.push(`References: ${opts.references}`);
    const body = Buffer.from(opts.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    return `${headers.join("\r\n")}\r\n\r\n${body}`;
  }

  const boundary = opts.boundary ?? newMimeBoundary();
  const headers = [
    `From: ${encodeHeaderWord(opts.fromName)} <${opts.fromEmail}>`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  const parts: string[] = [
    [
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(Buffer.from(opts.html, "utf8")),
    ].join("\r\n"),
    ...attachments.map((att) => [...attachmentHeaders(att), "", base64Lines(att.content)].join("\r\n")),
  ];

  return (
    `${headers.join("\r\n")}\r\n\r\n` +
    parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("") +
    `--${boundary}--\r\n`
  );
}

/**
 * The body for Gmail's media-upload send endpoint
 * (`/upload/gmail/v1/users/me/messages/send?uploadType=multipart`), used when
 * a message carries files: the plain JSON endpoint caps the request at a few
 * MB, the upload endpoint takes up to 35 MB. Part one is the JSON metadata
 * (the thread, when replying), part two the raw message.
 */
export function gmailUploadBody(mime: string, threadId: string | undefined, boundary: string): string {
  const meta = JSON.stringify(threadId ? { threadId } : {});
  return (
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n${mime}\r\n` +
    `--${boundary}--`
  );
}
