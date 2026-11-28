// Run: npm test -- src/lib/agents/tools.files.test.ts
//
// read_attached_file: Adonis reads a spreadsheet or text file the operator
// attached in the chat. The properties worth pinning: the cells come back
// (inside the untrusted-content fence), PDFs and photos are refused in plain
// words, an unknown id and another business's file read as "not found", and
// the tool is a READ tool that never reaches the write-approval gate.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

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
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

async function makeXlsx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="y"><sheets><sheet name="Week 1" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/></Relationships>`,
  );
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst><si><t>Back squat</t></si><si><t>Day A</t></si></sst>`);
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>5</v></c><c r="C2"><v>100</v></c></row></sheetData></worksheet>`,
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Warm up first</t></is></c></row></sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant, openTenantDb } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { libraryDir } = requireLocal("../image/library") as typeof import("../image/library");
  const tools = requireLocal("../assistant/tools") as typeof import("../assistant/tools");

  const slug = "files-tool-test";
  const otherSlug = "files-tool-other";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug IN (?, ?)").run(slug, otherSlug);
  const mkTenant = (s: string) =>
    (
      controlSqlite
        .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
        .get(s, s, `tenants/${s}/${s}.db`) as { id: number }
    ).id;
  const tid = mkTenant(slug);
  const otherTid = mkTenant(otherSlug);

  const written: string[] = [];
  const cleanup = () => {
    for (const f of written) {
      try {
        fs.rmSync(path.join(libraryDir(), f), { force: true });
      } catch {
        // best effort
      }
    }
    controlSqlite.prepare("DELETE FROM tenants WHERE id IN (?, ?)").run(tid, otherTid);
    for (const dir of [slug, otherSlug]) {
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", dir), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };

  try {
    getTenantDbById(tid);
    getTenantDbById(otherTid);
    const mine = openTenantDb(`tenants/${slug}/${slug}.db`).sqlite;
    const theirs = openTenantDb(`tenants/${otherSlug}/${otherSlug}.db`).sqlite;

    const stamp = Date.now();
    const add = (
      sqlite: typeof mine,
      filename: string,
      originalName: string,
      mimeType: string,
      kind: string,
      bytes: Buffer,
    ) => {
      fs.writeFileSync(path.join(libraryDir(), filename), bytes);
      written.push(filename);
      return (
        sqlite
          .prepare(
            "INSERT INTO image_library_assets (filename, original_name, mime_type, kind, size_bytes) VALUES (?, ?, ?, ?, ?) RETURNING id",
          )
          .get(filename, originalName, mimeType, kind, bytes.length) as { id: number }
      ).id;
    };

    const xlsxId = add(
      mine,
      `doc-${stamp}-t1.xlsx`,
      "block.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "file",
      await makeXlsx(),
    );
    const csvId = add(mine, `doc-${stamp}-t2.csv`, "plan.csv", "text/csv", "file", Buffer.from("Lift,Sets\nBench,3\n"));
    const txtId = add(mine, `doc-${stamp}-t3.txt`, "notes.txt", "text/plain", "file", Buffer.from("Eat well. <b>Sleep</b>."));
    const pdfId = add(mine, `doc-${stamp}-t4.pdf`, "prices.pdf", "application/pdf", "file", Buffer.from("%PDF-1.4"));
    const docxId = add(
      mine,
      `doc-${stamp}-t5.docx`,
      "waiver.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "file",
      Buffer.from("x"),
    );
    const imgId = add(mine, `img-${stamp}-t6.jpg`, "gym.jpg", "image/jpeg", "image", Buffer.from("x"));
    // Ids are per business, so push the other business's id past every id of
    // mine: the lookup must come back empty, not land on one of my own files.
    for (let i = 0; i < 9; i++) {
      theirs
        .prepare("INSERT INTO image_library_assets (filename, original_name, mime_type, kind, size_bytes) VALUES ('x', 'x', 'text/plain', 'file', 0)")
        .run();
    }
    const otherId = add(theirs, `doc-${stamp}-t7.csv`, "secret.csv", "text/csv", "file", Buffer.from("A,B\n1,2\n"));

    const ctx = { tenantId: tid, userId: 7 };
    const run = (input: Record<string, unknown>) => tools.executeTool("read_attached_file", input, ctx);

    await runWithTenant(tid, async () => {
      // The grid comes back, fenced, under a File line.
      const x = await run({ fileId: xlsxId });
      ok("xlsx: starts with the file line", x.text.startsWith('File "block.xlsx"\n'));
      ok("xlsx: cell values present", /Back squat/.test(x.text) && /Day A/.test(x.text) && /C: 100/.test(x.text));
      ok("xlsx: both sheets", /Sheet "Week 1"/.test(x.text) && /Warm up first/.test(x.text));
      ok("xlsx: fenced as untrusted", /<untrusted_external_content>/.test(x.text));

      // sheet and row slicing.
      const one = await run({ fileId: xlsxId, sheet: "notes" });
      ok("sheet filter: only that sheet", /Warm up first/.test(one.text) && !/Back squat/.test(one.text));
      const rows = await run({ fileId: xlsxId, sheet: "Week 1", fromRow: 2, toRow: 2 });
      ok("row range: only row 2", /Back squat/.test(rows.text) && !/Day A/.test(rows.text));
      const noSheet = await run({ fileId: xlsxId, sheet: "Nope" });
      ok("unknown sheet names the real ones", /no sheet named "Nope"/.test(noSheet.text) && /"Week 1"/.test(noSheet.text));

      const c = await run({ fileId: csvId });
      ok("csv: cells present", /Bench/.test(c.text) && /B: 3/.test(c.text));

      const t = await run({ fileId: txtId });
      ok("text: contents present", /Eat well/.test(t.text));
      ok("text: markup in the file cannot close the fence", !/<b>/.test(t.text));

      // Refusals.
      ok("pdf refused", (await run({ fileId: pdfId })).text === "I can read spreadsheets (.xlsx, .csv) and text files, not PDF files yet.");
      ok("word refused", (await run({ fileId: docxId })).text === "I can read spreadsheets (.xlsx, .csv) and text files, not Word files yet.");
      ok("photo refused", (await run({ fileId: imgId })).text === "That is a photo or video, not a file I can read.");
      ok("unknown id", (await run({ fileId: 999999 })).text === "I can't find that file in this business's library.");
      ok("another business's file reads as not found", (await run({ fileId: otherId })).text === "I can't find that file in this business's library.");
      ok("missing id is a plain message", /number/.test((await run({})).text));
    });

    // It is a read tool: registered, and not behind the write gate.
    ok("registered in TOOLS", tools.TOOLS.some((t) => t.name === "read_attached_file"));
    ok("not a write tool", tools.isWriteTool("read_attached_file") === false && !tools.WRITE_TOOLS.has("read_attached_file"));
  } finally {
    cleanup();
  }

  console.log(`tools.files.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
