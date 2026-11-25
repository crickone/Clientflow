// Run: npm test -- src/lib/platform/data.test.ts
//
// The console's subject access export and delete on a scratch business:
// the GoHighLevel import record is in the export, and a delete blanks its
// personal fields and the link but keeps the GoHighLevel id.
import "../leadFlows/testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

const h = requireLocal("../leadFlows/testing/harness") as typeof import("../leadFlows/testing/harness");
const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
const schema = requireLocal("../db/schema") as typeof import("../db/schema");
const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
const { exportPerson, deletePerson } = requireLocal("./data") as typeof import("./data");

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const NOTE = "FAKE-MEDICAL-DATA-SENTINEL";
const s = h.makeScratchTenant("platform-data-test");
try {
  const conn = getTenantDbById(s.tid);
  const t = schema.ghlImportPeople;
  const leadId = conn.insert(schema.leads).values({ source: "gohighlevel", sourceLeadId: "g-aoife", firstName: "Aoife", email: "aoife@example.com" }).returning({ id: schema.leads.id }).get().id;
  const clientId = conn.insert(schema.clients).values({ firstName: "Gavin", lastName: "Example", email: "gavin@example.com", phone: "" }).returning({ id: schema.clients.id }).get().id;
  const record = (contactId: string, by: { leadId?: number; clientId?: number }) =>
    conn
      .insert(t)
      .values({ ghlContactId: contactId, ...by, outcome: "create", ghlSource: "Facebook", tags: '["member"]', treatment: "Infrared Therapy", usedBefore: "no", town: "Clonmel", staffMedicalNote: NOTE, importedAt: new Date() })
      .run();
  record("g-aoife", { leadId });
  record("g-gavin", { clientId });
  const row = (contactId: string) => conn.select().from(t).where(eq(t.ghlContactId, contactId)).get()!;

  // The export carries the import record, for a lead and for a client.
  const leadExport = exportPerson(s.tid, "lead", leadId);
  ok(leadExport.ok && JSON.stringify(leadExport.data).includes(NOTE) && JSON.stringify(leadExport.data).includes("g-aoife"), "the lead's export has its import record");
  const clientExport = exportPerson(s.tid, "client", clientId);
  ok(clientExport.ok && JSON.stringify(clientExport.data).includes("g-gavin") && !JSON.stringify(clientExport.data).includes("g-aoife"), "the client's export has its own import record only");

  // A delete blanks the personal fields and the link, and keeps the GoHighLevel id.
  ok(deletePerson(s.tid, "lead", leadId).ok, "the lead is deleted");
  const a = row("g-aoife");
  ok(a.leadId === null && a.staffMedicalNote === null && a.tags === null && a.treatment === null && a.usedBefore === null && a.town === null && a.ghlSource === null, "the lead's import record is blanked");
  ok(row("g-gavin").staffMedicalNote === NOTE, "another person's record is left alone");
  ok(deletePerson(s.tid, "client", clientId).ok, "the client is deleted");
  const g = row("g-gavin");
  ok(g.clientId === null && g.staffMedicalNote === null && g.ghlContactId === "g-gavin", "the client's import record is blanked, the id kept");
  console.log(`platform data: ${n} checks passed.`);
} finally {
  s.cleanup();
}
