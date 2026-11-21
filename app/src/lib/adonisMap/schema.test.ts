// Run: npm test -- src/lib/adonisMap/schema.test.ts
import assert from "node:assert/strict";

import { MODULE_CATALOG } from "../features";
import { describeMap } from "./describe";
import { ALL_MODULES, TYPE_DEFS, availableTypes, modulesFrom } from "./schema";
import { TYPE_NAMES } from "./types";

for (const name of TYPE_NAMES) {
  const d = TYPE_DEFS[name];
  assert.equal(d.name, name);
  const fields = new Set(d.fields.map((f) => f.name));
  assert.equal(fields.size, d.fields.length, `${name}: field names are unique`);
  for (const f of d.fields) {
    if (f.type === "enum") assert.ok(f.values && f.values.length > 0, `${name}.${f.name} lists its values`);
  }
  if (d.dateField) {
    assert.equal(d.fields.find((f) => f.name === d.dateField)?.type, "date", `${name}.dateField is a date field`);
  }
  for (const l of d.links) {
    assert.ok(l.from === "id" || fields.has(l.from), `${name}.${l.name}.from is a field`);
    const t = TYPE_DEFS[l.target];
    assert.ok(l.to === "id" || t.fields.some((f) => f.name === l.to), `${name}.${l.name}.to is a field on ${l.target}`);
  }
}

assert.deepEqual(availableTypes(ALL_MODULES), ["Person", "Booking", "Class", "Membership", "Package", "Order", "Conversation"]);
assert.deepEqual(
  availableTypes({ timetable: false, calendar: false, products: false, communication: false }),
  ["Person", "Order"],
);
assert.ok(!availableTypes({ ...ALL_MODULES, timetable: false }).includes("Class"), "no Class without the timetable");
assert.ok(availableTypes({ ...ALL_MODULES, timetable: false }).includes("Booking"), "appointments still make bookings");
assert.deepEqual(modulesFrom({}), ALL_MODULES, "absent flags mean on");
assert.equal(modulesFrom({ products: false }).products, false);

const full = describeMap(availableTypes(ALL_MODULES));
assert.ok(full.length <= 6000, `map summary is ${full.length} chars; keep it at or under 6000 (about 1,500 tokens)`);
for (const n of TYPE_NAMES) assert.ok(full.includes(`${n}:`), `summary names ${n}`);
assert.ok(full.includes("stage:enum(lead|member|lapsed|client)*"), "worked-out fields are starred");
assert.ok(full.includes("use the map tools"), "summary ends with the routing rule");
const noComms = describeMap(availableTypes({ ...ALL_MODULES, communication: false }));
assert.ok(!noComms.includes("Conversation"), "no Conversation type or link when communication is off");

const flag = MODULE_CATALOG.find((m) => m.key === "adonis_map");
assert.ok(flag, "adonis_map is in the module catalog");
assert.equal(flag.defaultRollout, "none");
assert.deepEqual(flag.paths, []);

console.log("schema.test.ts: all assertions passed");
