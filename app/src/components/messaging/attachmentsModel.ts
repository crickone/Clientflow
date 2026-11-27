/**
 * The pure half of the message-box attachments: what a chip holds, the
 * instant client-side refusal (type, size, count) before anything uploads,
 * reading the upload route's answer, whether Send is ready, and the line
 * shown when some files did not go. No DOM, no React, so it is tested bare
 * (attachmentsModel.test.ts); useAttachments.ts drives it.
 */
import { checkOutgoingFile, OUTGOING_LIMITS, OUTGOING_TOO_MANY_ERROR } from "@/lib/attachments/outgoingModel";
import type { MediaKind, MessageMedia } from "@/lib/inbox/mediaModel";

export type AttachmentStatus = "uploading" | "ready" | "error";

export interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  kind: MediaKind;
  status: AttachmentStatus;
  /** 0 to 1 while uploading. */
  progress: number;
  /** The signed ticket the send action takes, once uploaded. */
  token?: string;
  /** The stored file's record, once uploaded. */
  media?: MessageMedia;
  error?: string;
}

export type Precheck = { ok: true; kind: MediaKind; mime: string } | { ok: false; kind: MediaKind; error: string };

/**
 * Check each picked file against the outgoing rules and the 5-file cap. A
 * chip that already failed does not count towards the cap, so removing it is
 * not needed to try another file. Files past the cap are refused, in order.
 */
export function precheckFiles(
  current: ReadonlyArray<Pick<AttachmentItem, "status">>,
  files: ReadonlyArray<{ name: string; size: number; type: string }>,
): Precheck[] {
  let live = current.filter((i) => i.status !== "error").length;
  return files.map((f) => {
    const check = checkOutgoingFile({ name: f.name, size: f.size, mime: f.type });
    if (!check.ok) return { ok: false, kind: "file", error: check.error };
    if (live >= OUTGOING_LIMITS.maxFiles) return { ok: false, kind: check.kind, error: OUTGOING_TOO_MANY_ERROR };
    live += 1;
    return { ok: true, kind: check.kind, mime: check.mime };
  });
}

export type UploadResult = { ok: true; token: string; media: MessageMedia } | { ok: false; error: string };

/**
 * Read the upload route's answer. A proxy can answer a too-big body with an
 * HTML page, and a dropped connection gives status 0, so anything that is not
 * the route's own JSON becomes a plain sentence.
 */
export function parseUploadResponse(status: number, body: string): UploadResult {
  if (status === 0) return { ok: false, error: "The upload stopped. Check the connection and attach it again." };
  let data: unknown = null;
  try {
    data = JSON.parse(body);
  } catch {
    data = null;
  }
  if (data && typeof data === "object") {
    const d = data as { ok?: unknown; token?: unknown; media?: unknown; error?: unknown };
    if (d.ok === true && typeof d.token === "string" && d.token && d.media && typeof d.media === "object") {
      return { ok: true, token: d.token, media: d.media as MessageMedia };
    }
    if (typeof d.error === "string" && d.error.trim()) return { ok: false, error: d.error };
  }
  if (status === 413) return { ok: false, error: "That file is too big. Files can be up to 16 MB." };
  if (status === 401) return { ok: false, error: "You were signed out. Sign in and attach it again." };
  return { ok: false, error: "That file could not be uploaded. Attach it again." };
}

/** Send is ready with text or at least one uploaded file, and never while a file is still uploading. */
export function composerReady(text: string, items: ReadonlyArray<Pick<AttachmentItem, "status">>): boolean {
  if (items.some((i) => i.status === "uploading")) return false;
  return text.trim().length > 0 || items.some((i) => i.status === "ready");
}

/** The tickets of the uploaded files, in the order they were added. */
export function readyTokens(items: ReadonlyArray<Pick<AttachmentItem, "status" | "token">>): string[] {
  return items.filter((i) => i.status === "ready" && i.token).map((i) => i.token as string);
}

/** The line shown when a send went but some files did not; null when everything went. */
export function failedFilesNote(failed: ReadonlyArray<string> | undefined): string | null {
  const lines = (failed ?? []).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length === 1) return `Not sent: ${lines[0]}`;
  return `${lines.length} files were not sent. ${lines.map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(" ")}`;
}
