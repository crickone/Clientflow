// Run: npm test -- src/lib/adonisMap/decisions.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { clients, leads } = requireLocal("../db/schema") as typeof import("../db/schema");
  const { withScratchTenant } = requireLocal("./testSupport") as typeof import("./testSupport");
  const { personLinksForClient, personLinksForLead, setDecision } = requireLocal("./decisions") as typeof import("./decisions");

  await withScratchTenant("adonis-map-decisions-a", async (tid) => {
    const db = getTenantDbById(tid);
    const niamh = db.insert(clients).values({ firstName: "Niamh", lastName: "Byrne", phone: "087 555 0142", email: "niamh.byrne@example.com" }).returning().get();
    const niamhLead = db.insert(leads).values({ firstName: "Niamh", lastName: "Byrne", phone: "+353 87 555 0142", source: "facebook" }).returning().get();
    const sean = db.insert(leads).values({ firstName: "Sean", lastName: "Byrne", phone: "0875550142", source: "walk-in" }).returning().get();

    let c = personLinksForClient(tid, niamh.id);
    assert.deepEqual(c.linked.map((l) => [l.leadId, l.reason, l.canUnlink, l.href]), [[niamhLead.id, "Same email or phone and first name", true, `/leads/${niamhLead.id}`]]);
    assert.deepEqual(c.reviews.map((l) => [l.leadId, l.name, l.reason]), [[sean.id, "Sean Byrne", "Same phone, different first name"]]);
    assert.equal(c.reviews[0].detail, "0875550142");

    const s = personLinksForLead(tid, sean.id);
    assert.deepEqual(s.reviews.map((l) => [l.clientId, l.name, l.href]), [[niamh.id, "Niamh Byrne", `/clients/${niamh.id}`]]);
    assert.deepEqual(s.linked, []);
    assert.deepEqual(personLinksForLead(tid, niamhLead.id).linked.map((l) => l.clientId), [niamh.id]);

    assert.equal(setDecision(tid, sean.id, niamh.id, "join", 7), true);
    c = personLinksForClient(tid, niamh.id);
    assert.deepEqual(c.linked.map((l) => [l.leadId, l.reason]), [[niamhLead.id, "Same email or phone and first name"], [sean.id, "Joined by staff"]]);
    assert.deepEqual(c.reviews, []);

    // Unlink is a "separate" decision on the same pair, and it overrides the earlier join.
    assert.equal(setDecision(tid, sean.id, niamh.id, "separate", 7), true);
    assert.equal(setDecision(tid, niamhLead.id, niamh.id, "separate", 7), true);
    c = personLinksForClient(tid, niamh.id);
    assert.deepEqual(c.linked, [], "both leads unlinked");
    assert.deepEqual(c.reviews, [], "a separated pair is not offered for review again");

    // A converted lead can't be unlinked.
    const ella = db.insert(clients).values({ firstName: "Ella", lastName: "Martin", phone: "0860000001" }).returning().get();
    db.insert(leads).values({ firstName: "Ella", lastName: "Martin", source: "website", clientId: ella.id }).run();
    assert.deepEqual(personLinksForClient(tid, ella.id).linked.map((l) => [l.reason, l.canUnlink]), [["Converted", false]]);

    assert.equal(setDecision(tid, 99999, niamh.id, "join", 7), false, "unknown lead");
    assert.equal(setDecision(tid, sean.id, 99999, "join", 7), false, "unknown client");

    // Another business can't decide on these ids: they don't exist in its DB.
    await withScratchTenant("adonis-map-decisions-b", (other) => {
      assert.equal(setDecision(other, sean.id, niamh.id, "join", 7), false);
    });
  });
  console.log("decisions.test.ts: all assertions passed");
})();
