/**
 * The rules for files staff send in a one-to-one chat (WhatsApp, Messenger,
 * Instagram, email, team notes): which types, how big, how many, and a cheap
 * check that the bytes are what the type says. Pure: no fs, no DB, no
 * `server-only`, so the composer imports it to refuse a file at once and the
 * upload route applies the same rules again on the server.
 *
 * Deliberately narrower than what the inbox KEEPS from inbound messages
 * (lib/inbox/mediaModel.ts): only the photo, document, video and audio types
 * every channel can deliver. SVG and executables are never sent.
 */

import { baseMime, classifyMime, type MediaKind, type MessageMedia } from "@/lib/inbox/mediaModel";

export const OUTGOING_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 16 * 1024 * 1024,
  maxEmailBytes: 20 * 1024 * 1024,
} as const;

export type OutgoingChannel = "whatsapp" | "messenger" | "instagram" | "email" | "note";

/** One file ready to go out on a channel: the stored record plus its bytes. */
export interface OutgoingFile {
  media: MessageMedia;
  bytes: Buffer;
}

export const OUTGOING_TYPE_ERROR =
  "That kind of file can't be sent. Send a photo, PDF, Word, Excel, PowerPoint, video or audio file.";
export const OUTGOING_TOO_BIG_ERROR = "That file is too big. Files can be up to 16 MB.";
export const OUTGOING_EMPTY_ERROR = "That file is empty.";
export const OUTGOING_TOO_MANY_ERROR = "You can attach up to 5 files.";
export const OUTGOING_EMAIL_TOTAL_ERROR = "Email attachments can be up to 20 MB in total.";
export const OUTGOING_MISMATCH_ERROR = "That file isn't what its name says. Attach a different file.";

/** The allowed types and the file extensions that name them. */
const ALLOWED: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "application/pdf": ["pdf"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-powerpoint": ["ppt"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "video/mp4": ["mp4"],
  "video/quicktime": ["mov"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a"],
  "audio/ogg": ["ogg", "oga", "opus"],
};

/** The value for a file input's `accept`, so the picker offers only what can be sent. */
export const OUTGOING_ACCEPT = [
  ...Object.keys(ALLOWED),
  ...Object.values(ALLOWED)
    .flat()
    .map((e) => `.${e}`),
].join(",");

/** File names that are refused whatever type the browser claims for them. */
const BLOCKED_EXTENSIONS = new Set([
  "svg", "svgz", "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "js", "mjs", "jse", "vbs", "vbe",
  "wsf", "ps1", "sh", "app", "dmg", "pkg", "jar", "apk", "html", "htm", "xhtml", "hta", "lnk", "reg",
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).trim().toLowerCase() : "";
}

function mimeForExtension(ext: string): string | null {
  for (const [mime, exts] of Object.entries(ALLOWED)) if (exts.includes(ext)) return mime;
  return null;
}

/**
 * Is this one file allowed out? The type is the browser's declared type,
 * falling back to the file extension when the browser gave none (or a vague
 * one). A CSV that Windows labels as Excel is taken as CSV.
 */
export function checkOutgoingFile(input: {
  name: string;
  size: number;
  mime: string;
}): { ok: true; kind: MediaKind; mime: string } | { ok: false; error: string } {
  const ext = extensionOf(input.name ?? "");
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, error: OUTGOING_TYPE_ERROR };

  let mime = baseMime(input.mime);
  if (!mime || mime === "application/octet-stream") mime = mimeForExtension(ext) ?? mime;
  if (mime === "application/vnd.ms-excel" && ext === "csv") mime = "text/csv";
  if (!ALLOWED[mime]) return { ok: false, error: OUTGOING_TYPE_ERROR };

  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false, error: OUTGOING_EMPTY_ERROR };
  if (input.size > OUTGOING_LIMITS.maxFileBytes) return { ok: false, error: OUTGOING_TOO_BIG_ERROR };

  const c = classifyMime(mime);
  return { ok: true, kind: c.kind, mime: c.mime };
}

function startsWith(head: Uint8Array, bytes: number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (head[offset + i] !== bytes[i]) return false;
  return true;
}

function ascii(s: string): number[] {
  return Array.from(s, (ch) => ch.charCodeAt(0));
}

const FTYP = ascii("ftyp");
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
/** Old QuickTime files can open with one of these atoms instead of ftyp. */
const QUICKTIME_ATOMS = ["ftyp", "moov", "mdat", "wide", "free", "skip"].map(ascii);

/**
 * Do the first bytes of the file match its type? `head` is the start of the
 * file (1 KB is plenty). An unknown type never matches.
 */
export function sniffMatches(mime: string, head: Uint8Array): boolean {
  switch (baseMime(mime)) {
    case "image/jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47]);
    case "image/gif":
      return startsWith(head, ascii("GIF8"));
    case "image/webp":
      return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8);
    case "application/pdf":
      return startsWith(head, ascii("%PDF"));
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return startsWith(head, ZIP);
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return startsWith(head, OLE);
    case "video/mp4":
    case "audio/mp4":
      return startsWith(head, FTYP, 4);
    case "video/quicktime":
      return QUICKTIME_ATOMS.some((a) => startsWith(head, a, 4));
    case "audio/mpeg":
      return startsWith(head, ascii("ID3")) || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xf0) === 0xf0);
    case "audio/ogg":
      return startsWith(head, ascii("OggS"));
    case "text/plain":
    case "text/csv": {
      const n = Math.min(head.length, 1024);
      for (let i = 0; i < n; i++) if (head[i] === 0) return false;
      return true;
    }
    default:
      return false;
  }
}

/**
 * The rules for the whole set on one message: at most 5 files, each within
 * the per-file cap, and for email no more than 20 MB together.
 */
export function checkOutgoingSet(
  files: ReadonlyArray<{ size: number }>,
  channel: OutgoingChannel,
): { ok: true } | { ok: false; error: string } {
  if (files.length > OUTGOING_LIMITS.maxFiles) return { ok: false, error: OUTGOING_TOO_MANY_ERROR };
  if (files.some((f) => f.size > OUTGOING_LIMITS.maxFileBytes)) return { ok: false, error: OUTGOING_TOO_BIG_ERROR };
  if (channel === "email") {
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > OUTGOING_LIMITS.maxEmailBytes) return { ok: false, error: OUTGOING_EMAIL_TOTAL_ERROR };
  }
  return { ok: true };
}
