// Run: npm test -- src/lib/cms/enquiry.test.ts
import assert from "node:assert/strict";

import {
  ENQUIRY_HONEYPOT_FIELD,
  enquiryNotes,
  isEnquiryHoneypotTripped,
  programmeLabel,
  programmesForSite,
  safeReturnPath,
  sameOriginRefererPath,
  validateEnquiry,
} from "./enquiry";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const good = validateEnquiry({ name: "  Mary Byrne ", phone: "086 123 4567", programme: "studio60", about: "Had a stent in March." });
check("valid -> ok", good.ok);
if (good.ok) {
  check("name trimmed", good.data.name === "Mary Byrne");
  check("email null when blank", good.data.email === null);
  check("programme kept", good.data.programme === "studio60");
  check("notes carry programme label and about", enquiryNotes(good.data) === "Programme: Studio 60\nAbout: Had a stent in March.");
}
// Flipped when programmes became per-site: a non-empty programme the site could
// not have offered is now refused rather than rewritten to "unsure", so that a
// form and the server cannot drift without anyone noticing. A submission with
// no programme at all still lands, unchanged -- the check below pins that.
check("unknown programme -> error", (() => { const r = validateEnquiry({ name: "A", phone: "1", programme: "hacker" }); return !r.ok && /choose/i.test(r.error); })());
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

check("referer path: same origin -> its path", sameOriginRefererPath("http://localhost:3000/site/healthwise/contact?x=1", "http://localhost:3000/api/site/enquiry") === "/site/healthwise/contact");
check("referer path: cross origin -> null", sameOriginRefererPath("https://evil.example/site/healthwise/contact", "http://localhost:3000/api/site/enquiry") === null);
check("referer path: missing -> null", sameOriginRefererPath(null, "http://localhost:3000/api/site/enquiry") === null);
check("referer path: garbage -> null", sameOriginRefererPath("not a url", "http://localhost:3000/api/site/enquiry") === null);

// --- per-site programmes -----------------------------------------------------
// The module is named for every bespoke site, so the programme list belongs to
// the site, not to the module. The sets live here rather than in each site's
// markup because the server has to refuse a programme the form could not have
// offered -- a check the form itself cannot be trusted to have made.
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

check(
  "a site's programme set is its own",
  sameList(programmesForSite("healthwise"), ["livewell", "studio60", "heartwise", "unsure"]) &&
    sameList(programmesForSite("optimal-health"), ["hbot", "infrared", "hifem", "massage", "unsure"]),
);
check("an unknown site falls back to the one neutral option", sameList(programmesForSite("nobody"), ["unsure"]));
check(
  "a programme from another site is rejected",
  (() => {
    const r = validateEnquiry({ name: "Aoife", phone: "0838672844", programme: "livewell" }, "optimal-health");
    return !r.ok;
  })(),
);
check(
  "optimal-health accepts its own therapies",
  (() => {
    const r = validateEnquiry({ name: "Aoife", phone: "0838672844", programme: "hifem" }, "optimal-health");
    return r.ok && r.data.programme === "hifem";
  })(),
);
check(
  "healthwise still validates with no slug passed",
  (() => {
    const r = validateEnquiry({ name: "Aoife", phone: "0838672844", programme: "studio60" });
    return r.ok;
  })(),
);
check(
  "a label comes from the site that offers it",
  programmeLabel("optimal-health", "hifem") === "HIFEM chair" && programmeLabel("healthwise", "livewell") === "Livewell 40–60",
);
check("a label the site does not offer is the raw value", programmeLabel("optimal-health", "livewell") === "livewell");
check(
  "notes take the site's own label",
  enquiryNotes({ name: "Aoife", email: null, phone: "0838672844", programme: "hifem", about: null }, "optimal-health") ===
    "Programme: HIFEM chair",
);

console.log(`enquiry.test.ts: ${passed} checks passed`);
