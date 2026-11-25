/**
 * Photos, videos, voice notes and files on inbox messages: the shape stored in
 * lead_messages.media / client_messages.media (a JSON array), and the rules
 * for what is kept. Pure: no fs, no DB, no `server-only`, so the thread UI and
 * the plain-tsx tests import it too. The I/O lives in ./media.ts.
 */

export type MediaKind = "image" | "video" | "audio" | "file";

export interface MessageMedia {
  kind: MediaKind;
  /** Random file name in the business's private inbox-media folder. */
  file: string;
  mime: string;
  /** The sender's file name, when the channel gives one (documents). */
  name?: string;
  size: number;
}

/** Nothing larger than this is downloaded or kept. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/**
 * The types shown in the thread (image/video/audio) or offered as a download.
 * Anything else is still kept as a plain file (served as a download, never
 * rendered), as long as it is within the size cap. SVG is deliberately not an
 * image here: it can carry script.
 */
const KNOWN: Record<string, { kind: MediaKind; ext: string }> = {
  "image/jpeg": { kind: "image", ext: "jpg" },
  "image/png": { kind: "image", ext: "png" },
  "image/gif": { kind: "image", ext: "gif" },
  "image/webp": { kind: "image", ext: "webp" },
  "image/heic": { kind: "file", ext: "heic" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/webm": { kind: "video", ext: "webm" },
  "video/3gpp": { kind: "video", ext: "3gp" },
  "audio/ogg": { kind: "audio", ext: "ogg" },
  "audio/mpeg": { kind: "audio", ext: "mp3" },
  "audio/mp4": { kind: "audio", ext: "m4a" },
  "audio/aac": { kind: "audio", ext: "aac" },
  "audio/amr": { kind: "audio", ext: "amr" },
  "audio/wav": { kind: "audio", ext: "wav" },
  "audio/webm": { kind: "audio", ext: "weba" },
  "application/pdf": { kind: "file", ext: "pdf" },
  "application/msword": { kind: "file", ext: "doc" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "file", ext: "docx" },
  "application/vnd.ms-excel": { kind: "file", ext: "xls" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "file", ext: "xlsx" },
  "application/vnd.ms-powerpoint": { kind: "file", ext: "ppt" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "file", ext: "pptx" },
  "text/plain": { kind: "file", ext: "txt" },
  "text/csv": { kind: "file", ext: "csv" },
};

/** Lower-cased mime without parameters: "audio/ogg; codecs=opus" -> "audio/ogg". */
export function baseMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * What a stored file is. `known` is false for a type outside the list above:
 * it is kept as kind "file" with the extension "bin" and only ever downloaded.
 */
export function classifyMime(mime: string | null | undefined): { kind: MediaKind; ext: string; mime: string; known: boolean } {
  const m = baseMime(mime);
  const hit = KNOWN[m];
  if (hit) return { ...hit, mime: m, known: true };
  return { kind: "file", ext: "bin", mime: "application/octet-stream", known: false };
}

/** How a file is served: its type, and whether the browser shows it or downloads it. */
export function serveInfoForFile(file: string): { contentType: string; inline: boolean } {
  const ext = file.slice(file.lastIndexOf(".") + 1);
  for (const [mime, v] of Object.entries(KNOWN)) {
    if (v.ext === ext) return { contentType: mime, inline: v.kind !== "file" };
  }
  return { contentType: "application/octet-stream", inline: false };
}

/** A stored file name: 32 hex characters and a short extension. Anything else is refused. */
export function isSafeMediaFile(file: string): boolean {
  return /^[a-f0-9]{32}\.[a-z0-9]{1,5}$/.test(file);
}

export function mediaUrl(file: string): string {
  return `/api/inbox/media/${file}`;
}

/** The text kept on a message that has no words of its own, so search and AI triage still know. */
export function mediaPlaceholder(kind: MediaKind | "voice"): string {
  switch (kind) {
    case "image":
      return "[Photo]";
    case "video":
      return "[Video]";
    case "voice":
      return "[Voice note]";
    case "audio":
      return "[Audio]";
    default:
      return "[File]";
  }
}

/** True when the content is only the placeholder, so the thread shows the media without it. */
export function isMediaPlaceholder(content: string): boolean {
  return /^\[(Photo|Video|Voice note|Audio|File|Attachment|Document)\]$/.test(content.trim());
}

/** Read the stored JSON. Never throws; drops anything malformed. */
export function parseMedia(raw: string | null | undefined): MessageMedia[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: MessageMedia[] = [];
  for (const d of data) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    const kind = r.kind;
    if (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "file") continue;
    if (typeof r.file !== "string" || !isSafeMediaFile(r.file)) continue;
    out.push({
      kind,
      file: r.file,
      mime: typeof r.mime === "string" ? r.mime : "application/octet-stream",
      ...(typeof r.name === "string" && r.name ? { name: r.name } : {}),
      size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
    });
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file name from a URL path, when it has an extension (Meta file links end in the name). */
export function nameFromUrl(url: string): string | undefined {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return /\.[A-Za-z0-9]{1,5}$/.test(last) && last.length <= 120 ? last : undefined;
  } catch {
    return undefined;
  }
}
