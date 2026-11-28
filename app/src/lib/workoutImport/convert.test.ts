// Run: npm test -- src/lib/workoutImport/convert.test.ts
//
// The converter's server wrappers with stand-in tenant, library, program
// store and model call (no DB, no network, no paid call):
// - a library spreadsheet goes through the metered call under
//   "workout-import" with Sonnet, and library names are matched;
// - a library text file and a read refusal come back as plain errors;
// - the cap error's own message is surfaced; other failures are plain;
// - an Upload program's file is read from this tenant's workout folder by
//   basename, .xlsx/.csv only, with the plain refusals for the rest.
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

class FakeCapError extends Error {
  constructor(message = "Your monthly free AI allowance is used up and there are no AI credits left.") {
    super(message);
    this.name = "AiCapError";
  }
}

type Meter = { tenantId: number; agentKey: string };
type Params = { model: string; max_tokens: number; system: string; messages: { role: string; content: string }[] } & Record<string, unknown>;
const meterCalls: { meter: Meter; params: Params }[] = [];
let modelReply: (params: Params) => string = () => "nothing";
let modelThrows: Error | null = null;

let libraryRead: unknown = { ok: false, error: "I can't find that file in this business's library." };
let program: unknown = null;

const csv = "Exercise,Sets,Reps,Load\nBack Squat,3,5,75%\nPlank,2,40s,\n";
const outline = '```json\n{"title":"From sheet","weeks":[{"week":1,"sheet":"Sheet1","fromRow":2,"toRow":3,"days":1}],"headerRows":{"sheet":"Sheet1","fromRow":1,"toRow":1},"unplaced":[]}\n```';
const week = '```json\n{"days":[{"name":"Day 1","exercises":[{"name":"Back Squat","sets":3,"reps":"5","load":"75%"},{"name":"Plank","sets":2,"reps":"40s"}]}],"unplaced":[]}\n```';
const sheetReply = (params: Params) => (params.system.startsWith("You read a coach") ? outline : week);

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/ai/client") return { MODELS: { sonnet: "claude-sonnet-5-5" } };
  if (request === "@/lib/ai/usage") return { AiCapError: FakeCapError };
  if (request === "@/lib/ai/metered") {
    return {
      meteredCreate: async (meter: Meter, build: () => Params) => {
        const params = build();
        meterCalls.push({ meter, params });
        if (modelThrows) throw modelThrows;
        return { content: [{ type: "text", text: modelReply(params) }] };
      },
    };
  }
  if (request === "@/lib/db/tenant") return { getCurrentTenant: () => ({ id: 7, slug: "scratch-import" }) };
  if (request === "@/lib/exerciseLibrary") return { listExercises: () => [{ id: 501, name: "back squat", muscleGroups: ["Quads"] }] };
  if (request === "@/lib/files/libraryFile") return { readLibraryFile: async () => libraryRead };
  if (request === "@/lib/workout") return { getProgram: () => program };
  return realLoad.call(this, request, ...rest);
};

async function main() {
  const { readCsv } = await import("@/lib/files/sheetReader");
  const { importProgramFromLibraryFile, importProgramFromUpload } = await import("./convert");

  // Library: refusal passed through, text file refused.
  {
    const r = await importProgramFromLibraryFile(3);
    check("library: read refusal passed through", !r.ok && r.error === "I can't find that file in this business's library.");
    libraryRead = { ok: true, name: "notes.txt", kind: "text", sheets: null, text: "hello", truncated: false };
    const t = await importProgramFromLibraryFile(3);
    check("library: text file is not a spreadsheet", !t.ok && t.error === "That file is not a spreadsheet.");
    check("library: no model call for refusals", meterCalls.length === 0);
  }

  // Library spreadsheet: metered under workout-import with Sonnet, library matched.
  {
    libraryRead = { ok: true, name: "block.csv", kind: "spreadsheet", sheets: readCsv(csv), text: "", truncated: false };
    modelReply = sheetReply;
    const r = await importProgramFromLibraryFile(3);
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) {
      const ex = r.program.days[0].exercises;
      check("library: program built", r.program.title === "From sheet" && ex.length === 2 && ex[0].load === "75%");
      check("library: exact library match", ex[0].exerciseId === 501 && ex[0].muscleGroups[0] === "Quads" && ex[0].name === "Back Squat");
      check("library: summary", r.summary === "From sheet: 1 day, 2 exercises");
    }
    check("metered: two calls", meterCalls.length === 2);
    check("metered: tenant + agent key", meterCalls.every((c) => c.meter.tenantId === 7 && c.meter.agentKey === "workout-import"));
    check("metered: Sonnet, no temperature, no tool_choice", meterCalls.every((c) => c.params.model === "claude-sonnet-5-5" && !("temperature" in c.params) && !("tool_choice" in c.params)));
    check("metered: user message carries the sheet", meterCalls[0].params.messages[0].role === "user" && meterCalls[0].params.messages[0].content.includes("2 | A: Back Squat"));
  }

  // Cap error: its own message, plainly.
  {
    meterCalls.length = 0;
    modelThrows = new FakeCapError();
    const r = await importProgramFromLibraryFile(3);
    check("cap: message surfaced", !r.ok && r.error === new FakeCapError().message);
    check("cap: stops at the first call", meterCalls.length === 1);
    modelThrows = new Error("socket hang up");
    const origError = console.error;
    console.error = () => {};
    const n = await importProgramFromLibraryFile(3);
    console.error = origError;
    check("other failure: plain error", !n.ok && n.error === "I couldn't build the program just now. Try again in a moment.");
    modelThrows = null;
  }

  // Upload programs.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workout-import-"));
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    const dir = path.join(tmp, "data", "tenants", "scratch-import", "workout");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "u1.csv"), csv);

    program = null;
    let r = await importProgramFromUpload(9);
    check("upload: unknown program", !r.ok && r.error === "I can't find that program.");

    program = { id: 9, title: "New Program", uploadFilename: null };
    r = await importProgramFromUpload(9);
    check("upload: no file", !r.ok && r.error === "That program has no uploaded file.");

    program = { id: 9, title: "New Program", uploadFilename: "old.xls" };
    r = await importProgramFromUpload(9);
    check("upload: .xls refusal", !r.ok && r.error === "That is an old Excel file (.xls). Save it as .xlsx from Excel and attach it again.");

    program = { id: 9, title: "New Program", uploadFilename: "plan.pdf" };
    r = await importProgramFromUpload(9);
    check("upload: PDF refusal", !r.ok && r.error === "I can read spreadsheets (.xlsx, .csv) and text files, not PDF files yet.");

    program = { id: 9, title: "New Program", uploadFilename: "gone.csv" };
    r = await importProgramFromUpload(9);
    check("upload: missing file", !r.ok && r.error === "The uploaded file is missing.");

    // A path in the stored name is cut to its basename, inside this tenant's folder.
    meterCalls.length = 0;
    program = { id: 9, title: "Mary's 4 day block", uploadFilename: "../../other/u1.csv" };
    r = await importProgramFromUpload(9);
    check("upload: read by basename from the tenant folder", r.ok && r.program.days[0].exercises.length === 2);
    check("upload: the program's own title wins", r.ok && r.program.title === "Mary's 4 day block");

    program = { id: 9, title: "New Program", uploadFilename: "u1.csv" };
    r = await importProgramFromUpload(9);
    check("upload: default title falls back to the sheet's", r.ok && r.program.title === "From sheet");
  } finally {
    process.chdir(cwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`workoutImport/convert.test.ts: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
