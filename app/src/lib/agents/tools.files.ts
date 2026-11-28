import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { readLibraryFile } from "@/lib/files/libraryFile";
import { importProgramFromLibraryFile, type ImportResult } from "@/lib/workoutImport/convert";
import type { ProgramInput } from "@/lib/workoutModel";
import { fenceUntrusted, type ToolContext, type ToolResult } from "@/lib/agents/toolKit";

/**
 * Reading a file the operator attached in the chat (or that sits in the
 * library). A READ tool: it changes nothing, so it is not in WRITE_TOOLS.
 *
 * The file's contents are the operator's upload, which may itself have come
 * from anywhere, so they are fenced as untrusted data like an inbound email.
 */

export const FILES_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_attached_file",
    description:
      "Read a spreadsheet (.xlsx, .csv) or text file (.txt, .md, .json) that the operator attached in the chat or that is in the library, and return its cells as text. A chat message that carries a file ends with a line like [Attached to the library: \"name\" \u2014 file #12]; pass that number as fileId before you answer about the file. Large spreadsheets come back cut off at a size limit with a note saying where; call again with sheet, fromRow and toRow to read the rest. It cannot read PDF, Word or PowerPoint files, and it does not change anything.",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "integer", description: "The number after # in the attachment line." },
        sheet: { type: "string", description: "Optional: read only the sheet with this name." },
        fromRow: { type: "integer", description: "Optional: first row to read (1 is the top row)." },
        toRow: { type: "integer", description: "Optional: last row to read." },
      },
      required: ["fileId"],
    },
  },
  {
    name: "draft_program_from_file",
    description:
      "Copy a coach's training program from a spreadsheet (.xlsx, .csv) the operator attached in the chat into a workout program: weeks, days and exercises with sets, reps, load, rest and notes exactly as the sheet has them. Pass the number after # in the attachment line as fileId. Use it when the operator asks to build, import or copy a program from the file. It takes about a minute. It saves nothing itself: it hands back a create_workout_program card for the operator to approve, and lists anything in the sheet it could not place.",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "integer", description: "The number after # in the attachment line." },
      },
      required: ["fileId"],
    },
  },
];

function optionalRow(v: unknown): number | undefined {
  const n = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

export async function readAttachedFileTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const fileId = Number(input.fileId);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return { text: "Give the file's number, the one after # in the attachment line." };
  }
  const sheet = typeof input.sheet === "string" && input.sheet.trim() ? input.sheet.trim() : undefined;
  const fromRow = optionalRow(input.fromRow);
  const toRow = optionalRow(input.toRow);

  const read = await readLibraryFile(fileId, { sheet, fromRow, toRow });
  if (!read.ok) return { text: read.error };

  if (sheet && read.sheets) {
    const wanted = sheet.toLowerCase();
    if (!read.sheets.some((s) => s.name.toLowerCase() === wanted)) {
      const names = read.sheets.map((s) => `"${s.name}"`).join(", ");
      return { text: `There is no sheet named "${sheet}" in "${read.name}". Its sheets are: ${names}.` };
    }
  }

  const header = `File "${read.name}"`;
  const note = read.kind === "text" && read.truncated ? "\nCut off after the first 60,000 characters." : "";
  return { text: `${header}\n${fenceUntrusted(read.text || "(The file is empty.)")}${note}` };
}

// ---------------------------------------------------------------- draft_program_from_file

/** How many "check these" lines the chat shows; the rest are counted. */
const MAX_UNPLACED_LINES = 30;
const MAX_UNPLACED_CHARS = 300;

export type DraftProgramDeps = {
  /** The pending write's card line: assistant/tools passes summarizeToolAction (this file cannot import it back). */
  summarize: (name: string, input: Record<string, unknown>) => string;
  /** The sheet-to-program converter. A seam for tests; defaults to the real, metered one. */
  importProgram?: (fileId: number) => Promise<ImportResult>;
};

/**
 * A converted program as create_workout_program's input, so the approved
 * card saves exactly what the converter read. Empty fields are left out to
 * keep a long program's stored card small.
 */
export function programToCreateInput(program: ProgramInput): Record<string, unknown> {
  const input: Record<string, unknown> = { title: program.title };
  if (program.summary) input.summary = program.summary;
  if (program.tags.length) input.tags = program.tags.join(", ");
  input.days = program.days.map((d) => {
    const day: Record<string, unknown> = { name: d.name, week: d.week };
    if (d.instructions) day.instructions = d.instructions;
    day.exercises = d.exercises.map((e) => {
      const ex: Record<string, unknown> = { name: e.name, section: e.section, sets: e.sets };
      if (e.reps) ex.reps = e.reps;
      if (e.load) ex.load = e.load;
      if (e.restSeconds) ex.restSeconds = e.restSeconds;
      if (e.notes) ex.notes = e.notes;
      if (e.muscleGroups.length) ex.muscleGroups = e.muscleGroups.join(", ");
      if (e.joined) ex.joined = true;
      if (e.exerciseId) ex.exerciseId = e.exerciseId;
      return ex;
    });
    return day;
  });
  return input;
}

function unplacedLines(unplaced: string[]): string {
  const clip = (s: string) => {
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > MAX_UNPLACED_CHARS ? `${one.slice(0, MAX_UNPLACED_CHARS - 3).trimEnd()}...` : one;
  };
  const shown = unplaced.slice(0, MAX_UNPLACED_LINES).map((u) => `- ${clip(u)}`);
  const more = unplaced.length - shown.length;
  if (more > 0) shown.push(`- and ${more} more`);
  return shown.join("\n");
}

/**
 * Reads a program spreadsheet from the library and proposes it as one
 * create_workout_program write. A READ tool: the converter spends AI money
 * but changes nothing; the program is only saved when the operator approves
 * the card (runAgentTurn folds this result's pendingWrites into the turn's).
 */
export async function draftProgramFromFileTool(
  _ctx: ToolContext,
  input: Record<string, unknown>,
  deps: DraftProgramDeps,
): Promise<ToolResult> {
  const fileId = Number(input.fileId);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return { text: "Give the file's number, the one after # in the attachment line." };
  }
  const result = await (deps.importProgram ?? importProgramFromLibraryFile)(fileId);
  if (!result.ok) return { text: result.error };

  const writeInput = programToCreateInput(result.program);
  // The title and the lines to check are quoted from the sheet, and this text
  // joins the reply the model reads on later turns, so it is fenced.
  const fromSheet = [result.summary + "."];
  if (result.unplaced.length) fromSheet.push(`Things to check:\n${unplacedLines(result.unplaced)}`);
  return {
    text: `${fenceUntrusted(fromSheet.join("\n\n"))}\n\nApprove the card to save it.`,
    pendingWrites: [
      { name: "create_workout_program", input: writeInput, summary: deps.summarize("create_workout_program", writeInput) },
    ],
  };
}
