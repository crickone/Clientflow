/**
 * Files sent with a one-to-one email. Pure: no fs, no DB, no `server-only`,
 * so the four senders (Gmail, Mailgun route, SMTP, Resend) and their tests
 * share one shape and one size rule.
 *
 * A file arrives from the composer as an OutgoingFile (lib/attachments,
 * already checked for type and bytes); `emailAttachmentsFrom` turns it into
 * the provider-neutral `EmailAttachment` the senders take.
 */

import { attachmentLabel, checkOutgoingSet, type OutgoingFile } from "@/lib/attachments/outgoingModel";
import { classifyMime, type MessageMedia } from "@/lib/inbox/mediaModel";

export interface EmailAttachment {
  /** The name the recipient sees. */
  filename: string;
  mime: string;
  content: Buffer;
}

/** The file name an attachment goes out under: the sender's name, else "Photo.jpg", "File.pdf" and so on. */
export function emailAttachmentName(media: Pick<MessageMedia, "kind" | "mime" | "name">): string {
  const name = (media.name ?? "").replace(/[\r\n\0]/g, "").trim();
  if (name) return name.slice(0, 180);
  const { ext } = classifyMime(media.mime);
  return `${attachmentLabel({ kind: media.kind })}.${ext}`;
}

export function emailAttachmentsFrom(files: ReadonlyArray<OutgoingFile> | undefined): EmailAttachment[] {
  return (files ?? []).map((f) => ({
    filename: emailAttachmentName(f.media),
    mime: f.media.mime,
    content: f.bytes,
  }));
}

/**
 * Why a set of email attachments can't go, or null when it can: more than 5
 * files, a file over 16 MB, or more than 18 MB in total (the same rules and
 * copy the composer uses, lib/attachments/outgoingModel). Checked before
 * anything is sent.
 */
export function emailAttachmentsRefusal(attachments: ReadonlyArray<{ content: Buffer }> | undefined): string | null {
  if (!attachments || attachments.length === 0) return null;
  const check = checkOutgoingSet(
    attachments.map((a) => ({ size: a.content.length })),
    "email",
  );
  return check.ok ? null : check.error;
}
