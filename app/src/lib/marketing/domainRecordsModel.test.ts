// Run: npm test -- src/lib/marketing/domainRecordsModel.test.ts
import assert from "node:assert/strict";

import { hostPart, recordFound, recordJob, rootOf } from "./domainRecordsModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const spf = { type: "TXT", name: "mg.gym.ie", value: "v=spf1 include:mailgun.org ~all" };
const dkim = { type: "TXT", name: "mta._domainkey.mg.gym.ie", value: "k=rsa; p=MIGf" };
const cname = { type: "CNAME", name: "email.mg.gym.ie", value: "eu.mailgun.org", valid: false };

check("SPF is the sending permission", recordJob(spf).key === "spf");
check("a _domainkey TXT is the signature", recordJob(dkim).key === "dkim");
check("the CNAME is tracking", recordJob(cname).key === "tracking");
check("MX is bounce handling", recordJob({ type: "mx", name: "mg.gym.ie", value: "mxa.eu.mailgun.org" }).key === "mx");
check("anything else is named by its type", recordJob({ type: "A", name: "x", value: "1.2.3.4" }).title === "A record");

check("the provider's word wins", recordFound(cname, true) === false);
check("without one, the domain's state decides", recordFound(spf, true) && !recordFound(spf, false));

check("root of a subdomain", rootOf("mg.inspirehealthandfitness.ie") === "inspirehealthandfitness.ie");
check("root keeps co.uk", rootOf("mg.example.co.uk") === "example.co.uk");
check("host part strips the root", hostPart("mta._domainkey.mg.gym.ie", "gym.ie") === "mta._domainkey.mg");
check("the root itself is @", hostPart("gym.ie", "gym.ie") === "@");
check("a name outside the root is left alone", hostPart("other.ie", "gym.ie") === "other.ie");

console.log(`domainRecordsModel: ${passed} checks passed`);
