import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { readLibraryFile } from "@/lib/files/libraryFile";
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
