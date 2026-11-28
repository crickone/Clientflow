import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getLibraryAsset, libraryFilePath } from "@/lib/image/library";
import {
  MAX_UNCOMPRESSED_BYTES,
  readCsv,
  readXlsx,
  SheetReadError,
  sheetsToText,
  type Sheet,
} from "@/lib/files/sheetReader";

/**
 * A file in the current business's library, read as text.
 *
 * The asset is looked up through the current tenant's DB (`getLibraryAsset`),
 * never by a filename the caller supplies, so one business cannot read
 * another's files. The type is decided from the stored extension first (the
 * upload route derives it from an allow-list, never from the uploaded name)
 * and the recorded mime type second.
 *
 * Reused by the Adonis `read_attached_file` tool and by the program-from-file
 * converter.
 */

/** Plain text files are cut at this many characters. */
export const MAX_TEXT_CHARS = 60_000;

export type LibraryFileRead =
  | {
      ok: true;
      name: string;
      kind: "spreadsheet" | "text";
      /** The parsed grids for a spreadsheet, null for a text file. */
      sheets: Sheet[] | null;
      /** The model-readable view: the grid as text, or the file's own text. */
      text: string;
      truncated: boolean;
    }
  | { ok: false; error: string };

export type LibraryFileView = { sheet?: string; fromRow?: number; toRow?: number };

const REFUSE_KINDS: Record<string, string> = {
  ".pdf": "PDF",
  ".docx": "Word",
  ".pptx": "PowerPoint",
};
const REFUSE_MIME: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
};
const TEXT_EXT = new Set([".txt", ".md", ".json"]);
const TEXT_MIME = new Set(["text/plain", "text/markdown", "application/json"]);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const NOT_FOUND = "I can't find that file in this business's library.";
const OLD_EXCEL = "That is an old Excel file (.xls). Save it as .xlsx from Excel and attach it again.";
const refusal = (kind: string) => `I can read spreadsheets (.xlsx, .csv) and text files, not ${kind} files yet.`;

export async function readLibraryFile(id: number, view: LibraryFileView = {}): Promise<LibraryFileRead> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: NOT_FOUND };
  const row = getLibraryAsset(id);
  if (!row) return { ok: false, error: NOT_FOUND };

  const name = row.originalName;
  const ext = path.extname(row.filename).toLowerCase();
  const mime = (row.mimeType || "").toLowerCase();

  if (row.kind === "image" || row.kind === "video") {
    return { ok: false, error: "That is a photo or video, not a file I can read." };
  }

  const refused = REFUSE_KINDS[ext] ?? REFUSE_MIME[mime];
  if (refused) return { ok: false, error: refusal(refused) };
  if (ext === ".xls" || mime === "application/vnd.ms-excel") return { ok: false, error: OLD_EXCEL };

  const isXlsx = ext === ".xlsx" || (!ext && mime === XLSX_MIME);
  const isCsv = ext === ".csv" || (!ext && mime === "text/csv");
  const isText = TEXT_EXT.has(ext) || (!ext && TEXT_MIME.has(mime));
  if (!isXlsx && !isCsv && !isText) {
    return { ok: false, error: "I can read spreadsheets (.xlsx, .csv) and text files, not that kind of file." };
  }

  const file = libraryFilePath(row.filename);
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return { ok: false, error: `The file "${name}" is missing from the library.` };
  }

  try {
    if (isXlsx) {
      if (size > MAX_UNCOMPRESSED_BYTES) throw new SheetReadError("That spreadsheet is too large to read. Split it into smaller files and attach them again.");
      const sheets = await readXlsx(fs.readFileSync(file));
      const { text, truncated } = sheetsToText(sheets, view);
      return { ok: true, name, kind: "spreadsheet", sheets, text, truncated };
    }
    if (isCsv) {
      if (size > MAX_UNCOMPRESSED_BYTES) throw new SheetReadError("That file is too large to read. Split it into smaller files and attach them again.");
      const sheets = readCsv(fs.readFileSync(file, "utf8"));
      const { text, truncated } = sheetsToText(sheets, view);
      return { ok: true, name, kind: "spreadsheet", sheets, text, truncated };
    }
    // Plain text: read only as much as could fit under the cap (4 bytes per
    // character at most), so a huge text file is never pulled into memory.
    const fd = fs.openSync(file, "r");
    let raw: string;
    try {
      const want = Math.min(size, MAX_TEXT_CHARS * 4 + 4);
      const buf = Buffer.alloc(want);
      const got = fs.readSync(fd, buf, 0, want, 0);
      raw = buf.subarray(0, got).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    const truncated = raw.length > MAX_TEXT_CHARS || size > MAX_TEXT_CHARS * 4 + 4;
    return { ok: true, name, kind: "text", sheets: null, text: raw.slice(0, MAX_TEXT_CHARS), truncated };
  } catch (err) {
    if (err instanceof SheetReadError) return { ok: false, error: err.message };
    throw err;
  }
}
