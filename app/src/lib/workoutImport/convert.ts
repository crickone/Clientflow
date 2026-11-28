import "server-only";

import fs from "node:fs";
import path from "node:path";

import type Anthropic from "@anthropic-ai/sdk";

import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import { AiCapError } from "@/lib/ai/usage";
import { getCurrentTenant } from "@/lib/db/tenant";
import { listExercises } from "@/lib/exerciseLibrary";
import { readLibraryFile } from "@/lib/files/libraryFile";
import { MAX_UNCOMPRESSED_BYTES, readCsv, readXlsx, SheetReadError, type Sheet } from "@/lib/files/sheetReader";
import { getProgram } from "@/lib/workout";

import { buildExerciseMatcher, programFromSheets, type Complete, type ImportResult } from "./model";

/**
 * The sheet-to-program converter's server side: the real, metered model call,
 * the current tenant's exercise-library lookup, and the two entry points
 * (a library file for the Adonis chat, an Upload program's file for the
 * "Build from this file" button). The two-pass logic itself is pure and
 * lives in ./model.
 */

export { programFromSheets } from "./model";
export type { Complete, ImportResult, MatchExercise } from "./model";

const AGENT_KEY = "workout-import";
const FAILED = "I couldn't build the program just now. Try again in a moment.";
const OLD_EXCEL = "That is an old Excel file (.xls). Save it as .xlsx from Excel and attach it again.";
const refusal = (kind: string) => `I can read spreadsheets (.xlsx, .csv) and text files, not ${kind} files yet.`;
const REFUSE_KINDS: Record<string, string> = { ".pdf": "PDF", ".doc": "Word", ".docx": "Word", ".ppt": "PowerPoint", ".pptx": "PowerPoint" };

/** Sonnet 5.5 through the metered chokepoint (gate, call, meter); text blocks joined. */
export function meteredWorkoutComplete(tenantId: number): Complete {
  return async ({ system, user, maxTokens }) => {
    // meteredCreate applies withThinkingHeadroom and the cap gate itself.
    const message = await meteredCreate({ tenantId, agentKey: AGENT_KEY }, () => ({
      model: MODELS.sonnet,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }));
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  };
}

/** The converter for the current tenant, with the cap message and other failures as plain errors. */
async function convert(sheets: Sheet[], title?: string): Promise<ImportResult> {
  const tenant = getCurrentTenant();
  try {
    return await programFromSheets(sheets, {
      complete: meteredWorkoutComplete(tenant.id),
      title,
      matchExercise: buildExerciseMatcher(listExercises()),
    });
  } catch (err) {
    if (err instanceof AiCapError) return { ok: false, error: err.message };
    console.error("[workout-import] failed:", err);
    return { ok: false, error: FAILED };
  }
}

/** A spreadsheet in the current business's library to a program draft. */
export async function importProgramFromLibraryFile(fileId: number): Promise<ImportResult> {
  const file = await readLibraryFile(fileId);
  if (!file.ok) return { ok: false, error: file.error };
  if (file.kind !== "spreadsheet" || !file.sheets) return { ok: false, error: "That file is not a spreadsheet." };
  return convert(file.sheets);
}

/** The uploaded file of an Upload-type program to a program draft. */
export async function importProgramFromUpload(programId: number): Promise<ImportResult> {
  if (!Number.isInteger(programId) || programId <= 0) return { ok: false, error: "I can't find that program." };
  const program = getProgram(programId);
  if (!program) return { ok: false, error: "I can't find that program." };
  if (!program.uploadFilename) return { ok: false, error: "That program has no uploaded file." };

  // Resolved as /api/workout/file does: basename only, inside this tenant's folder.
  const safe = path.basename(program.uploadFilename);
  const full = path.join(process.cwd(), "data", "tenants", getCurrentTenant().slug, "workout", safe);
  const ext = path.extname(safe).toLowerCase();
  if (ext === ".xls") return { ok: false, error: OLD_EXCEL };
  if (REFUSE_KINDS[ext]) return { ok: false, error: refusal(REFUSE_KINDS[ext]) };
  if (ext !== ".xlsx" && ext !== ".csv") return { ok: false, error: "I can build a program from a spreadsheet (.xlsx, .csv), not that kind of file." };

  let size: number;
  try {
    size = fs.statSync(full).size;
  } catch {
    return { ok: false, error: "The uploaded file is missing." };
  }
  let sheets: Sheet[];
  try {
    if (size > MAX_UNCOMPRESSED_BYTES) throw new SheetReadError("That spreadsheet is too large to read. Split it into smaller files and upload them again.");
    sheets = ext === ".xlsx" ? await readXlsx(fs.readFileSync(full)) : readCsv(fs.readFileSync(full, "utf8"));
  } catch (err) {
    if (err instanceof SheetReadError) return { ok: false, error: err.message };
    console.error("[workout-import] could not open upload:", err);
    return { ok: false, error: "I couldn't open that spreadsheet. Save it again as .xlsx or .csv and upload it again." };
  }
  // The coach's own program name wins over the sheet's, unless it was never set.
  const title = program.title.trim() && program.title.trim() !== "New Program" ? program.title : undefined;
  return convert(sheets, title);
}
