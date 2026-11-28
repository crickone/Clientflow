// Pure spreadsheet reader: .xlsx and .csv to plain string grids, and a text
// view of a grid for the model. No tenant, no DB, no "server-only".
import JSZip from "jszip";
import { decodeXML } from "entities";

export type Sheet = { name: string; rows: string[][] };

/** A refusal with plain copy that is safe to show to the person. */
export class SheetReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetReadError";
  }
}

export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_CELLS = 200_000;
export const DEFAULT_MAX_CHARS = 60_000;
/**
 * Grid slots (cells, empty ones included, plus rows) a read may fill. Cells
 * are stored densely, so a few far-apart refs ("XFD1048576") would otherwise
 * make huge rows from a tiny file.
 */
export const MAX_GRID_SLOTS = 2_000_000;
/** Excel's own bounds, zero-based: column XFD, row 1,048,576. */
export const MAX_COL_INDEX = 16_383;
export const MAX_ROW_INDEX = 1_048_575;

export type ReadLimits = { maxUncompressedBytes?: number; maxCells?: number; maxGridSlots?: number };

const TOO_LARGE = "That spreadsheet is too large to read. Split it into smaller files and attach them again.";
const NOT_XLSX = "That file is not a valid .xlsx workbook. Save it as .xlsx from Excel and attach it again.";
const tooLarge = () => new SheetReadError(TOO_LARGE);

/** Counts cells and grid slots as a read fills them; throws the plain "too large" refusal past a limit. */
type Guard = { cell: () => void; grow: (slots: number) => void };

function makeGuard(limits: ReadLimits): Guard {
  const maxCells = limits.maxCells ?? MAX_CELLS;
  const maxSlots = limits.maxGridSlots ?? MAX_GRID_SLOTS;
  let cells = 0;
  let slots = 0;
  return {
    cell: () => {
      if (++cells > maxCells) throw tooLarge();
    },
    grow: (n) => {
      slots += n;
      if (slots > maxSlots) throw tooLarge();
    },
  };
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function colName(i: number): string {
  let n = Math.max(0, Math.floor(i)) + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "B3" -> { col: 1, row: 2 } (zero-based); null when it has no letters. */
function parseRef(ref: string): { col: number; row: number | null } | null {
  const m = /^([A-Za-z]+)(\d*)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: m[2] ? Number(m[2]) - 1 : null };
}

/** Trim trailing empty cells from each row and trailing empty rows. */
function tidy(rows: string[][]): string[][] {
  for (const row of rows) {
    while (row.length > 0 && row[row.length - 1] === "") row.pop();
  }
  while (rows.length > 0 && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

// ---------------------------------------------------------------- xlsx

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|[\\s])${name.replace(":", "\\:")}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  if (!m) return null;
  return decodeXML(m[2] ?? m[3] ?? "");
}

/** Concatenate every <t> text in a fragment (rich runs included, phonetic runs not). */
function textOf(fragment: string): string {
  const cleaned = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) out += decodeXML(m[1] ?? "");
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1] ?? ""));
  return out;
}

function cleanNumber(raw: string): string {
  const t = raw.trim();
  if (t === "") return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return String(+n.toPrecision(12));
}

