// Run: npm test -- src/lib/table.test.ts
import assert from "node:assert/strict";

import { paginate, readTableState, sortRows, toCsv, writeTableState } from "./table";

const rows = [{ n: "b", v: 2 }, { n: "a", v: 10 }, { n: "c", v: null }];
const val = (r: (typeof rows)[number], k: string) => (r as Record<string, unknown>)[k];

assert.deepEqual(sortRows(rows, "n", "asc", val).map((r) => r.n), ["a", "b", "c"]);
assert.deepEqual(sortRows(rows, "v", "desc", val).map((r) => r.n), ["a", "b", "c"], "nulls last either way");
assert.deepEqual(sortRows(rows, "v", "asc", val).map((r) => r.n), ["b", "a", "c"]);
assert.deepEqual(sortRows(rows, null, "asc", val), rows, "no key: untouched");

const p = paginate([1, 2, 3, 4, 5], 2, 2);
assert.deepEqual(p, { rows: [3, 4], pages: 3, page: 2, from: 3, to: 4, total: 5 });
assert.equal(paginate([1, 2], 9, 2).page, 1, "page past the end clamps to the last");
assert.deepEqual(paginate([], 1, 2), { rows: [], pages: 1, page: 1, from: 0, to: 0, total: 0 });

const s = readTableState(new URLSearchParams("sort=name&dir=desc&page=3&cols=a,b"));
assert.deepEqual(s, { sort: "name", dir: "desc", page: 3, cols: ["a", "b"] });
assert.deepEqual(readTableState(new URLSearchParams("dir=sideways&page=x")), { sort: null, dir: "asc", page: 1, cols: null });
assert.deepEqual(readTableState(new URLSearchParams(""), { sort: "joined", dir: "desc" }), { sort: "joined", dir: "desc", page: 1, cols: null });
const out = writeTableState(new URLSearchParams("q=x&page=4"), { sort: "name", dir: "asc", page: 1, cols: null });
assert.equal(out.toString(), "q=x&sort=name&dir=asc", "page 1 and null cols are omitted; other params survive");

assert.equal(
  toCsv([{ a: 'He said "hi"', b: 1 }, { a: "x,y", b: null }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]),
  'A,B\r\n"He said ""hi""",1\r\n"x,y",\r\n',
);
const cc = [{ key: "a", label: "A" }];
assert.equal(toCsv([{ a: "=SUM(A1)" }], cc), "A\r\n'=SUM(A1)\r\n", "formula prefix is neutralised");
assert.equal(toCsv([{ a: "@x" }], cc), "A\r\n'@x\r\n");
assert.equal(toCsv([{ a: -5 }], cc), "A\r\n-5\r\n", "numbers untouched");
assert.equal(toCsv([{ a: "=a,b" }], cc), "A\r\n\"'=a,b\"\r\n", "prefixed then quoted");
console.log("table.test.ts: ok");
