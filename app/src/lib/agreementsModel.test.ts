// Run: npm test -- src/lib/agreementsModel.test.ts
//
// What a member agrees to before they use the client app, and how we know
// whether they have agreed to the current text.
import assert from "node:assert/strict";

import { agreementStatus, businessTermsDoc, pendingDocs, platformDocs, textVersion, toBlocks } from "./agreementsModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const biz = { name: "Inspire Health & Fitness", email: "hello@inspire.ie", phone: "083 000 0000" };
const docs = platformDocs(biz);
check("three platform documents", docs.map((d) => d.key).join() === "platform:terms,platform:privacy,platform:health");
check("they name the business", docs.every((d) => d.body.includes("Inspire Health & Fitness")));
check("the contact line carries the business's email and phone", docs[0].body.includes("email hello@inspire.ie or call 083 000 0000"));
check("no contact details still reads", platformDocs({ name: "Gym", email: "", phone: "" })[1].body.includes("Gym, at the front desk."));
check("no placeholder text left in", docs.every((d) => !/\{\{|\[|TODO|lorem/i.test(d.body)));

const terms = businessTermsDoc({ id: 7, title: "Terms & Conditions", content: "1. Cancel with 30 days notice.\n2. No freezes." }, biz.name);
check("a business's terms are keyed by form", terms.key === "form:7" && terms.owner === "business");
check("the version is the text's hash", terms.version === textVersion("1. Cancel with 30 days notice.\n2. No freezes."));
check("whitespace and line endings don't change the version", textVersion("a\r\nb  ") === textVersion("a\nb"));
check("any edit does", textVersion("No freezes.") !== textVersion("No freezes!"));
check("an untitled terms form still has a title", businessTermsDoc({ id: 1, title: " ", content: "x" }, "G").title === "Terms & Conditions");

const required = [...docs, terms];
check("a new member has everything to agree to", pendingDocs(required, []).length === 4);
const acceptedAll = required.map((d) => ({ docKey: d.key, version: d.version, acceptedAt: 1000 }));
check("after agreeing, nothing is pending", pendingDocs(required, acceptedAll).length === 0);
const edited = businessTermsDoc({ id: 7, title: "Terms & Conditions", content: "1. Cancel with 60 days notice.\n2. No freezes." }, biz.name);
check("an edit to the gym's terms asks again, for that one only", pendingDocs([...docs, edited], acceptedAll).map((d) => d.key).join() === "form:7");

const status = agreementStatus([...docs, edited], acceptedAll);
const t = status.find((s) => s.doc.key === "form:7")!;
check("staff see when an older version was agreed, marked not current", t.acceptedAt === 1000 && !t.current);
check("and the rest as current", status.filter((s) => s.current).length === 3);
check("never agreed is null", agreementStatus(docs, [])[0].acceptedAt === null);

const blocks = toBlocks("## Heading\nLine one\nline two\n\n- item\n2. numbered\n\nEnd");
check("headings, paragraphs and lists split out", blocks.map((b) => b.kind).join() === "h,p,li,li,p" && blocks[1].text === "Line one line two");

console.log(`agreementsModel: ${passed} checks passed`);