function innerValue(inner: string): string | null {
  const m = /<v(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
  return m ? decodeXML(m[1] ?? "") : null;
}

function parseSheetXml(xml: string, shared: string[], guard: Guard): string[][] {
  const rows: string[][] = [];
  const cellRe = /<c(?=[\s>\/])([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const rowRe = /<row(?=[\s>\/])([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;
  let seqRow = -1;
  while ((rowMatch = rowRe.exec(xml))) {
    seqRow++;
    const rAttr = attr(rowMatch[1], "r");
    const rowIdx = rAttr && /^\d+$/.test(rAttr) ? Number(rAttr) - 1 : seqRow;
    if (rowIdx > MAX_ROW_INDEX) throw tooLarge();
    seqRow = rowIdx;
    const inner = rowMatch[2];
    if (inner === undefined) continue;
    let seqCol = -1;
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(inner))) {
      seqCol++;
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attr(attrs, "r");
      const parsed = ref ? parseRef(ref) : null;
      const col = parsed ? parsed.col : seqCol;
      if (col > MAX_COL_INDEX) throw tooLarge();
      seqCol = col;
      if (body === undefined) continue;
      const type = attr(attrs, "t") ?? "n";
      let value = "";
      if (type === "inlineStr") {
        value = textOf(body);
      } else {
        const v = innerValue(body);
        if (v !== null) {
          if (type === "s") value = shared[Number(v)] ?? "";
          else if (type === "b") value = v.trim() === "1" ? "TRUE" : "FALSE";
          else if (type === "n") value = cleanNumber(v);
          else value = v; // str, e, d
        }
      }
      if (value === "") continue;
      guard.cell();
      if (rows.length <= rowIdx) {
        guard.grow(rowIdx + 1 - rows.length);
        while (rows.length <= rowIdx) rows.push([]);
      }
      const row = rows[rowIdx];
      if (row.length <= col) {
        guard.grow(col + 1 - row.length);
        while (row.length <= col) row.push("");
      }
      row[col] = value;
    }
  }
  return tidy(rows);
}

/** Some writers prefix every element (<x:c>, </x:row>); drop the prefix so one set of patterns reads both. Attributes keep theirs (r:id). */
export function stripTagPrefixes(xml: string): string {
  return xml.replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, "<$1");
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = ("xl/" + target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

type EntryStream = {
  on(event: "data", cb: (chunk: Uint8Array) => void): EntryStream;
  on(event: "end", cb: () => void): EntryStream;
  on(event: "error", cb: (err: Error) => void): EntryStream;
  resume(): EntryStream;
  pause(): EntryStream;
};

/**
 * One zip entry inflated chunk by chunk. `count` sees each chunk's size
 * before it is kept and throws to stop the inflate there, so a zip bomb is
 * refused while it inflates, not after.
 */
function inflateEntry(file: JSZip.JSZipObject, count: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    // internalStream is jszip's public streaming API; its types leave it out.
    const stream = (file as unknown as { internalStream(type: "uint8array"): EntryStream }).internalStream("uint8array");
    stream.on("data", (chunk) => {
      if (settled) return;
      try {
        count(chunk.length);
      } catch (err) {
        settled = true;
        stream.pause();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", () => {
      // A broken or inconsistent entry (bad deflate data, a size that does not match).
      if (settled) return;
      settled = true;
      reject(new SheetReadError(NOT_XLSX));
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    stream.resume();
  });
}

export async function readXlsx(buf: Buffer, limits: ReadLimits = {}): Promise<Sheet[]> {
  const maxBytes = limits.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new SheetReadError(NOT_XLSX);
  }

  // Declared sizes first, so a zip bomb is refused before anything inflates.
  let declared = 0;
  zip.forEach((_path, file) => {
    const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === "number" && Number.isFinite(size)) declared += size;
  });
  if (declared > maxBytes) throw tooLarge();

  // Measured while each entry inflates: the declared sizes come from the
  // file itself and can lie.
  let measured = 0;
  const read = async (path: string): Promise<string | null> => {
    const f = zip.file(path);
    if (!f) return null;
    const text = await inflateEntry(f, (bytes) => {
      measured += bytes;
      if (measured > maxBytes) throw tooLarge();
    });
    return stripTagPrefixes(text);
  };

  const workbook = await read("xl/workbook.xml");
  if (workbook === null) throw new SheetReadError("That file has no workbook in it, so I cannot read it as a spreadsheet.");

  const relsXml = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship(?=[\s\/])([^>]*?)\/?>/g)) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) rels.set(id, target);
  }

  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const sheets: Sheet[] = [];
  const guard = makeGuard(limits);
  let index = 0;
  for (const m of workbook.matchAll(/<sheet(?=[\s\/])([^>]*?)\/?>/g)) {
    index++;
    const name = attr(m[1], "name") ?? `Sheet${index}`;
    const rid = attr(m[1], "r:id");
    const target = rid ? rels.get(rid) : undefined;
    const path = target ? resolveTarget(target) : `xl/worksheets/sheet${index}.xml`;
    const xml = await read(path);
    sheets.push({ name, rows: xml ? parseSheetXml(xml, shared, guard) : [] });
  }
  return sheets;
}

// ---------------------------------------------------------------- csv

/** Every field counts toward the grid slots and each filled one toward MAX_CELLS (the same plain refusal as xlsx). */
export function readCsv(text: string, limits: ReadLimits = {}): Sheet[] {
  const guard = makeGuard(limits);
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = count(";") > count(",") ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    guard.grow(1);
    if (field !== "") guard.cell();
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    guard.grow(1);
    rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delim) endField();
    else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  return [{ name: "Sheet1", rows: tidy(rows) }];
}

// ---------------------------------------------------------------- text view

export function sheetsToText(
  sheets: Sheet[],
  opts: { maxChars?: number; fromRow?: number; toRow?: number; sheet?: string } = {},
): { text: string; truncated: boolean } {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  let chosen = sheets;
  if (opts.sheet !== undefined) {
    const exact = sheets.filter((s) => s.name === opts.sheet);
    chosen = exact.length ? exact : sheets.filter((s) => s.name.toLowerCase() === opts.sheet!.toLowerCase());
  }

  const out: string[] = [];
  let used = 0;
  const add = (line: string): boolean => {
    const cost = line.length + (out.length ? 1 : 0);
    if (used + cost > maxChars) return false;
    out.push(line);
    used += cost;
    return true;
  };

  for (const sheet of chosen) {
    const cols = sheet.rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (out.length) add("");
    // The header always goes in, even when the cap is tiny.
    const header = `Sheet "${sheet.name}" (${sheet.rows.length} rows x ${cols} columns)`;
    if (!add(header)) {
      out.push(header);
      used += header.length + 1;
    }
    const from = Math.max(1, opts.fromRow ?? 1);
    const to = Math.min(sheet.rows.length, opts.toRow ?? sheet.rows.length);
    let last = from - 1;
    for (let r = from; r <= to; r++) {
      const cells: string[] = [];
      sheet.rows[r - 1].forEach((v, c) => {
        if (v !== "") cells.push(`${colName(c)}: ${v.replace(/\s*[\r\n]+\s*/g, " ")}`);
      });
      if (cells.length === 0) {
        last = r;
        continue;
      }
      if (!add(`${r} | ${cells.join(" | ")}`)) {
        out.push(`Cut off at row ${last} of ${sheet.rows.length} on sheet ${sheet.name}.`);
        return { text: out.join("\n"), truncated: true };
      }
      last = r;
    }
  }
  return { text: out.join("\n"), truncated: false };
}
