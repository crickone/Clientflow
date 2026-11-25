// Run: npm test -- src/lib/pipeline/lapse.test.ts
//
// The daily lapse job on a scratch business: a won customer with no visit
// or payment in 90 days lapses, but one brought in by a GoHighLevel import
// counts as active for 90 days from the import.
import "../leadFlows/testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

const h = requireLocal("../leadFlows/testing/harness") as typeof import("../leadFlows/testing/harness");
const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
const schema = requireLocal("../db/schema") as typeof import("../db/schema");
const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
const { recomputeLapsed } = requireLocal("./lapse") as typeof import("./lapse");
const { stageIdsByRoleOnConn } = requireLocal("./stageRepo") as typeof import("./stageRepo");

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const DAY = 86_400_000;
const s = h.makeScratchTenant("lapse-import-test");
try {
  const conn = getTenantDbById(s.tid);
  const won = stageIdsByRoleOnConn(conn, "won")[0];
  const lapsed = stageIdsByRoleOnConn(conn, "lapsed")[0];
  ok(won != null && lapsed != null, "the board has Sale and Lapsed");

  const client = (first: string) =>
    conn.insert(schema.clients).values({ firstName: first, lastName: "Example", email: `${first.toLowerCase()}@example.com`, phone: "" }).returning({ id: schema.clients.id }).get().id;
  const lead = (first: string, source: string) =>
    conn
      .insert(schema.leads)
      .values({ source, sourceLeadId: source === "gohighlevel" ? `g-${first}` : null, firstName: first, email: `${first.toLowerCase()}@example.com`, stageId: won, clientId: client(first) })
      .returning({ id: schema.leads.id })
      .get().id;
  const imported = (leadId: number, contactId: string, at: number) =>
    conn.insert(schema.ghlImportPeople).values({ ghlContactId: contactId, leadId, outcome: "create", importedAt: new Date(at) }).run();
  const stageOf = (leadId: number) => conn.select({ v: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get()!.v;

  // Declan: won in GoHighLevel, imported yesterday, no visit or payment here yet.
  const declan = lead("Declan", "gohighlevel");
  imported(declan, "g-Declan", Date.now() - DAY);
  // Wendy: won here, no visit or payment in 90 days.
  const wendy = lead("Wendy", "manual");
  // Olga: won in GoHighLevel, imported 100 days ago, nothing since.
  const olga = lead("Olga", "gohighlevel");
  imported(olga, "g-Olga", Date.now() - 100 * DAY);

  const r = recomputeLapsed(conn);
  ok(stageOf(declan) === won, "an imported won lead with no visits is not lapsed right after the import");
  ok(stageOf(wendy) === lapsed, "a won lead that was not imported, with no visits, still lapses");
  ok(stageOf(olga) === lapsed, "an imported won lead lapses once 90 days have passed since the import");
  ok(r.lapsed === 2, "two lapsed");
  console.log(`pipeline lapse: ${n} checks passed.`);
} finally {
  s.cleanup();
}
