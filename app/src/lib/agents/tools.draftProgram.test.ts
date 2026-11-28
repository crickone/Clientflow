// Run: npm test -- src/lib/agents/tools.draftProgram.test.ts
//
// draft_program_from_file: Adonis copies a coach's program spreadsheet into
// one create_workout_program card. Pinned here, with a fake converter (no
// network, no paid model call):
//   - ok: exactly one pending write named create_workout_program, carrying
//     the weeks, loads and library ids, with the summarizeToolAction line;
//     the text has the summary, the lines to check and the approve hint;
//   - error: the converter's message and no pending writes;
//   - it is a READ tool (not in WRITE_TOOLS), registered in TOOLS;
//   - approving the card (create_workout_program run on that input) saves
//     the weeks, loads and only the library ids this business can see;
//   - runAgentTurn folds the tool's pending write into the turn's Approve
//     card, stops before asking the model again, and puts the tool's text in
//     the reply (the model never reads that result).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import type { ImportResult } from "../workoutImport/model";
import type { ProgramInput } from "../workoutModel";

// The fake converter executeTool reaches through tools.files.ts. Swapped per
// case below; counts its calls.
let fakeImport: (fileId: number) => Promise<ImportResult> = async () => ({ ok: false, error: "not set" });
let importCalls = 0;

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("redirect stub"); } };
  }
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "next/headers") {
    return { headers: () => { throw new Error("no request"); }, cookies: () => { throw new Error("no request"); } };
  }
  if (request === "@/lib/workoutImport/convert") {
    return {
      importProgramFromLibraryFile: (fileId: number) => {
        importCalls++;
        return fakeImport(fileId);
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

function ex(name: string, extra: Partial<ProgramInput["days"][number]["exercises"][number]> = {}) {
  return { exerciseId: null, section: "workout" as const, name, sets: 3, reps: "5", restSeconds: 0, notes: null, muscleGroups: [], joined: false, load: null, ...extra };
}

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const tools = requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const files = requireLocal("./tools.files") as typeof import("./tools.files");
  const { runAgentTurn } = requireLocal("./runAgentTurn") as typeof import("./runAgentTurn");
  const { MODELS } = requireLocal("../ai/client") as typeof import("../ai/client");
  const { getProgram } = requireLocal("../workout") as typeof import("../workout");

  const slug = "draft-program-tool-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;
  // One exercise this business can see (its own custom), so a converter
  // match survives approval; a made-up id must not.
  const libId = (
    controlSqlite
      .prepare("INSERT INTO exercise_library (tenant_id, name, category, muscle_groups) VALUES (?, 'Back squat (draft test)', 'Test', 'quads,glutes') RETURNING id")
      .get(tid) as { id: number }
  ).id;
  const unknownId = 2_000_000_000;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM exercise_library WHERE id = ?").run(libId);
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const program: ProgramInput = {
    title: "Strength block",
    type: "detailed",
    status: "active",
    tags: [],
    summary: null,
    content: null,
    uploadFilename: null,
    uploadOriginalName: null,
    days: [
      {
        week: 1,
        name: "Day 1",
        instructions: "Warm up well",
        exercises: [
          ex("Back squat", { exerciseId: libId, load: "75%", restSeconds: 180, muscleGroups: ["quads", "glutes"] }),
          ex("Leg curl", { exerciseId: unknownId, sets: 0, reps: "10-12", notes: "Sets: 2-3" }),
        ],
      },
      { week: 1, name: "Day 2", instructions: null, exercises: [ex("Bench press", { load: "RPE 8" }), ex("Row", { joined: true })] },
      { week: 2, name: "Day 1", instructions: null, exercises: [ex("Back squat", { exerciseId: libId, load: "80%" })] },
      { week: 2, name: "Day 2", instructions: null, exercises: [ex("Bench press", { load: "RPE 9" })] },
    ],
  };
  const okResult: ImportResult = {
    ok: true,
    program,
    unplaced: ["Program row 12: Deload if sleep is poor"],
    summary: "Strength block: 2 weeks, 2 days a week, 6 exercises, 1 thing to check",
  };

  try {
    getTenantDbById(tid);
    const ctx = { tenantId: tid, userId: 7 };

    // ── Direct, through the deps seam ──
    const direct = await files.draftProgramFromFileTool(ctx, { fileId: 12 }, {
      summarize: tools.summarizeToolAction,
      importProgram: async (id) => {
        ok("the file id reaches the converter", id === 12);
        return okResult;
      },
    });
    ok("ok: one pending write", direct.pendingWrites?.length === 1);
    const pw = direct.pendingWrites![0];
    ok("ok: it is create_workout_program", pw.name === "create_workout_program");
    ok("ok: summary is the card line", pw.summary === tools.summarizeToolAction("create_workout_program", pw.input));
    ok("ok: summary names the program", pw.summary === "Create workout program “Strength block”");
    const days = pw.input.days as { name: string; week: number; instructions?: string; exercises: Record<string, unknown>[] }[];
    ok("input: title", pw.input.title === "Strength block");
    ok("input: four days", days.length === 4);
    ok("input: weeks kept", days.map((d) => d.week).join(",") === "1,1,2,2");
    ok("input: loads kept", days[0].exercises[0].load === "75%" && days[2].exercises[0].load === "80%" && days[3].exercises[0].load === "RPE 9");
    ok("input: rest, sets, reps, notes kept", days[0].exercises[0].restSeconds === 180 && days[0].exercises[1].sets === 0 && days[0].exercises[1].reps === "10-12" && days[0].exercises[1].notes === "Sets: 2-3");
    ok("input: library id carried", days[0].exercises[0].exerciseId === libId);
    ok("input: muscle groups as text", days[0].exercises[0].muscleGroups === "quads, glutes");
    ok("input: joined carried", days[1].exercises[1].joined === true);
    ok("input: day instructions", days[0].instructions === "Warm up well");
    ok("input: empty fields left out", !("load" in days[0].exercises[1]) && !("instructions" in days[1]));
    ok("text: summary", direct.text.startsWith(`${okResult.ok && okResult.summary}.`));
    ok("text: lines to check", /Things to check:\n- Program row 12: Deload if sleep is poor/.test(direct.text));
    ok("text: approve hint", direct.text.endsWith("Approve the card to save it."));

    const clean = await files.draftProgramFromFileTool(ctx, { fileId: 3 }, {
      summarize: tools.summarizeToolAction,
      importProgram: async () => ({ ...okResult, unplaced: [] }),
    });
    ok("no unplaced: no check list", !/Things to check/.test(clean.text) && clean.pendingWrites?.length === 1);

    const failed = await files.draftProgramFromFileTool(ctx, { fileId: 4 }, {
      summarize: tools.summarizeToolAction,
      importProgram: async () => ({ ok: false, error: "That file is not a spreadsheet." }),
    });
    ok("error: the converter's message", failed.text === "That file is not a spreadsheet.");
    ok("error: no pending writes", !failed.pendingWrites || failed.pendingWrites.length === 0);

    let called = false;
    const bad = await files.draftProgramFromFileTool(ctx, { fileId: "x" }, {
      summarize: tools.summarizeToolAction,
      importProgram: async () => {
        called = true;
        return okResult;
      },
    });
    ok("bad id: plain message, converter not called", /number/.test(bad.text) && !called && !bad.pendingWrites);

    // A long list is capped in the chat text.
    const many = await files.draftProgramFromFileTool(ctx, { fileId: 5 }, {
      summarize: tools.summarizeToolAction,
      importProgram: async () => ({ ...okResult, unplaced: Array.from({ length: 40 }, (_, i) => `Row ${i + 1}: note`) }),
    });
    ok("many: capped with a count", /- Row 30: note\n- and 10 more/.test(many.text) && !/Row 31:/.test(many.text));

    // ── Registry ──
    ok("registered in TOOLS", tools.TOOLS.some((t) => t.name === "draft_program_from_file"));
    ok("not a write tool", !tools.WRITE_TOOLS.has("draft_program_from_file") && tools.isWriteTool("draft_program_from_file") === false);

    // ── Through executeTool (the module seam) ──
    fakeImport = async () => okResult;
    importCalls = 0;
    const viaExec = await runWithTenant(tid, () => tools.executeTool("draft_program_from_file", { fileId: 9 }, ctx));
    ok("executeTool: reaches the converter once", importCalls === 1);
    ok("executeTool: one create_workout_program write", viaExec.pendingWrites?.length === 1 && viaExec.pendingWrites[0].name === "create_workout_program");

    // ── Approving the card saves what the sheet said ──
    const saved = JSON.parse(await runWithTenant(tid, async () => (await tools.executeTool("create_workout_program", pw.input, ctx)).text)) as {
      programId?: number;
      error?: string;
    };
    ok("approve: saved", typeof saved.programId === "number");
    const back = runWithTenant(tid, () => getProgram(saved.programId!))!;
    ok("approve: detailed program", back.type === "detailed" && back.title === "Strength block");
    ok("approve: weeks", back.days.map((d) => d.week).join(",") === "1,1,2,2");
    ok("approve: loads", back.days[0].exercises[0].load === "75%" && back.days[1].exercises[0].load === "RPE 8" && back.days[2].exercises[0].load === "80%");
    ok("approve: visible library id kept", back.days[0].exercises[0].exerciseId === libId);
    ok("approve: unknown library id dropped", back.days[0].exercises[1].exerciseId === null);
    ok("approve: sets, reps, rest, notes", back.days[0].exercises[0].restSeconds === 180 && back.days[0].exercises[1].sets === 0 && back.days[0].exercises[1].reps === "10-12" && back.days[0].exercises[1].notes === "Sets: 2-3");
    ok("approve: joined", back.days[1].exercises[1].joined === true);

    // ── runAgentTurn: the read tool's write lands on the Approve card ──
    let modelCalls = 0;
    const provider = {
      async streamTurn(args: { onText?: (d: string) => void }) {
        modelCalls++;
        if (modelCalls > 1) throw new Error("the loop asked the model again after a pending write");
        args.onText?.("I'll copy the program from the sheet.");
        return {
          text: "I'll copy the program from the sheet.",
          toolCalls: [{ id: "tu_1", name: "draft_program_from_file", input: { fileId: 9 } }],
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
          stopReason: "tool_use" as const,
        };
      },
    };
    const streamed: string[] = [];
    const toolsSeen: string[] = [];
    fakeImport = async () => okResult;
    const turn = await runWithTenant(tid, () =>
      runAgentTurn({
        provider: provider as any,
        tenantId: tid,
        agentKey: "orchestrator",
        model: MODELS.sonnet,
        system: "test",
        tools: [],
        messages: [{ role: "user", content: "Build this program [Attached to the library: \"block.xlsx\" — file #9]" }],
        onText: (d) => streamed.push(d),
        onTool: (n) => toolsSeen.push(n),
      }),
    );
    ok("turn: the tool ran as a read", toolsSeen.join(",") === "draft_program_from_file");
    ok("turn: one pending write", turn.pendingWrites.length === 1);
    ok("turn: it is create_workout_program", turn.pendingWrites[0].name === "create_workout_program");
    ok("turn: with the weeks", (turn.pendingWrites[0].input.days as { week: number }[]).map((d) => d.week).join(",") === "1,1,2,2");
    ok("turn: with the card line", turn.pendingWrites[0].summary === "Create workout program “Strength block”");
    ok("turn: stopped for approval", modelCalls === 1);
    ok("turn: reply has the model's words then the tool's text", turn.text.startsWith("I'll copy the program from the sheet.\n\nStrength block: 2 weeks") && /Things to check:/.test(turn.text) && turn.text.endsWith("Approve the card to save it."));
    ok("turn: the tool's text streamed too", streamed.join("") === turn.text);

    // An error adds no card and no extra text: the model reads the error next turn.
    let errCalls = 0;
    const errProvider = {
      async streamTurn() {
        errCalls++;
        if (errCalls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "tu_2", name: "draft_program_from_file", input: { fileId: 9 } }],
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
            stopReason: "tool_use" as const,
          };
        }
        return { text: "That file is not a spreadsheet.", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 }, stopReason: "end" as const };
      },
    };
    fakeImport = async () => ({ ok: false, error: "That file is not a spreadsheet." });
    const errTurn = await runWithTenant(tid, () =>
      runAgentTurn({
        provider: errProvider as any,
        tenantId: tid,
        agentKey: "orchestrator",
        model: MODELS.sonnet,
        system: "test",
        tools: [],
        messages: [{ role: "user", content: "Build it" }],
      }),
    );
    ok("error turn: no pending writes", errTurn.pendingWrites.length === 0);
    ok("error turn: the model answered from the error", errCalls === 2 && errTurn.text === "That file is not a spreadsheet.");
  } finally {
    cleanup();
  }

  console.log(`tools.draftProgram.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
