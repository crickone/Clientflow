// Run: npm test -- src/lib/cms/enquiry.test.ts
import assert from "node:assert/strict";

import { ENQUIRY_HONEYPOT_FIELD, enquiryNotes, isEnquiryHoneypotTripped, safeReturnPath, validateEnquiry } from "./enquiry";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const good = validateEnquiry({ name: "  Mary Byrne ", phone: "086 123 4567", programme: "vitality", about: "Had a stent in March." });
check("valid -> ok", good.ok);
if (good.ok) {
  check("name trimmed", good.data.name === "Mary Byrne");
  check("email null when blank", good.data.email === null);
  check("programme kept", good.data.programme === "vitality");
  check("notes carry programme label and about", enquiryNotes(good.data) === "Programme: Vitality 60+\nAbout: Had a stent in March.");
}
check("unknown programme -> unsure", (() => { const r = validateEnquiry({ name: "A", phone: "1", programme: "hacker" }); return r.ok && r.data.programme === "unsure"; })());
check("blank programme -> unsure", (() => { const r = validateEnquiry({ name: "A", email: "a@b.ie" }); return r.ok && r.data.programme === "unsure"; })());
check("missing name -> error", (() => { const r = validateEnquiry({ phone: "1" }); return !r.ok && /name/i.test(r.error); })());
check("no phone and no email -> error", (() => { const r = validateEnquiry({ name: "A" }); return !r.ok && /phone/i.test(r.error); })());
check("bad email -> error", (() => { const r = validateEnquiry({ name: "A", email: "not-an-email" }); return !r.ok && /email/i.test(r.error); })());
check("about over 1000 chars -> error", (() => { const r = validateEnquiry({ name: "A", phone: "1", about: "x".repeat(1001) }); return !r.ok; })());
check("name over 120 chars -> error", (() => { const r = validateEnquiry({ name: "x".repeat(121), phone: "1" }); return !r.ok; })());

check("honeypot field name", ENQUIRY_HONEYPOT_FIELD === "company_website");
check("honeypot tripped when filled", isEnquiryHoneypotTripped({ company_website: "http://spam" }));
check("honeypot not tripped when blank", !isEnquiryHoneypotTripped({ company_website: "  " }));

check("return path: relative kept", safeReturnPath("/contact") === "/contact");
check("return path: query and hash stripped", safeReturnPath("/site/healthwise/contact?x=1#book") === "/site/healthwise/contact");
check("return path: absolute url refused", safeReturnPath("https://evil.example/") === "/contact");
check("return path: protocol-relative refused", safeReturnPath("//evil.example") === "/contact");
check("return path: missing -> fallback", safeReturnPath(undefined) === "/contact");
check("return path: tab smuggling refused", safeReturnPath("/\t/evil.example") === "/contact");
check("return path: newline smuggling refused", safeReturnPath("/\n/evil.example") === "/contact");
check("return path: carriage return refused", safeReturnPath("/\r/evil.example") === "/contact");
check("return path: encoded slashes stay a path", safeReturnPath("/%2f%2fevil.example") === "/%2f%2fevil.example");

console.log(`enquiry.test.ts: ${passed} checks passed`);
