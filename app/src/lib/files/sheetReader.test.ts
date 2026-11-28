// Run: npm test -- src/lib/files/sheetReader.test.ts
//
// The spreadsheet reader: xlsx and csv to string grids, and the text view.
import assert from "node:assert/strict";
import JSZip from "jszip";

import { colName, readCsv, readXlsx, sheetsToText, SheetReadError, type Sheet } from "./sheetReader";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}
function eq(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name);
  passed++;
}

async function build(parts: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [p, c] of Object.entries(parts)) zip.file(p, c);
  return zip.generateAsync({ type: "nodebuffer" });
}

const workbook = `<?xml version="1.0"?><workbook xmlns="x" xmlns:r="y"><sheets>
<sheet name="Week 1 &amp; 2" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const rels = `<?xml version="1.0"?><Relationships>
<Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml" Type="t"/>
<Relationship Id="rId3" Type="t" Target="sharedStrings.xml"/></Relationships>`;
const shared = `<?xml version="1.0"?><sst>
<si><t>Squat</t></si>
<si><r><t>Bench </t></r><r><rPr><b/></rPr><t>Press</t></r></si>
<si><t xml:space="preserve">Rows &amp; pulls</t></si>
<si><t>Day A</t><rPh sb="0"><t>ignored</t></rPh></si></sst>`;
const sheet1 = `<?xml version="1.0"?><worksheet><cols><col min="1" max="2"/></cols><sheetData>
<row r="1"><c r="A1" t="s"><v>3</v></c><c r="C1" t="s"><v>0</v></c><c r="AA1" t="str"><v>far</v></c></row>
<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>0.7000000000000001</v></c><c r="C2"><f>B2*2</f><v>1.4000000000000001</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" t="b"><v>0</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>inline &amp; text</t></is></c><c r="B3" s="4"/><c r="C3"><v>5</v></c><c r="D3" t="e"><v>#DIV/0!</v></c></row>
<row r="5"><c r="A5" t="s"><v>2</v></c></row>
<row r="7"><c r="A7"/></row>
</sheetData></worksheet>`;
const sheet2 = `<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><r><t>rich </t></r><r><t>text</t></r></is></c></row></sheetData></worksheet>`;

async function main() {
  eq("colName", [colName(0), colName(25), colName(26), colName(27), colName(701), colName(702)], ["A", "Z", "AA", "AB", "ZZ", "AAA"]);

  const buf = await build({
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": rels,
    "xl/sharedStrings.xml": shared,
    "xl/worksheets/sheet1.xml": sheet1,
    "xl/worksheets/sheet2.xml": sheet2,
  });
  const sheets = await readXlsx(buf);
  eq("sheet names in order, entities decoded", sheets.map((s) => s.name), ["Week 1 & 2", "Notes"]);
  const rows = sheets[0].rows;
  eq("shared string, gap column and cell at AA1", rows[0].length, 27);
  eq("row 1 cells", [rows[0][0], rows[0][1], rows[0][2], rows[0][26]], ["Day A", "", "Squat", "far"]);
  eq("rich shared string is joined", rows[1][0], "Bench Press");
  eq("float noise stripped", rows[1][1], "0.7");
  eq("formula uses cached value, noise stripped", rows[1][2], "1.4");
  eq("booleans", [rows[1][3], rows[1][4]], ["TRUE", "FALSE"]);
  eq("inline string with entity", rows[2][0], "inline & text");
  eq("styled empty cell stays empty", rows[2][1], "");
  eq("plain integer", rows[2][2], "5");
  eq("error cell kept as written", rows[2][3], "#DIV/0!");
  eq("row 4 is an empty row between", rows[3], []);
  eq("shared string with entity", rows[4][0], "Rows & pulls");
  eq("trailing empty rows dropped", rows.length, 5);
  eq("rich inline string on second sheet", sheets[1].rows, [["", "rich text"]]);

  // Phonetic runs are not text.
  const sheetPh = await readXlsx(
    await build({
      "xl/workbook.xml": workbook,
      "xl/_rels/workbook.xml.rels": rels,
      "xl/sharedStrings.xml": shared,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>3</v></c></row></sheetData></worksheet>`,
      "xl/worksheets/sheet2.xml": sheet2,
    }),
  );
  eq("phonetic text ignored", sheetPh[0].rows, [["Day A"]]);

  // Guards.
  await assert.rejects(() => readXlsx(Buffer.from("this is not a zip")), SheetReadError);
  passed++;
  const noWorkbook = await build({ "hello.txt": "hi" });
  await assert.rejects(() => readXlsx(noWorkbook), SheetReadError);
  passed++;
  await assert.rejects(() => readXlsx(buf, { maxCells: 5 }), (e) => e instanceof SheetReadError && /too large/.test(e.message));
  passed++;
  await assert.rejects(() => readXlsx(buf, { maxUncompressedBytes: 100 }), (e) => e instanceof SheetReadError && /too large/.test(e.message));
  passed++;
  check("guards do not fire at the default limits", (await readXlsx(buf)).length === 2);

  // CSV.
  eq("csv basics", readCsv("a,b,c\n1,2,3\n")[0].rows, [["a", "b", "c"], ["1", "2", "3"]]);
  eq("csv sheet name", readCsv("a")[0].name, "Sheet1");
  eq("csv quotes, doubled quotes, embedded newline, CRLF", readCsv('"a,1","say ""hi""","line1\nline2"\r\nx,y,z\r\n')[0].rows, [["a,1", 'say "hi"', "line1\nline2"], ["x", "y", "z"]]);
  eq("csv BOM stripped", readCsv("﻿name,reps\nSquat,5")[0].rows, [["name", "reps"], ["Squat", "5"]]);
  eq("csv semicolons detected", readCsv("name;reps;load\nSquat;5;80,5")[0].rows, [["name", "reps", "load"], ["Squat", "5", "80,5"]]);
  eq("csv trailing empties trimmed", readCsv("a,b,,\n,,,\n\n")[0].rows, [["a", "b"]]);
  eq("csv blank row in the middle kept", readCsv("a\n\nb")[0].rows, [["a"], [], ["b"]]);

  // Text view.
  const grid: Sheet[] = [
    { name: "Wk1", rows: [["Day 1", "", "Squat"], [], ["Bench", "3x5"], ["x", "multi\nline"]] },
    { name: "Wk2", rows: [["Day 2"]] },
  ];
  const full = sheetsToText(grid);
  eq(
    "text format",
    full.text.split("\n"),
    ['Sheet "Wk1" (4 rows x 3 columns)', "1 | A: Day 1 | C: Squat", "3 | A: Bench | B: 3x5", "4 | A: x | B: multi line", "", 'Sheet "Wk2" (1 rows x 1 columns)', "1 | A: Day 2"],
  );
  check("not truncated", full.truncated === false);
  eq("row range", sheetsToText(grid, { sheet: "Wk1", fromRow: 3, toRow: 3 }).text, 'Sheet "Wk1" (4 rows x 3 columns)\n3 | A: Bench | B: 3x5');
  eq("sheet filter", sheetsToText(grid, { sheet: "Wk2" }).text, 'Sheet "Wk2" (1 rows x 1 columns)\n1 | A: Day 2');
  const cut = sheetsToText(grid, { maxChars: 80 });
  check("truncated flag", cut.truncated);
  eq("cut-off line", cut.text.split("\n").pop(), "Cut off at row 3 of 4 on sheet Wk1.");
  check("cut text stays within the cap", cut.text.split("\n").slice(0, -1).join("\n").length <= 80);
  const big: Sheet[] = [{ name: "Big", rows: Array.from({ length: 5000 }, (_, i) => [`row number ${i}`]) }];
  const bigCut = sheetsToText(big);
  check("default cap is 60,000", bigCut.truncated && bigCut.text.length < 60_200);
  check("cut-off names the rows", /Cut off at row \d+ of 5000 on sheet Big\.$/.test(bigCut.text));

  console.log(`sheetReader: ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
