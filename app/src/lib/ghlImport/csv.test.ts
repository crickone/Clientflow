// Run: npm test -- src/lib/ghlImport/csv.test.ts
//
// Reading GoHighLevel's two exports by column name, and writing the
// dry-run download. Every person here is invented.
import assert from "node:assert/strict";

import { headerKey, parseDaysInStage, parseGhlContacts, parseGhlOpportunities, parseTagList, toCsv } from "./csv";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

// Column names: case, trailing spaces and doubled spaces do not matter.
ok(headerKey("Days since last stage change ") === "days since last stage change", "trailing space trimmed");
ok(headerKey("  Treatment   interested in") === "treatment interested in", "runs of spaces collapsed");
ok(headerKey("﻿Contact Id") === "contact id", "a byte-order mark is dropped");

// Days in stage, as GoHighLevel writes them.
ok(parseDaysInStage("75 Days ") === 75, "75 Days");
ok(parseDaysInStage("1 Day") === 1, "1 Day");
ok(parseDaysInStage(" Today") === 0, "Today is 0");
ok(parseDaysInStage("") === null, "blank is unknown");
ok(parseDaysInStage("soon") === null, "anything else is unknown");

// Tags: comma-separated, lowercased, trimmed, no repeats.
assert.deepEqual(parseTagList("Lead, Long Term Nurture,lead,  call back "), ["lead", "long term nurture", "call back"]);
n++;
assert.deepEqual(parseTagList(""), []);
n++;

const CONTACTS = [
  "﻿Contact Id,First Name,Last Name,Phone,Email,Business Name,Created,Last Activity,Tags,DND,Date of Birth,Source,utm Campaign ,Treatment interested in,Location,Medical Condition,Used treatments before?",
  'c-1,Aoife,Example,+353870000001,AOIFE@example.com ,,2026-08-01T10:00:00+01:00,"Nov 25 2026 02:12 PM","lead, long term nurture",,,Facebook,,Infrared Therapy,Clonmel,"Fake condition, with a comma",no',
  "c-2,Brian,Sample,,brian@example.com,,not a date,,,true,,,,,,,",
  ",Nobody,Here,,,,,,,,,,,,,,",
].join("\r\n");

const c = parseGhlContacts(CONTACTS);
assert.ok(c.ok);
n++;
if (c.ok) {
  ok(c.rows.length === 2, "a row with no contact id is dropped");
  const a = c.rows[0];
  ok(a.contactId === "c-1" && a.firstName === "Aoife" && a.lastName === "Example", "names");
  ok(a.email === "AOIFE@example.com", "values are trimmed, case kept (the planner lowercases emails)");
  ok(a.createdAt === Date.parse("2026-08-01T10:00:00+01:00"), "created date read");
  assert.deepEqual(a.tags, ["lead", "long term nurture"]);
  n++;
  ok(a.dnd === false && c.rows[1].dnd === true, "DND true read");
  ok(a.treatment === "Infrared Therapy" && a.town === "Clonmel" && a.usedBefore === "no", "custom fields read by name");
  ok(a.medicalCondition === "Fake condition, with a comma", "a quoted field keeps its comma");
  ok(c.rows[1].createdAt === null, "an unreadable date is null");
}

const OPPS = [
  "Opportunity name,Contact Name,phone,email,pipeline,stage,Lead Value,source,assigned,Created on,Updated on,lost reason ID,lost reason name,Followers,Notes,tags,Engagement score,status,Opportunity ID,Contact ID,Pipeline Stage ID,Pipeline ID,Days since last stage change ,Days since last status change ,Days since last update ",
  'Aoife Example,Aoife Example,+353870000001,aoife@example.com,Main Leads,Long Term Nurture,0,Facebook,Sandra Example,2026-08-01T09:00:00.000Z,2026-09-01T09:00:00.000Z,,,,"Rang twice\nNo answer",lead,0,open,o-1,c-1,s-1,p-1,30 Days ,40 Days ,30 Days ',
  "Brian Sample,Brian Sample,,brian@example.com,Main Leads,Consult  Booked,0,,,2026-08-02T09:00:00.000Z,,,,,,,0,open,o-2,c-2,s-2,p-1, Today, Today, Today",
].join("\n");

const o = parseGhlOpportunities(OPPS);
assert.ok(o.ok);
n++;
if (o.ok) {
  ok(o.rows.length === 2, "two opportunities");
  const a = o.rows[0];
  ok(a.opportunityId === "o-1" && a.contactId === "c-1" && a.stage === "Long Term Nurture", "ids and stage");
  ok(a.daysInStage === 30, "days in stage from the column with a trailing space");
  ok(a.notes === "Rang twice\nNo answer", "a quoted note keeps its line break");
  ok(a.assigned === "Sandra Example" && a.source === "Facebook", "assigned and source");
  ok(a.updatedAt === Date.parse("2026-09-01T09:00:00.000Z"), "updated date");
  ok(o.rows[1].stage === "Consult  Booked" && o.rows[1].daysInStage === 0, "stage kept as written; Today is 0");
}

// The wrong file in the wrong box says so.
const swapped = parseGhlContacts(OPPS);
ok(!swapped.ok && /opportunities/i.test(swapped.error), "an opportunities export in the contacts box is refused");
const notOpps = parseGhlOpportunities(CONTACTS);
ok(!notOpps.ok && /stage/i.test(notOpps.error), "a contacts export in the opportunities box is refused");
ok(!parseGhlContacts("").ok, "an empty file is refused");
ok(!parseGhlContacts("Name,Email\nA,a@example.com").ok, "a file with no Contact Id column is refused");

// Writing the download.
const csv = toCsv([
  ["Name", "Notes", "Phone"],
  ['Ann "The Boss" Example', "line one\nline two", "+353870000001"],
  ["=HYPERLINK(1)", "a, b", "-"],
  [null, undefined, 7],
]);
const lines = csv.split("\r\n");
ok(lines[0] === "Name,Notes,Phone", "header row");
ok(lines[1] === '"Ann ""The Boss"" Example","line one\nline two",+353870000001', "quotes doubled; a line break is quoted");
ok(csv.includes('"\'=HYPERLINK(1)"') || csv.includes("'=HYPERLINK(1)"), "a formula is defused");
ok(csv.includes("+353870000001"), "a phone number with a plus is left alone");
ok(csv.endsWith(",,7\r\n"), "null and undefined are empty; numbers written; CRLF at the end");

console.log(`ghlImport csv: ${n} checks passed.`);
