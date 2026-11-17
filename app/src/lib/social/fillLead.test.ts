// Run: npm test -- src/lib/social/fillLead.test.ts
//
// Details read later (an ad form in a Messenger message, a profile lookup that
// finally worked) only fill a lead's empty fields; they never overwrite.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { fillLeadContact, getLead, upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const { parseFormDetails } = requireLocal("./formDetails") as typeof import("./formDetails");

  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

  const slug = "fill-lead-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Fill Lead Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    await runWithTenant(tid, async () => {
      // An anonymous Messenger lead fills in from its ad form.
      const { lead: anon } = upsertLead({ source: "messenger", sourceLeadId: "page:123", notes: "Started a conversation on Messenger." });
      const form = parseFormDetails("Full name: marina hewitt\nPhone number: 089 401 8010\nEmail: marina@x.ie");
      assert.equal(fillLeadContact(anon.id, form), true);
      const filled = getLead(anon.id)!;
      assert.deepEqual([filled.firstName, filled.lastName, filled.email, filled.phone], ["Marina", "Hewitt", "marina@x.ie", "089 401 8010"]);

      // Nothing already set is overwritten, and a second fill changes nothing.
      assert.equal(fillLeadContact(anon.id, { firstName: "Someone", lastName: "Else", email: "other@x.ie", phone: "0870000000" }), false);
      assert.equal(getLead(anon.id)!.firstName, "Marina");
      assert.equal(getLead(anon.id)!.email, "marina@x.ie");

      // A lead with a first name keeps its own (empty) last name: names fill as a pair.
      const { lead: named } = upsertLead({ source: "messenger", sourceLeadId: "page:456", fullName: "Deirdre" });
      fillLeadContact(named.id, { firstName: "Other", lastName: "Name", email: "d@x.ie" });
      const n = getLead(named.id)!;
      assert.deepEqual([n.firstName, n.lastName, n.email], ["Deirdre", null, "d@x.ie"]);
    });
    console.log("social/fillLead: ok");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
