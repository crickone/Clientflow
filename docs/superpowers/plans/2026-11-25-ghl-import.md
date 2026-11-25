# Import from GoHighLevel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin screen, Settings > Import > GoHighLevel, that reads GoHighLevel's contacts and opportunities exports, shows a dry run of what happens to every person, and imports them with one click into the right column and the right point of the lead follow-ups, sending nothing itself.

**Architecture:** Pure modules under `app/src/lib/ghlImport/` read the CSVs (`csv.ts`), decide each person's destination from the agreed rules (`mapping.ts`), place them part-way through a flow (`placement.ts`) and build the whole dry run from a snapshot of the business (`plan.ts`). Server-only modules load that snapshot (`snapshot.ts`), carry the plan out with direct writes that fire no side effects (`apply.ts`), and keep the per-person import record with the staff-only medical note (`store.ts`). The lead-flow engine gains imported runs (`lib/leadFlows/importedRuns.ts`): rows placed by the importer, held while their flow is off and released, with past steps skipped, when it is switched on.

**Tech Stack:** Next.js 15 App Router, better-sqlite3 + drizzle-orm, plain `node:assert` tests run with tsx (`npm test -- <path>` from `app/`), lucide-react icons, CSS module for the import screen.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-25-ghl-import-design.md`. Every rule below comes from it or from the Decisions section.
- NO EMOJIS anywhere: UI, code, comments, copy, logs, commit messages. Icons are `lucide-react`.
- Plain copy: short factual sentences. No "not just X", no "X rather than Y", no warm filler.
- Controls are never cramped: buttons and selects keep at least 12px side padding; selects use the global chevron (36px right padding).
- Every colour comes from the app tokens (`--surface-1`, `--surface-2`, `--hairline`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--accent`, `--accent-contrast`, `--danger`, `--success`, `--warning`, `--info` and their `-soft` forms) so dark and light both work.
- The import sends nothing and fires no notifications, alerts, AI drafts or scoring, Meta (CAPI) events, voice calls or sequences. It never calls `upsertLead`, `writeStageId`, `setStageToId`, `advanceStage`, `startFlow`, `notifyNewLead`, `alertNewLead` or `setLeadMarketingConsent`.
- Idempotent: re-running with the same files changes nothing. GoHighLevel contact ids are stored (`ghl_import_people.ghl_contact_id`, unique; `leads.source = "gohighlevel"`, `leads.source_lead_id = <contact id>`).
- Admin only: the API route uses `guard("admin")`, pages use `requireAdminPage()`.
- The medical condition is a STAFF-ONLY note: stored only in `ghl_import_people.staff_medical_note`, shown on the lead and client pages, never in `leads`/`clients` rows, never in a dry-run response or download, never in AI context, messages or exports.
- Consent source string, exactly: `Carried over from GoHighLevel (operator decision 2026-11-25)`.
- Stale threshold: 14 days (`STALE_AFTER_DAYS = 14`). Long-term nurture runs to week 12 = day 77 (from the Optimal Health preset in `lib/leadFlows/presets.ts`).
- No catch-up bursts: a step whose time has passed is skipped; nobody gets more than one message on the import day; steps fall inside sending hours (`fitToWindow`).
- Imported runs only send while their flow is switched on.
- No new npm packages. CSV parsing reuses `parseCsv` from `app/src/lib/memberImport.ts` (already tested, RFC 4180 quoting, BOM, CRLF).
- Tests use invented people only (`@example.com`, `+35387000....`). Never copy the real exports into the repo, fixtures, logs or test output.
- Commit messages end with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage files by name; never `git add -A`.
- Every task ends with `npm run typecheck` clean (from `app/`) and its own tests passing.

## Decisions made from the code (the design left these open)

1. **Where it lives:** `/settings/import` (a small index: GoHighLevel, and the existing members spreadsheet at `/clients/import`) and `/settings/import/gohighlevel`. Files go to `POST /api/import/gohighlevel` as multipart form data, because Server Actions cap bodies at 1 MB and the real exports are 0.6 MB and 0.9 MB.
2. **The import record:** one tenant table, `ghl_import_people`, one row per GoHighLevel contact processed (any outcome), unique on `ghl_contact_id`. It holds the links (lead, client, marketing contact), the GoHighLevel stage and days, source, tags, treatment, used-before, town and the staff-only medical note. Re-runs skip any contact id already there.
3. **Tags:** kept on the import record and shown as chips on the lead and client pages. They are not added to the inbox tag vocabulary (`tags`/`conversation_tags`), which is the AI triage's controlled set; 160 GoHighLevel tags would flood it.
4. **Source:** `leads.source = "gohighlevel"` (never `"facebook"`, so no CAPI event can fire for these leads later). GoHighLevel's own source ("Facebook", "Optimal health sign up form") is kept on the import record and shown on the page.
5. **Do not contact:** a new `leads.do_not_contact` flag (person-clearable from the lead page, "Allow contact again"), plus `do_not_call`, plus the address on the do-not-email list (`suppress(..., "manual")`, which already blocks every campaign and flow email and stops the lead's flows), plus a "no" for email and WhatsApp in `client_consents` for clients (WhatsApp broadcasts only go to a "yes"). `startFlow` and `placeImportedRun` refuse a do-not-contact lead. For a person already in Adonis, do-not-contact wins over "never touch someone already in a flow": their flows stop.
6. **Duplicates:** matched by email (lowercased) or phone (`normalizePhone` from `lib/whatsapp/phone.ts`, at least 7 digits). Matched lead in an active run, on another board, or whose latest stage move (`lead_stage_events.at`, else `created_at`) is at or after the GoHighLevel stage time: only empty fields are filled. A person already an Adonis client (no lead) whose GoHighLevel target is a lead column is left alone ("Already a client here"). Two contacts in the files with the same email or phone: the one with an opportunity is imported (else the first in the file), the other is recorded as skipped. A GoHighLevel stage time that is unknown (no days in stage, no created date) counts as the oldest, so a matched Adonis lead is only filled.
7. **Stage time:** `exportDay - N days`, at the start of sending hours that day (`morningOf`). Stage events for imported leads are written with that time (`lead_stage_events.at`), and `leads.created_at` is GoHighLevel's Created date, so dashboards do not count 2,000 new leads today.
8. **"Next step after day N":** a step whose offset is at most N days was done in GoHighLevel. Of the rest, a step whose fitted time is before now is skipped; of the steps on the import day only the first is kept. "Past its end" means the finish move time has passed (or, with no finish, no step is left). A flow past its end moves on to its finish column, and that column's flow starts from week 1 on the next sending day (Decision 17).
9. **Flows by column:** the flow for a column is the first lead flow (catalog order) whose start column is that column, on or off. Message undelivered has no flow by default, so those people are placed in the column with no run; if an operator points a flow at it, it runs email-only. New lead uses the `new_lead` flow (started by its trigger, not a column). Consult booked, Holding, Send deposit link, Won and Lost get no flow.
10. **Flow off at import:** runs are placed with rows in a new queue status `held`. The dispatcher also turns a due imported row into `held` when its flow is off. Switching a flow on (`setTriggerEnabled` or saving the flow in `/automations`) releases its held rows: past messages are cancelled, at most one message per run goes that day, a past finish move happens now.
11. **Consent:** recorded on every imported lead that is not lost and not do-not-contact, unless the address is on the suppression list (any reason). Clients are not added to marketing contacts by the import. Contacts-only people with an email are added to Email campaigns > Contacts, subscribed, tagged `gohighlevel`.
12. **Assigned user:** GoHighLevel's "assigned" name is matched to active staff by full name, then by a unique first name; the screen lists each GoHighLevel user with a select so the operator can correct it (for example "Daniel O Dwyer" to "DJ"). No match: the business's default assignee (Settings > Lead follow-ups), else nobody.
13. **Scoring:** the ticker's Jev scoring skips a `gohighlevel` lead until they reply: no inbound lead message on file (`scoreDue` gains `importedUntouched`). The flows' own outbound messages do not count, so the first follow-up WhatsApp does not start scoring thousands of leads. The latest message of any direction still sets the lead's last activity. Writes by the import never bump an existing lead's `updated_at`.
14. **Export date default:** the opportunities file's last-modified day (the day it was downloaded), else today; the operator confirms it on the screen.
15. **Deleting a person:** `forgetImportedPerson` clears the personal fields of the import record (medical note, tags, treatment, town...) but keeps the GoHighLevel ids, so a re-import does not bring a deleted person back. The platform console's delete (`lib/platform/data.ts deletePerson`) does the same on the tenant connection, and its subject access export includes the person's import record.
16. **Lapse job:** a customer lead with `source = "gohighlevel"` counts as active for 90 days (`LAPSE_DAYS`) from its import (`ghl_import_people.imported_at`, the lead's latest record; `lib/pipeline/lapse.ts` reads that column only). Without it, every imported Won lead, with no visits or payments in Adonis yet, would be moved to Lapsed by the next day's run. After 90 days with no visit or payment, it lapses like any customer.
17. **Spreading messages:** each person's placed times are spread across the sending window by their GoHighLevel contact id, so imported messages do not all fall due at the minute sending opens. `spreadMs(contactId, window) = (FNV-1a(contactId) mod slots) * 60_000`, with `slots = max(1, windowMinutes - 60)` and `windowMinutes = end - start` (no hours saved: 12 hours, the 09:00-21:00 WhatsApp window), so the spread ends at least an hour before the window closes. The planner's fit adds the spread only when `fitToWindow` moved a time to an opening. A resumed run starts at the GoHighLevel stage time plus the spread (the stage time itself, used for the "moved more recently in Adonis" comparison and for the stage event, stays unspread). A fresh start (stale to nurture week 1, or a flow past its end moving on) starts at the opening of the next sending day plus the spread, so nobody gets a message on the import day from it; the column entry time stays now. The same files give the same times on every run.

---

## File Structure

New, pure (no `server-only`, no DB; load under the plain test runner and in the browser):
- `app/src/lib/ghlImport/csv.ts` - read the two exports by column name; write a CSV (for the download).
- `app/src/lib/ghlImport/mapping.ts` - the agreed stage/tag rules for one person; staff name matching; constants.
- `app/src/lib/ghlImport/placement.ts` - which steps of a flow a person still gets, and when.
- `app/src/lib/ghlImport/plan.ts` - the whole dry run from the files and a snapshot; dry-run rows and CSV.
- `app/src/lib/ghlImport/types.ts` - response and view types shared by the route, the store and the UI.
- `app/src/lib/leadFlows/heldRows.ts` - which held rows go and which are skipped when a flow is switched on.

New, server-only:
- `app/src/lib/ghlImport/snapshot.ts` - read this business into the planner's `Snapshot`.
- `app/src/lib/ghlImport/apply.ts` - carry a plan out; the Holding column.
- `app/src/lib/ghlImport/store.ts` - read, forget, and allow-contact-again for imported people.
- `app/src/lib/ghlImport/run.ts` - the two entry points the route calls: dry run and import.
- `app/src/lib/leadFlows/importedRuns.ts` - place an imported run; release held rows.
- `app/src/app/api/import/gohighlevel/route.ts` - the upload endpoint.
- `app/src/app/settings/import/page.tsx`, `app/src/app/settings/import/gohighlevel/page.tsx`.
- `app/src/components/settings/ghlImport/GhlImportWizard.tsx`, `views.tsx`, `ghlImport.module.css`.
- `app/src/components/people/GhlImportCard.tsx`, `AllowContactButton.tsx`.

Tests (new): `csv.test.ts`, `mapping.test.ts`, `placement.test.ts`, `plan.test.ts`, `import.e2e.test.ts`, `medicalNote.guard.test.ts` in `lib/ghlImport/`; `heldRows.test.ts`, `importedRuns.test.ts` in `lib/leadFlows/`.

Modified: `lib/db/schema.ts`, `lib/db/tenant.ts`, `lib/leadFlows/flowModel.ts`, `lib/leadFlows/runs.ts`, `lib/leadFlows/dispatch.ts`, `lib/leadFlows/consent.ts`, `lib/leadFlows/activityModel.ts`, `lib/automations.ts`, `lib/leadScoreModel.ts`, `lib/leadScore.ts`, `app/settings/page.tsx`, `app/leads/[id]/page.tsx`, `app/leads/actions.ts`, `app/clients/[id]/page.tsx`, `app/clients/actions.ts`, `components/leads/LeadDetail.tsx`.

---

### Task 1: Reading the GoHighLevel exports (pure)

**Files:**
- Create: `app/src/lib/ghlImport/csv.ts`
- Test: `app/src/lib/ghlImport/csv.test.ts`

**Interfaces:**
- Consumes: `parseCsv(text): { headers: string[]; rows: string[][]; delimiter: string }` from `app/src/lib/memberImport.ts`.
- Produces (used by Tasks 5, 6, 7):
  - `interface GhlContact { contactId; firstName; lastName; phone; email; createdAt: number | null; tags: string[]; dnd: boolean; source; treatment; town; medicalCondition; usedBefore }` (strings are trimmed, "" when missing)
  - `interface GhlOpportunity { opportunityId; contactId; contactName; phone; email; pipeline; stage; source; assigned; createdAt: number | null; updatedAt: number | null; notes; tags: string[]; daysInStage: number | null }`
  - `type ReadResult<T> = { ok: true; rows: T[] } | { ok: false; error: string }`
  - `parseGhlContacts(text: string): ReadResult<GhlContact>`
  - `parseGhlOpportunities(text: string): ReadResult<GhlOpportunity>`
  - `parseDaysInStage(raw: string): number | null`, `parseTagList(raw: string): string[]`, `headerKey(h: string): string`
  - `toCsv(rows: (string | number | null | undefined)[][]): string`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/ghlImport/csv.test.ts`:

```ts
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
ok(lines[1] === '"Ann ""The Boss"" Example","line one', "quotes doubled; a line break is quoted");
ok(csv.includes('"\'=HYPERLINK(1)"') || csv.includes("'=HYPERLINK(1)"), "a formula is defused");
ok(csv.includes("+353870000001"), "a phone number with a plus is left alone");
ok(csv.endsWith(",,7\r\n"), "null and undefined are empty; numbers written; CRLF at the end");

console.log(`ghlImport csv: ${n} checks passed.`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `app/`): `npm test -- src/lib/ghlImport/csv.test.ts`
Expected: FAIL, `Cannot find module './csv'`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/ghlImport/csv.ts`:

```ts
/**
 * Reading GoHighLevel's contacts and opportunities exports, and writing the
 * dry-run download. Pure: no DB, no server-only.
 *
 * Columns are found by name, case-insensitive, trimmed, with runs of spaces
 * collapsed ("Days since last stage change " matches), because the columns
 * an export carries vary by account and by what was ticked when exporting.
 * The quoting rules are memberImport's parseCsv (RFC 4180: quoted commas,
 * line breaks and doubled quotes; a byte-order mark; CRLF).
 */
import { parseCsv } from "@/lib/memberImport";

export interface GhlContact {
  contactId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  /** Epoch ms, or null when missing or unreadable. */
  createdAt: number | null;
  tags: string[];
  dnd: boolean;
  source: string;
  treatment: string;
  town: string;
  medicalCondition: string;
  usedBefore: string;
}

export interface GhlOpportunity {
  opportunityId: string;
  contactId: string;
  contactName: string;
  phone: string;
  email: string;
  pipeline: string;
  stage: string;
  source: string;
  assigned: string;
  createdAt: number | null;
  updatedAt: number | null;
  notes: string;
  tags: string[];
  /** Whole days since the last stage change, as of the export date; null when missing. */
  daysInStage: number | null;
}

export type ReadResult<T> = { ok: true; rows: T[] } | { ok: false; error: string };

export function headerKey(h: string): string {
  return (h ?? "").replace(/^﻿/, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function indexOf(headers: string[], ...names: string[]): number {
  const keys = headers.map(headerKey);
  for (const name of names) {
    const i = keys.indexOf(headerKey(name));
    if (i >= 0) return i;
  }
  return -1;
}

function cell(row: string[], i: number): string {
  return i >= 0 ? (row[i] ?? "").trim() : "";
}

/** "a, B,a" -> ["a", "b"]: lowercased, trimmed, no repeats. */
export function parseTagList(raw: string): string[] {
  const out: string[] = [];
  for (const t of (raw ?? "").split(",")) {
    const k = t.trim().replace(/\s+/g, " ").toLowerCase();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** "75 Days", "1 Day", "Today" -> 75, 1, 0. Anything else -> null. */
export function parseDaysInStage(raw: string): number | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "today") return 0;
  const m = /^(\d+)\s*days?$/.exec(s);
  return m ? Number(m[1]) : null;
}

function parseTimestamp(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function isTrue(raw: string): boolean {
  return ["true", "yes", "y", "1"].includes((raw ?? "").trim().toLowerCase());
}

function looksLikeOpportunities(headers: string[]): boolean {
  return indexOf(headers, "stage") >= 0 && indexOf(headers, "Opportunity ID") >= 0;
}

export function parseGhlContacts(text: string): ReadResult<GhlContact> {
  const { headers, rows } = parseCsv(text ?? "");
  if (headers.length === 0) return { ok: false, error: "The contacts file is empty." };
  if (looksLikeOpportunities(headers)) {
    return { ok: false, error: "This is the opportunities export. Put it in the opportunities box, and the contacts export here." };
  }
  const id = indexOf(headers, "Contact Id");
  if (id < 0) return { ok: false, error: "This doesn't look like a GoHighLevel contacts export: it has no Contact Id column." };
  const col = {
    first: indexOf(headers, "First Name"),
    last: indexOf(headers, "Last Name"),
    phone: indexOf(headers, "Phone"),
    email: indexOf(headers, "Email"),
    created: indexOf(headers, "Created", "Date Created"),
    tags: indexOf(headers, "Tags"),
    dnd: indexOf(headers, "DND"),
    source: indexOf(headers, "Source"),
    treatment: indexOf(headers, "Treatment interested in"),
    town: indexOf(headers, "Location", "Town", "City"),
    medical: indexOf(headers, "Medical Condition"),
    used: indexOf(headers, "Used treatments before?", "Used treatments before"),
  };
  const out: GhlContact[] = [];
  for (const r of rows) {
    const contactId = cell(r, id);
    if (!contactId) continue;
    out.push({
      contactId,
      firstName: cell(r, col.first),
      lastName: cell(r, col.last),
      phone: cell(r, col.phone),
      email: cell(r, col.email),
      createdAt: parseTimestamp(cell(r, col.created)),
      tags: parseTagList(cell(r, col.tags)),
      dnd: isTrue(cell(r, col.dnd)),
      source: cell(r, col.source),
      treatment: cell(r, col.treatment),
      town: cell(r, col.town),
      medicalCondition: cell(r, col.medical),
      usedBefore: cell(r, col.used),
    });
  }
  return { ok: true, rows: out };
}

export function parseGhlOpportunities(text: string): ReadResult<GhlOpportunity> {
  const { headers, rows } = parseCsv(text ?? "");
  if (headers.length === 0) return { ok: false, error: "The opportunities file is empty." };
  const stage = indexOf(headers, "stage");
  if (stage < 0) return { ok: false, error: "This doesn't look like a GoHighLevel opportunities export: it has no stage column." };
  const contact = indexOf(headers, "Contact ID");
  if (contact < 0) return { ok: false, error: "This opportunities export has no Contact ID column, so it can't be matched to the contacts." };
  const col = {
    id: indexOf(headers, "Opportunity ID"),
    name: indexOf(headers, "Contact Name", "Opportunity name"),
    phone: indexOf(headers, "phone"),
    email: indexOf(headers, "email"),
    pipeline: indexOf(headers, "pipeline"),
    source: indexOf(headers, "source"),
    assigned: indexOf(headers, "assigned"),
    created: indexOf(headers, "Created on"),
    updated: indexOf(headers, "Updated on"),
    notes: indexOf(headers, "Notes"),
    tags: indexOf(headers, "tags"),
    days: indexOf(headers, "Days since last stage change"),
  };
  const out: GhlOpportunity[] = [];
  for (const r of rows) {
    const contactId = cell(r, contact);
    if (!contactId) continue;
    out.push({
      opportunityId: cell(r, col.id),
      contactId,
      contactName: cell(r, col.name),
      phone: cell(r, col.phone),
      email: cell(r, col.email),
      pipeline: cell(r, col.pipeline),
      stage: cell(r, stage),
      source: cell(r, col.source),
      assigned: cell(r, col.assigned),
      createdAt: parseTimestamp(cell(r, col.created)),
      updatedAt: parseTimestamp(cell(r, col.updated)),
      notes: cell(r, col.notes),
      tags: parseTagList(cell(r, col.tags)),
      daysInStage: parseDaysInStage(cell(r, col.days)),
    });
  }
  return { ok: true, rows: out };
}

/**
 * Rows to CSV text: quoted where needed, quotes doubled, CRLF line ends. A
 * cell that a spreadsheet would run as a formula (=, @, or + / - followed
 * by something other than a digit) gets a leading apostrophe.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined): string => {
    let s = v == null ? "" : String(v);
    if (/^[=@\t\r]/.test(s) || /^[+-](?![\d\s(]|$)/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/ghlImport/csv.test.ts`
Expected: PASS, `ghlImport csv: N checks passed.`

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && npm run typecheck
git add src/lib/ghlImport/csv.ts src/lib/ghlImport/csv.test.ts
git commit -m "feat(ghl-import): read the GoHighLevel contacts and opportunities exports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The mapping rules (pure)

**Files:**
- Create: `app/src/lib/ghlImport/mapping.ts`
- Test: `app/src/lib/ghlImport/mapping.test.ts`

**Interfaces:**
- Consumes: `type ColumnRef = string` from `app/src/lib/leadFlows/flowModel.ts`.
- Produces (used by Tasks 5, 6):
  - constants `STALE_AFTER_DAYS = 14`, `HOLDING = "holding"`, `CLIENT_TAGS`, `LOST_TAGS`, `DO_NOT_CONTACT_TAG = "not interested"`, `GHL_LEAD_SOURCE = "gohighlevel"`, `GHL_CONSENT_SOURCE = "Carried over from GoHighLevel (operator decision 2026-11-25)"`
  - `type ImportColumn = ColumnRef | typeof HOLDING`
  - `interface FlowIntent { via: "column" | "new_lead"; from: "resume" | "start"; emailOnly: boolean }`
  - `type Placement = { kind: "lead"; column: ImportColumn; flow: FlowIntent | null; won: boolean; lost: boolean } | { kind: "client" } | { kind: "contact" }`
  - `interface Decision { placement: Placement; doNotContact: boolean; consent: boolean; rule: string }`
  - `decide(input: { stage: string | null; daysInStage: number | null; tags: string[]; dnd: boolean }): Decision`
  - `stageKey(stage: string): string`, `nameKey(name: string): string`
  - `matchStaff(ghlName: string, staff: { userId: number; name: string }[]): number | null`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/ghlImport/mapping.test.ts`:

```ts
// Run: npm test -- src/lib/ghlImport/mapping.test.ts
//
// The agreed rules: GoHighLevel stage and days in stage to an Adonis
// column and follow-up, the tags for people with no opportunity, and do not
// contact. Boundaries at 14 days.
import assert from "node:assert/strict";

import { decide, matchStaff, STALE_AFTER_DAYS, type Decision, type Placement } from "./mapping";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const run = (stage: string | null, days: number | null, tags: string[] = [], dnd = false): Decision => decide({ stage, daysInStage: days, tags, dnd });
const lead = (d: Decision) => {
  assert.equal(d.placement.kind, "lead");
  return d.placement as Extract<Placement, { kind: "lead" }>;
};

ok(STALE_AFTER_DAYS === 14, "stale after 14 days");

// Long-term nurture: carried on where it was, at any age (the planner decides if it is past week 12).
{
  const p = lead(run("Long Term Nurture", 30));
  ok(p.column === "key:nurture" && p.flow?.via === "column" && p.flow.from === "resume" && !p.flow.emailOnly, "nurture resumes");
  ok(lead(run("long term  nurture", 200)).flow?.from === "resume", "case and spaces do not matter; old nurture still resumes (planner ends it)");
  ok(lead(run("Long Term Nurture", null)).flow === null, "unknown days: column only");
}

// The four follow-up stages, either side of 14 days.
for (const [stage, column, via] of [
  ["Call Back Later", "key:call_back", "column"],
  ["Thinking About It", "key:thinking", "column"],
  ["No Answer Call Back", "key:no_answer", "column"],
  ["New Lead", "role:new", "new_lead"],
] as const) {
  const fresh = lead(run(stage, 14));
  ok(fresh.column === column && fresh.flow?.via === via && fresh.flow.from === "resume", `${stage} at 14 days: its own column and flow`);
  const stale = lead(run(stage, 15));
  ok(stale.column === "key:nurture" && stale.flow?.via === "column" && stale.flow.from === "start", `${stage} at 15 days: Long-term nurture from week 1`);
  ok(lead(run(stage, 0)).column === column, `${stage} today: its own column`);
  ok(lead(run(stage, null)).column === column && lead(run(stage, null)).flow === null, `${stage}, days unknown: column only`);
}

// Consult booked (GoHighLevel writes it with two spaces).
ok(lead(run("Consult  Booked", 14)).column === "role:booked" && lead(run("Consult Booked", 14)).flow === null, "booked at 14 days: Consultation booked, no flow");
{
  const p = lead(run("Consult  Booked", 15));
  ok(p.column === "key:nurture" && p.flow?.from === "start", "booked 15 days ago: Long-term nurture from week 1");
}

// The rest.
{
  const u = lead(run("Message Undelivered", 20));
  ok(u.column === "key:undelivered" && u.flow?.emailOnly === true && u.flow.from === "resume", "undelivered: its column, email only");
  ok(lead(run("Holding", 3)).column === "holding" && lead(run("Holding", 3)).flow === null, "Holding column, no flow");
  ok(lead(run("Send Deposit Link", 100)).column === "role:engaged" && lead(run("Send Deposit Link", 1)).flow === null, "deposit link: Hot lead, no flow");
  const w = lead(run("Won", 100));
  ok(w.column === "role:won" && w.won && !w.lost && w.flow === null, "won: Sale, no flow");
  const l = lead(run("Lost", 2));
  ok(l.column === "role:lost" && l.lost && l.flow === null, "lost: Lost, no flow");
  const x = run("Something New", 2);
  ok(lead(x).column === "role:new" && lead(x).flow === null && /Something New/.test(x.rule), "an unknown stage: New lead, no flow, says which stage");
}

// Consent: leads that are not lost and not do-not-contact.
ok(run("Long Term Nurture", 3).consent, "a nurture lead gets consent");
ok(run("Won", 3).consent, "a won lead gets consent");
ok(!run("Lost", 3).consent, "a lost lead does not");
ok(!run(null, null).consent, "a contact-only person does not (they are added to contacts instead)");

// No opportunity: the tags decide.
ok(run(null, null, ["member"]).placement.kind === "client", "member: client");
ok(run(null, null, ["visited-once"]).placement.kind === "client", "visited once: client");
ok(run(null, null, ["lapsed-2-months", "lost"]).placement.kind === "client", "lapsed: client (a client tag wins over lost)");
ok(lead(run(null, null, ["lost"])).lost, "lost tag: lost lead");
ok(lead(run(null, null, ["not interested"])).lost, "not interested tag: lost lead");
ok(run(null, null, ["aug-2026-comp-outreach"]).placement.kind === "contact", "anyone else: email contact only");

// Do not contact: DND, or "not interested" anywhere.
{
  const d = run("Long Term Nurture", 3, [], true);
  ok(d.doNotContact && !d.consent && lead(d).flow === null && lead(d).column === "key:nurture", "DND: column kept, no flow, no consent");
  const t = run("Call Back Later", 3, ["lead", "not interested"]);
  ok(t.doNotContact && lead(t).flow === null, "not interested tag on an opportunity: do not contact");
  ok(run(null, null, [], true).doNotContact && run(null, null, [], true).placement.kind === "contact", "DND with no opportunity: still recorded, as do not contact");
  ok(!run("Won", 3).doNotContact, "no DND, no tag: contactable");
}

// Staff names.
const staff = [
  { userId: 1, name: "Sandra Example" },
  { userId: 2, name: "DJ" },
  { userId: 3, name: "Seán Ó Test" },
  { userId: 4, name: "Sandra Other" },
];
ok(matchStaff("Sandra Example", staff) === 1, "full name");
ok(matchStaff("  sandra   example ", staff) === 1, "case and spaces");
ok(matchStaff("Sean O Test", staff) === 3, "accents do not matter");
ok(matchStaff("Sandra Kalace", staff) === null, "two Sandras: a first name alone is not enough");
ok(matchStaff("Daniel O Dwyer", staff) === null, "no match: null (the screen lets the operator pick)");
ok(matchStaff("", staff) === null, "blank: null");
ok(matchStaff("Dj", [{ userId: 2, name: "DJ" }]) === 2, "a one-word name matches");

console.log(`ghlImport mapping: ${n} checks passed.`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/ghlImport/mapping.test.ts`
Expected: FAIL, `Cannot find module './mapping'`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/ghlImport/mapping.ts`:

```ts
/**
 * What happens to one GoHighLevel person, by the rules agreed with the
 * operator (docs/superpowers/specs/2026-11-25-ghl-import-design.md). Pure.
 *
 * This decides the destination only. Whether the person is already in
 * Adonis, which flow a column starts and which steps are left are worked
 * out later (plan.ts, placement.ts).
 */
import type { ColumnRef } from "@/lib/leadFlows/flowModel";

/** A follow-up stage older than this goes to Long-term nurture from week 1. */
export const STALE_AFTER_DAYS = 14;

/** The Holding column: created on import when the board has none. No role, no flow. */
export const HOLDING = "holding" as const;
export type ImportColumn = ColumnRef | typeof HOLDING;

/** No opportunity, and one of these tags: a client. */
export const CLIENT_TAGS: readonly string[] = ["member", "visited-once", "lapsed-2-months"];
/** No opportunity, and one of these tags: a lost lead, never messaged. */
export const LOST_TAGS: readonly string[] = ["lost", "not interested"];
/** This tag anywhere, or DND: do not contact. */
export const DO_NOT_CONTACT_TAG = "not interested";

/** leads.source for imported leads (never "facebook": no Meta event may fire for them). */
export const GHL_LEAD_SOURCE = "gohighlevel";
/** leads.marketing_consent_source for imported leads (operator decision, 2026-11-25). */
export const GHL_CONSENT_SOURCE = "Carried over from GoHighLevel (operator decision 2026-11-25)";

export interface FlowIntent {
  /** "column": the flow that starts in the column; "new_lead": the New lead flow. */
  via: "column" | "new_lead";
  /** "resume": carry on after day N; "start": from the first step, now. */
  from: "resume" | "start";
  /** WhatsApp steps go by email (Message undelivered). */
  emailOnly: boolean;
}

export type Placement =
  | { kind: "lead"; column: ImportColumn; flow: FlowIntent | null; won: boolean; lost: boolean }
  | { kind: "client" }
  | { kind: "contact" };

export interface Decision {
  placement: Placement;
  doNotContact: boolean;
  /** Record marketing consent (a lead that is neither lost nor do-not-contact). */
  consent: boolean;
  /** Why, in a few plain words, for the dry run. */
  rule: string;
}

export function stageKey(stage: string): string {
  return (stage ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const FOLLOW_UPS: Record<string, { column: ColumnRef; via: FlowIntent["via"] }> = {
  "call back later": { column: "key:call_back", via: "column" },
  "thinking about it": { column: "key:thinking", via: "column" },
  "no answer call back": { column: "key:no_answer", via: "column" },
  "new lead": { column: "role:new", via: "new_lead" },
};

type LeadPlacement = Extract<Placement, { kind: "lead" }>;

function toLead(column: ImportColumn, flow: FlowIntent | null, extra: { won?: boolean; lost?: boolean } = {}): LeadPlacement {
  return { kind: "lead", column, flow, won: extra.won ?? false, lost: extra.lost ?? false };
}

const NURTURE_FROM_START: LeadPlacement = toLead("key:nurture", { via: "column", from: "start", emailOnly: false });

function forStage(stage: string, n: number | null): { placement: LeadPlacement; rule: string } {
  const key = stageKey(stage);
  const resume = (via: FlowIntent["via"], emailOnly = false): FlowIntent => ({ via, from: "resume", emailOnly });
  const follow = FOLLOW_UPS[key];
  if (follow) {
    if (n == null) return { placement: toLead(follow.column, null), rule: "Days in stage unknown: column only" };
    if (n <= STALE_AFTER_DAYS) return { placement: toLead(follow.column, resume(follow.via)), rule: `In ${stage} for ${n} days: carried on` };
    return { placement: NURTURE_FROM_START, rule: `In ${stage} for ${n} days: Long-term nurture from week 1` };
  }
  switch (key) {
    case "long term nurture":
      return n == null
        ? { placement: toLead("key:nurture", null), rule: "Days in stage unknown: column only" }
        : { placement: toLead("key:nurture", resume("column")), rule: "Long-term nurture, carried on" };
    case "consult booked":
      if (n != null && n > STALE_AFTER_DAYS) return { placement: NURTURE_FROM_START, rule: `Booked ${n} days ago: Long-term nurture from week 1` };
      return { placement: toLead("role:booked", null), rule: "Consultation booked" };
    case "message undelivered":
      return n == null
        ? { placement: toLead("key:undelivered", null), rule: "Days in stage unknown: column only" }
        : { placement: toLead("key:undelivered", resume("column", true)), rule: "Message undelivered: email follow-ups only" };
    case "holding":
      return { placement: toLead(HOLDING, null), rule: "Holding" };
    case "send deposit link":
      return { placement: toLead("role:engaged", null), rule: "Deposit link sent: Hot lead" };
    case "won":
      return { placement: toLead("role:won", null, { won: true }), rule: "Won: a client" };
    case "lost":
      return { placement: toLead("role:lost", null, { lost: true }), rule: "Lost: never messaged" };
    default:
      return { placement: toLead("role:new", null), rule: `Unknown GoHighLevel stage "${stage}": New lead, no follow-up` };
  }
}

export function decide(input: { stage: string | null; daysInStage: number | null; tags: string[]; dnd: boolean }): Decision {
  const tags = new Set(input.tags.map((t) => t.trim().toLowerCase()));
  const doNotContact = input.dnd || tags.has(DO_NOT_CONTACT_TAG);
  let placement: Placement;
  let rule: string;
  if (!input.stage || !input.stage.trim()) {
    if (CLIENT_TAGS.some((t) => tags.has(t))) {
      placement = { kind: "client" };
      rule = "Tagged as a client in GoHighLevel";
    } else if (LOST_TAGS.some((t) => tags.has(t))) {
      placement = toLead("role:lost", null, { lost: true });
      rule = "Tagged lost or not interested: never messaged";
    } else {
      placement = { kind: "contact" };
      rule = "No opportunity: email contact only";
    }
  } else {
    ({ placement, rule } = forStage(input.stage.trim(), input.daysInStage));
  }
  if (doNotContact && placement.kind === "lead") placement = { ...placement, flow: null };
  if (doNotContact) rule = `${rule}. Do not contact`;
  const consent = !doNotContact && placement.kind === "lead" && !placement.lost;
  return { placement, doNotContact, consent, rule };
}

/** A name for matching: no accents, lowercase, letters and single spaces only. */
export function nameKey(name: string): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** GoHighLevel's assigned user to an Adonis staff member: the full name, else a first name only one person has. */
export function matchStaff(ghlName: string, staff: { userId: number; name: string }[]): number | null {
  const k = nameKey(ghlName);
  if (!k) return null;
  const full = staff.filter((s) => nameKey(s.name) === k);
  if (full.length === 1) return full[0].userId;
  const first = k.split(" ")[0];
  const byFirst = staff.filter((s) => nameKey(s.name).split(" ")[0] === first);
  return byFirst.length === 1 ? byFirst[0].userId : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/ghlImport/mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && npm run typecheck
git add src/lib/ghlImport/mapping.ts src/lib/ghlImport/mapping.test.ts
git commit -m "feat(ghl-import): the agreed stage, tag and do-not-contact rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Step placement (pure)

**Files:**
- Create: `app/src/lib/ghlImport/placement.ts`
- Test: `app/src/lib/ghlImport/placement.test.ts`

**Interfaces:**
- Consumes: `cascadeDueTimes(startAt, delaysMs, fit(at, index), firstAt?)` and `finishDueAt(startAt, dues, delaysMs, afterMs)` from `app/src/lib/leadFlows/flowPlan.ts`; in tests `fitToWindow`, `todayIn` from `app/src/lib/leadFlows/sendingWindow.ts`, `FLOW_PRESETS` from `app/src/lib/leadFlows/presets.ts`, `delayToMs` from `app/src/lib/automationModel.ts`, `pickForInterest` from `flowPlan.ts`.
- Produces (used by Task 5):
  - `DAY_MS = 86_400_000`
  - `interface PlacementMessage { channel: string; delayMs: number }`
  - `interface PlacedStep { step: number; channel: string; dueAt: number }` (`step` = index into the person's picked message list)
  - `type SkipReason = "done in GoHighLevel" | "past" | "one a day on the import day" | "no address"`
  - `interface StepPlan { steps: PlacedStep[]; skipped: { step: number; reason: SkipReason }[]; finishAt: number | null; ended: boolean }`
  - `planSteps(input: { messages: PlacementMessage[]; startAt: number; doneThroughMs: number | null; now: number; finishAfterMs: number | null; fit: (at: number, channel: string) => number; dayOf: (at: number) => string; canReceive: (channel: string) => boolean }): StepPlan`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/ghlImport/placement.test.ts`:

```ts
// Run: npm test -- src/lib/ghlImport/placement.test.ts
//
// Placing a person part-way through a flow: steps GoHighLevel already sent
// are left out, steps whose time has passed are skipped (no catch-up), one
// message at most on the import day, steps inside sending hours, and the
// flow's end. Boundaries at day 77, the last nurture step.
import assert from "node:assert/strict";

import { delayToMs } from "../automationModel";
import { pickForInterest } from "../leadFlows/flowPlan";
import { FLOW_PRESETS } from "../leadFlows/presets";
import { fitToWindow, todayIn } from "../leadFlows/sendingWindow";
import { DAY_MS, planSteps, type PlacementMessage } from "./placement";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const DAY = DAY_MS;
// Wednesday 16 January 2030, 10:00 Irish time (winter: Irish time = UTC).
const NOW = Date.parse("2030-01-16T10:00:00Z");
const EXPORT_MORNING = Date.parse("2030-01-16T09:00:00Z");
const anyTime = (at: number) => at;
const dayOf = (at: number) => todayIn(at);
const always = () => true;

// Optimal Health's Long-term nurture, the "everyone else" versions: weeks 1, 2, 3, 6, 8, 10, 12.
const nurture: PlacementMessage[] = pickForInterest(
  FLOW_PRESETS["optimal-health"].lead_nurture.map((m) => ({ channel: m.channel as string, delayMs: delayToMs(m.delayValue, m.delayUnit), matchInterest: m.matchInterest })),
  null,
).map((m) => ({ channel: m.channel, delayMs: m.delayMs }));
assert.deepEqual(nurture.map((m) => m.delayMs / DAY), [0, 7, 14, 35, 49, 63, 77]);
n++;

const resume = (daysInStage: number, extra: Partial<Parameters<typeof planSteps>[0]> = {}) =>
  planSteps({
    messages: nurture,
    startAt: EXPORT_MORNING - daysInStage * DAY,
    doneThroughMs: daysInStage * DAY,
    now: NOW,
    finishAfterMs: null,
    fit: anyTime,
    dayOf,
    canReceive: always,
    ...extra,
  });

// Day 30: weeks 6, 8, 10 and 12 are left, due 5, 19, 33 and 47 days after the export.
{
  const p = resume(30);
  assert.deepEqual(p.steps.map((s) => s.step), [3, 4, 5, 6]);
  n++;
  ok(p.steps[0].dueAt === EXPORT_MORNING + 5 * DAY, "week 6 lands 35 days after they entered");
  ok(p.skipped.filter((s) => s.reason === "done in GoHighLevel").length === 3, "weeks 1 to 3 were done in GoHighLevel");
  ok(!p.ended && p.finishAt === null, "nurture has no finish move");
}

// Day 76: only week 12 is left, tomorrow. Day 77: nothing is left.
{
  const p76 = resume(76);
  ok(p76.steps.length === 1 && p76.steps[0].step === 6 && p76.steps[0].dueAt === EXPORT_MORNING + DAY, "day 76: week 12 tomorrow");
  const p77 = resume(77);
  ok(p77.steps.length === 0 && p77.ended, "day 77: past the end");
  ok(resume(200).ended, "day 200: past the end");
}

// No catch-up: exported three days before the import, a step due in between is skipped.
{
  const exportedEarlier = EXPORT_MORNING - 3 * DAY;
  const p = planSteps({ messages: nurture, startAt: exportedEarlier - 33 * DAY, doneThroughMs: 33 * DAY, now: NOW, finishAfterMs: null, fit: anyTime, dayOf, canReceive: always });
  ok(p.skipped.some((s) => s.step === 3 && s.reason === "past"), "week 6 fell due between the export and the import: skipped");
  ok(p.steps[0].step === 4 && p.steps[0].dueAt > NOW, "the first message is the next future one");
}

// A fresh start: the first step is now, and only one message goes on the import day.
{
  const twoAtOnce: PlacementMessage[] = [
    { channel: "whatsapp", delayMs: 0 },
    { channel: "email", delayMs: 0 },
    { channel: "whatsapp", delayMs: 2 * DAY },
  ];
  const p = planSteps({ messages: twoAtOnce, startAt: NOW, doneThroughMs: null, now: NOW, finishAfterMs: null, fit: anyTime, dayOf, canReceive: always });
  ok(p.steps.length === 2 && p.steps[0].step === 0 && p.steps[0].dueAt === NOW, "the first message is due now");
  ok(p.skipped.some((s) => s.step === 1 && s.reason === "one a day on the import day"), "the second message the same day is skipped");
  ok(p.steps[1].step === 2, "later days still go");
}

// No address for a channel: that step is skipped, the rest go.
{
  const p = planSteps({
    messages: [{ channel: "whatsapp", delayMs: 0 }, { channel: "email", delayMs: DAY }],
    startAt: NOW,
    doneThroughMs: null,
    now: NOW,
    finishAfterMs: null,
    fit: anyTime,
    dayOf,
    canReceive: (ch) => ch === "email",
  });
  ok(p.steps.length === 1 && p.steps[0].channel === "email" && p.skipped[0].reason === "no address", "no phone: the WhatsApp is skipped");
}

// A flow with a finish move: No answer (WhatsApps at 0 and 2 days, move after 4).
{
  const noAnswer: PlacementMessage[] = [{ channel: "whatsapp", delayMs: 0 }, { channel: "whatsapp", delayMs: 2 * DAY }];
  const at = (days: number) =>
    planSteps({ messages: noAnswer, startAt: EXPORT_MORNING - days * DAY, doneThroughMs: days * DAY, now: NOW, finishAfterMs: 4 * DAY, fit: anyTime, dayOf, canReceive: always });
  const d1 = at(1);
  ok(d1.steps.length === 1 && d1.steps[0].dueAt === EXPORT_MORNING + DAY && d1.finishAt === EXPORT_MORNING + 3 * DAY, "day 1: one WhatsApp left, then the move");
  const d3 = at(3);
  ok(d3.steps.length === 0 && d3.finishAt === EXPORT_MORNING + DAY && !d3.ended, "day 3: no message left, the move tomorrow");
  const d5 = at(5);
  ok(d5.ended && d5.finishAt === null && d5.steps.length === 0, "day 5: the flow has ended");
}

// Sending hours: Monday to Saturday 09:00-18:00. A step due on a Sunday goes on Monday morning.
{
  const OH = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };
  const sunday0900 = Date.parse("2030-01-20T09:00:00Z");
  const p = planSteps({
    messages: [{ channel: "whatsapp", delayMs: 14 * DAY }],
    startAt: sunday0900 - 14 * DAY,
    doneThroughMs: 10 * DAY,
    now: NOW,
    finishAfterMs: null,
    fit: (at, ch) => fitToWindow(at, ch, OH),
    dayOf,
    canReceive: always,
  });
  ok(p.steps[0].dueAt === Date.parse("2030-01-21T09:00:00Z"), "Sunday becomes Monday 09:00");
}

console.log(`ghlImport placement: ${n} checks passed.`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/ghlImport/placement.test.ts`
Expected: FAIL, `Cannot find module './placement'`.

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/ghlImport/placement.ts`:

```ts
/**
 * Which steps of a flow an imported person still gets, and when. Pure.
 *
 * A person who was N days into a GoHighLevel stage carries on from there:
 * steps at most N days into the flow were sent by GoHighLevel and are left
 * out. Of the rest, a step whose time (inside sending hours) has passed is
 * skipped, never sent late, and only the first step on the import day is
 * kept, so nobody gets a burst. A flow whose finish move time has passed has
 * ended: the caller moves the person on as the flow's finish says.
 */
import { cascadeDueTimes, finishDueAt } from "@/lib/leadFlows/flowPlan";

export const DAY_MS = 86_400_000;

export interface PlacementMessage {
  channel: string;
  /** Offset from the start of the flow. */
  delayMs: number;
}

export interface PlacedStep {
  /** Index into the person's picked message list (lib/leadFlows/flowPlan pickForInterest). */
  step: number;
  channel: string;
  dueAt: number;
}

export type SkipReason = "done in GoHighLevel" | "past" | "one a day on the import day" | "no address";

export interface StepPlan {
  steps: PlacedStep[];
  skipped: { step: number; reason: SkipReason }[];
  /** When the finish move happens; null when the flow has no finish or has ended. */
  finishAt: number | null;
  /** Nothing of the flow is left: no message to send and no finish still to come. */
  ended: boolean;
}

export function planSteps(input: {
  /** The person's messages in order (already picked for their interest). */
  messages: PlacementMessage[];
  /** When the flow started for them: the day they entered the stage, or now for a fresh start. */
  startAt: number;
  /** Steps with an offset at most this were done in GoHighLevel; null = none were. */
  doneThroughMs: number | null;
  now: number;
  /** The flow's finish move, counted from its start; null = it has none. */
  finishAfterMs: number | null;
  /** Sending hours: the first allowed moment at or after `at` on that channel. */
  fit: (at: number, channel: string) => number;
  /** The local date of an instant ("YYYY-MM-DD"). */
  dayOf: (at: number) => string;
  /** Whether the person has an address on this channel. */
  canReceive: (channel: string) => boolean;
}): StepPlan {
  const { messages, now } = input;
  const skipped: StepPlan["skipped"] = [];
  const kept: number[] = [];
  messages.forEach((m, i) => {
    if (input.doneThroughMs != null && m.delayMs <= input.doneThroughMs) skipped.push({ step: i, reason: "done in GoHighLevel" });
    else kept.push(i);
  });
  const delays = kept.map((i) => messages[i].delayMs);
  const dues = cascadeDueTimes(input.startAt, delays, (at, j) => input.fit(at, messages[kept[j]].channel));

  const today = input.dayOf(now);
  let usedToday = false;
  const steps: PlacedStep[] = [];
  kept.forEach((i, j) => {
    const dueAt = dues[j];
    const channel = messages[i].channel;
    if (!input.canReceive(channel)) return void skipped.push({ step: i, reason: "no address" });
    if (dueAt < now) return void skipped.push({ step: i, reason: "past" });
    if (input.dayOf(dueAt) === today) {
      if (usedToday) return void skipped.push({ step: i, reason: "one a day on the import day" });
      usedToday = true;
    }
    steps.push({ step: i, channel, dueAt });
  });
  skipped.sort((a, b) => a.step - b.step);

  if (input.finishAfterMs == null) return { steps, skipped, finishAt: null, ended: steps.length === 0 };
  // The flow's own end, from its schedule (not from which steps this person gets).
  const finishAt = finishDueAt(input.startAt, dues, delays, input.finishAfterMs);
  if (finishAt <= now) {
    for (const s of steps) skipped.push({ step: s.step, reason: "past" });
    skipped.sort((a, b) => a.step - b.step);
    return { steps: [], skipped, finishAt: null, ended: true };
  }
  return { steps, skipped, finishAt, ended: false };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/ghlImport/placement.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && npm run typecheck
git add src/lib/ghlImport/placement.ts src/lib/ghlImport/placement.test.ts
git commit -m "feat(ghl-import): place a person part-way through a flow, skipping past steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Imported runs in the lead-flow engine

Schema and migration for everything the import stores, then the engine side: a run placed by the importer, the `held` status, holding rows of a flow that is off, releasing them when it is switched on, and refusing do-not-contact leads.

**Files:**
- Modify: `app/src/lib/db/schema.ts` (leads, automationQueue, leadFlowRuns; new ghlImportPeople)
- Modify: `app/src/lib/db/tenant.ts` (the lead-flow migration block at the end of `ensureTenantTables`, around line 3450)
- Modify: `app/src/lib/leadFlows/flowModel.ts`
- Modify: `app/src/lib/leadFlows/runs.ts`
- Modify: `app/src/lib/leadFlows/dispatch.ts`
- Modify: `app/src/lib/leadFlows/consent.ts:129-133`
- Modify: `app/src/lib/leadFlows/activityModel.ts`
- Modify: `app/src/lib/automations.ts` (`setTriggerEnabled`, `saveTrigger`)
- Create: `app/src/lib/leadFlows/heldRows.ts`
- Create: `app/src/lib/leadFlows/importedRuns.ts`
- Test: `app/src/lib/leadFlows/heldRows.test.ts`, `app/src/lib/leadFlows/importedRuns.test.ts`

**Interfaces:**
- Produces:
  - `schema.leads.doNotContact: boolean` (column `do_not_contact INTEGER NOT NULL DEFAULT 0`)
  - `schema.automationQueue.status` enum gains `"held"`
  - `schema.leadFlowRuns.source: string | null` (column `source TEXT`; `"gohighlevel"` for imported runs)
  - `schema.ghlImportPeople` table (columns below), type `GhlImportPerson`
  - in `flowModel.ts`: `PENDING_STATUSES = ["queued", "held"] as const`, `IMPORTED_RUN_SOURCE = "gohighlevel"`
  - in `runs.ts`: `type ShortcodeVars`, `messageVars(lead, profile, extra?, callAt?): ShortcodeVars`, `messageRow(input): typeof schema.automationQueue.$inferInsert`
  - in `heldRows.ts`: `interface HeldRow { id: number; runId: number | null; kind: string; dueAt: number }`, `planRelease(rows: HeldRow[], now: number, dayOf: (at: number) => string): { cancel: number[]; queue: { id: number; dueAt: number }[] }`
  - in `importedRuns.ts`: `interface ImportedRunPlan { triggerKey: string; steps: { step: number; dueAt: number }[]; finishAt: number | null; emailOnly: boolean }`, `placeImportedRun(leadId: number, plan: ImportedRunPlan, now?: number): { runId: number | null; queued: number; held: boolean; skipped: string | null }`, `releaseHeldImportRows(triggerKey: string, now?: number): { queued: number; skipped: number }`, `SKIPPED_WHILE_OFF` (the cancel reason text)

- [ ] **Step 1: Schema**

In `app/src/lib/db/schema.ts`:

a) In `leads`, right after the `doNotCall` column, add:

```ts
  /**
   * Do not contact (from an import: GoHighLevel's DND, or a "not interested"
   * tag). No follow-up flow starts for the lead (lib/leadFlows/runs.ts
   * startFlow, importedRuns.ts) until a person clears it on the lead page.
   */
  doNotContact: integer("do_not_contact", { mode: "boolean" }).notNull().default(false),
```

b) In `automationQueue`, change the `status` line to:

```ts
    /** "held": an imported run's row waiting for its flow to be switched on (lib/leadFlows/importedRuns.ts). */
    status: text("status", { enum: ["queued", "sent", "failed", "cancelled", "held"] }).notNull().default("queued"),
```

c) In `leadFlowRuns`, after `endedAt`, add:

```ts
    /** Who placed the run: null = Adonis (startFlow); "gohighlevel" = the GoHighLevel import, part-way through. */
    source: text("source"),
```

d) After the `leadFlowRuns` block (after `export type LeadFlowRun = ...`), add:

```ts
/**
 * One person from a GoHighLevel import (lib/ghlImport), whatever happened to
 * them, so a re-run of the same files changes nothing. Keeps what has no
 * column on the lead or client: GoHighLevel's stage, source, tags and
 * custom fields, and the staff-only medical note, which is shown to staff
 * on the lead and client pages and nowhere else: never to the AI, never in
 * a message, never in an export (guarded by lib/ghlImport/medicalNote.guard.test.ts).
 */
export const ghlImportPeople = sqliteTable(
  "ghl_import_people",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ghlContactId: text("ghl_contact_id").notNull(),
    ghlOpportunityId: text("ghl_opportunity_id"),
    leadId: integer("lead_id"),
    clientId: integer("client_id"),
    contactId: integer("contact_id"),
    /** "create" | "update" | "unchanged" | "skip" (lib/ghlImport/plan Outcome). */
    outcome: text("outcome").notNull(),
    ghlStage: text("ghl_stage"),
    daysInStage: integer("days_in_stage"),
    ghlSource: text("ghl_source"),
    /** JSON string[]. */
    tags: text("tags"),
    treatment: text("treatment"),
    usedBefore: text("used_before"),
    town: text("town"),
    staffMedicalNote: text("staff_medical_note"),
    doNotContact: integer("do_not_contact", { mode: "boolean" }).notNull().default(false),
    importedAt: integer("imported_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    byContact: uniqueIndex("idx_ghl_import_people_contact").on(t.ghlContactId),
    byLead: index("idx_ghl_import_people_lead").on(t.leadId),
    byClient: index("idx_ghl_import_people_client").on(t.clientId),
  }),
);
export type GhlImportPerson = typeof ghlImportPeople.$inferSelect;
```

(`uniqueIndex` and `index` are already imported at the top of schema.ts; check, and add to the `drizzle-orm/sqlite-core` import if not.)

- [ ] **Step 2: Migration**

In `app/src/lib/db/tenant.ts`, in the last block of `ensureTenantTables` (the one with `addColumn("notifications", "for_user_id", ...)` and the comment `// Later lead-flow columns go here.`), replace that comment line with:

```ts
    // GoHighLevel import (lib/ghlImport): do not contact, who placed a run,
    // and the per-person import record.
    addColumn("leads", "do_not_contact", "do_not_contact INTEGER NOT NULL DEFAULT 0");
    addColumn("lead_flow_runs", "source", "source TEXT");
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ghl_import_people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ghl_contact_id TEXT NOT NULL,
        ghl_opportunity_id TEXT,
        lead_id INTEGER,
        client_id INTEGER,
        contact_id INTEGER,
        outcome TEXT NOT NULL,
        ghl_stage TEXT,
        days_in_stage INTEGER,
        ghl_source TEXT,
        tags TEXT,
        treatment TEXT,
        used_before TEXT,
        town TEXT,
        staff_medical_note TEXT,
        do_not_contact INTEGER NOT NULL DEFAULT 0,
        imported_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_import_people_contact ON ghl_import_people(ghl_contact_id);
      CREATE INDEX IF NOT EXISTS idx_ghl_import_people_lead ON ghl_import_people(lead_id);
      CREATE INDEX IF NOT EXISTS idx_ghl_import_people_client ON ghl_import_people(client_id);
    `);
    // Later lead-flow columns go here.
```

- [ ] **Step 3: flowModel constants**

In `app/src/lib/leadFlows/flowModel.ts`, after `CALL_ALERT_KEY`, add:

```ts
/**
 * Queue rows still to happen: waiting for their time ("queued"), or an
 * imported run's rows waiting for their flow to be switched on ("held").
 * Stopping a flow cancels both.
 */
export const PENDING_STATUSES = ["queued", "held"] as const;

/** lead_flow_runs.source of a run the GoHighLevel import placed. */
export const IMPORTED_RUN_SOURCE = "gohighlevel";
```

- [ ] **Step 4: Write the failing pure test for releasing held rows**

Create `app/src/lib/leadFlows/heldRows.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/heldRows.test.ts
//
// A flow that was off is switched on: its imported runs' held rows go,
// except messages whose time passed (skipped, never sent late) and any
// second message the same day. A finish move whose time passed happens now.
import assert from "node:assert/strict";

import { planRelease, type HeldRow } from "./heldRows";
import { todayIn } from "./sendingWindow";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const H = 3_600_000;
const NOW = Date.parse("2030-01-16T10:00:00Z");
const dayOf = (at: number) => todayIn(at);
const row = (id: number, runId: number, kind: string, dueAt: number): HeldRow => ({ id, runId, kind, dueAt });

const plan = planRelease(
  [
    row(1, 10, "message", NOW - 24 * H), // passed: skipped
    row(2, 10, "message", NOW + 1 * H), // today: goes
    row(3, 10, "message", NOW + 3 * H), // today again: skipped
    row(4, 10, "message", NOW + 48 * H), // later: goes
    row(5, 10, "move", NOW + 72 * H), // later move: goes
    row(6, 11, "message", NOW + 2 * H), // another run, today: goes
    row(7, 12, "move", NOW - 5 * H), // a passed move: now
  ],
  NOW,
  dayOf,
);
assert.deepEqual([...plan.cancel].sort((a, b) => a - b), [1, 3]);
n++;
const q = new Map(plan.queue.map((r) => [r.id, r.dueAt]));
ok(q.get(2) === NOW + H && q.get(4) === NOW + 48 * H && q.get(5) === NOW + 72 * H, "future rows keep their times");
ok(q.get(6) === NOW + 2 * H, "each run gets its own one message today");
ok(q.get(7) === NOW, "a passed move happens now");
ok(planRelease([], NOW, dayOf).cancel.length === 0, "nothing held: nothing to do");

console.log(`heldRows: ${n} checks passed.`);
```

Run: `npm test -- src/lib/leadFlows/heldRows.test.ts`
Expected: FAIL, `Cannot find module './heldRows'`.

- [ ] **Step 5: Write `heldRows.ts`**

Create `app/src/lib/leadFlows/heldRows.ts`:

```ts
/**
 * Releasing an imported run's held rows when their flow is switched on.
 * Pure: no DB, no server-only.
 *
 * The import's rule carries on: a message whose time passed while the flow
 * was off is skipped, never sent late, and each run sends at most one
 * message on the day it is released. A finish move whose time passed
 * happens now (it sends nothing itself).
 */
export interface HeldRow {
  id: number;
  runId: number | null;
  kind: string;
  dueAt: number;
}

export interface ReleasePlan {
  cancel: number[];
  queue: { id: number; dueAt: number }[];
}

export function planRelease(rows: HeldRow[], now: number, dayOf: (at: number) => string): ReleasePlan {
  const cancel: number[] = [];
  const queue: { id: number; dueAt: number }[] = [];
  const today = dayOf(now);
  const byRun = new Map<string, HeldRow[]>();
  for (const r of rows) {
    const key = r.runId == null ? `row:${r.id}` : `run:${r.runId}`;
    const list = byRun.get(key);
    if (list) list.push(r);
    else byRun.set(key, [r]);
  }
  for (const list of byRun.values()) {
    let usedToday = false;
    for (const r of [...list].sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)) {
      if (r.kind !== "message") {
        queue.push({ id: r.id, dueAt: Math.max(r.dueAt, now) });
        continue;
      }
      if (r.dueAt < now) {
        cancel.push(r.id);
        continue;
      }
      if (dayOf(r.dueAt) === today) {
        if (usedToday) {
          cancel.push(r.id);
          continue;
        }
        usedToday = true;
      }
      queue.push({ id: r.id, dueAt: r.dueAt });
    }
  }
  return { cancel, queue };
}
```

Run: `npm test -- src/lib/leadFlows/heldRows.test.ts` -> PASS.

- [ ] **Step 6: Share message rendering in `runs.ts`, count held rows as pending, refuse do-not-contact**

In `app/src/lib/leadFlows/runs.ts`:

a) Imports: add `PENDING_STATUSES` to the `./flowModel` import, and `type Channel` from `@/lib/automationModel` (alongside `applyShortcodes, TRIGGER_LABELS`).

b) Add, above `startFlow`:

```ts
export type ShortcodeVars = Parameters<typeof applyShortcodes>[1];

/** The shortcode values for one lead's messages. */
export function messageVars(
  lead: { firstName: string | null; lastName: string | null },
  profile: { businessName: string; phone?: string | null },
  extra?: StartFlowOptions["extra"],
  callAt?: number,
): ShortcodeVars {
  return {
    firstName: lead.firstName,
    lastName: lead.lastName,
    businessName: profile.businessName,
    businessPhone: profile.phone ?? "",
    ...extra,
    ...(callAt != null ? { callDay: formatCallDay(callAt), callTime: formatCallTime(callAt) } : {}),
  };
}

/** One message of a flow, rendered for one lead, ready for automation_queue. */
export function messageRow(input: {
  triggerKey: string;
  leadId: number;
  step: number;
  channel: Channel;
  sendTo: string;
  subject: string | null;
  template: string;
  dueAt: number;
  vars: ShortcodeVars;
  businessName: string;
  payload?: string | null;
}): typeof schema.automationQueue.$inferInsert {
  return {
    triggerKey: input.triggerKey,
    leadId: input.leadId,
    kind: "message",
    step: input.step,
    channel: input.channel,
    sendTo: input.sendTo,
    subject: input.channel === "email" ? applyShortcodes((input.subject ?? "").trim() || `A message from ${input.businessName}`, input.vars) : null,
    body: applyShortcodes(input.template, input.vars),
    dueAt: new Date(input.dueAt),
    payload: input.payload ?? null,
  };
}
```

c) In `startFlow`: right after `if (!lead) return skip("no such lead");` add

```ts
  // Do not contact (an import's DND or "not interested"): no flow until a person clears it.
  if (lead.doNotContact) return skip("do not contact");
```

replace the `const vars = { ... };` object with `const vars = messageVars(lead, profile, opts.extra, opts.callAt);`, and replace the `rows.push({ ... })` call inside `picked.forEach` with:

```ts
    rows.push(
      messageRow({
        triggerKey,
        leadId,
        step: i,
        channel,
        sendTo,
        subject,
        template: m.template,
        dueAt: due,
        vars,
        businessName: profile.businessName,
        payload: triggerKey === CALL_BOOKED_FLOW && i > 0 ? JSON.stringify({ notAfter: opts.callAt }) : null,
      }),
    );
```

d) In `stopFlows` (the `automationQueue` update) and in `alreadyRunning`, replace `eq(schema.automationQueue.status, "queued")` with `inArray(schema.automationQueue.status, [...PENDING_STATUSES])`. Same in `leadFlowStatus` (so the lead page shows a held run's planned messages). Leave `cancelCallRows` as it is (call rows are never held).

- [ ] **Step 7: Cancel held email rows on suppression; count held rows in the People tab**

In `app/src/lib/leadFlows/consent.ts`, `onEmailSuppressed`: replace `eq(schema.automationQueue.status, "queued")` with `inArray(schema.automationQueue.status, [...PENDING_STATUSES])` (import `inArray` from drizzle-orm and `PENDING_STATUSES` from `./flowModel`).

In `app/src/lib/leadFlows/activityModel.ts`: change `ActivityStep.status` to `"queued" | "sent" | "failed" | "cancelled" | "held"`, and in `runProgress` make the next step come from queued or held rows:

```ts
  const queued = steps.filter((s) => s.status === "queued" || s.status === "held").sort((a, b) => a.dueAt - b.dueAt);
```

In `app/src/lib/leadFlows/activity.ts` line ~103, widen the same `status` union to include `"held"`. Then run `npm run typecheck` and widen any other `status` union or `Record` over the queue statuses it reports (only add `"held"`; change no behaviour).

- [ ] **Step 8: Write the failing integration test for imported runs**

Create `app/src/lib/leadFlows/importedRuns.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/importedRuns.test.ts
//
// Runs placed by the GoHighLevel import, on a scratch business with a fake
// sender and a fixed clock: the steps and times the importer worked out,
// held while the flow is off (nothing sent), released when it is switched
// on with past steps skipped, email only for Message undelivered, and do
// not contact refused everywhere.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const imported = requireLocal("./importedRuns") as typeof import("./importedRuns");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { setTriggerEnabled } = requireLocal("../automations") as typeof import("../automations");

  const s = h.makeScratchTenant("lead-flow-imported-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const q = schema.automationQueue;
      const DAY = 86_400_000;
      const NOW = Date.parse("2030-01-16T10:00:00Z"); // a Wednesday
      const clock = h.fakeClock(NOW);
      const newLead = (first: string, extra: Partial<typeof schema.leads.$inferInsert> = {}) =>
        tdb
          .insert(schema.leads)
          .values({ source: "gohighlevel", firstName: first, lastName: "Test", email: `${first.toLowerCase()}@example.com`, phone: "+353870000001", ...extra })
          .returning({ id: schema.leads.id })
          .get().id;
      const rowsOf = (leadId: number) => tdb.select().from(q).where(eq(q.leadId, leadId)).all();

      // 1. Flow on: the given steps at the given times, tied to an imported run.
      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      const aoife = newLead("Aoife");
      const r1 = imported.placeImportedRun(aoife, { triggerKey: "lead_no_answer", steps: [{ step: 1, dueAt: NOW + 5 * DAY }], finishAt: NOW + 7 * DAY, emailOnly: false }, NOW);
      ok(r1.runId != null && r1.queued === 1 && !r1.held && r1.skipped === null, "placed: one message");
      const run1 = tdb.select().from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.id, r1.runId!)).get()!;
      ok(run1.source === "gohighlevel" && run1.status === "active", "the run is marked as imported");
      const a = rowsOf(aoife);
      const msg = a.find((r) => r.kind === "message")!;
      ok(msg.step === 1 && msg.status === "queued" && msg.dueAt.getTime() === NOW + 5 * DAY && msg.body.includes("Aoife") && msg.channel === "whatsapp", "the second No answer WhatsApp, personalised, at its time");
      ok(a.some((r) => r.kind === "move" && r.status === "queued" && r.dueAt.getTime() === NOW + 7 * DAY), "the finish move");

      // 2. Flow off: rows are held, and the ticker sends nothing.
      h.setFlowEnabled(s.tid, "lead_thinking", false);
      const brian = newLead("Brian");
      const r2 = imported.placeImportedRun(brian, { triggerKey: "lead_thinking", steps: [{ step: 0, dueAt: NOW + DAY }, { step: 1, dueAt: NOW + 6 * DAY }], finishAt: NOW + 8 * DAY, emailOnly: false }, NOW);
      ok(r2.held && r2.queued === 2, "a flow that is off: placed and held");
      ok(rowsOf(brian).every((r) => r.status === "held"), "every row held");
      clock.set(NOW + 2 * DAY);
      await dispatchDueAutomationQueue(s.tid, NOW + 2 * DAY, "http://app.test");
      ok(fake.sent.filter((x) => x.leadId === brian).length === 0 && rowsOf(brian).every((r) => r.status === "held"), "held rows are not sent");

      // 3. Switched on two days later: the passed message is skipped, the rest go at their times.
      setTriggerEnabled("lead_thinking", true);
      const b = rowsOf(brian);
      ok(b.find((r) => r.step === 0)!.status === "cancelled" && b.find((r) => r.step === 0)!.error === imported.SKIPPED_WHILE_OFF, "the passed message is skipped");
      ok(b.find((r) => r.step === 1)!.status === "queued" && b.find((r) => r.kind === "move")!.status === "queued", "the rest are released");

      // 4. Switched off again: a due imported row is held by the ticker, not sent.
      h.setFlowEnabled(s.tid, "lead_no_answer", false);
      clock.set(NOW + 5 * DAY);
      await dispatchDueAutomationQueue(s.tid, NOW + 5 * DAY, "http://app.test");
      ok(rowsOf(aoife).find((r) => r.kind === "message")!.status === "held", "the ticker holds an imported row whose flow is off");
      ok(fake.sent.filter((x) => x.leadId === aoife).length === 0, "and sends nothing");

      // 5. Stopping a flow cancels held rows too.
      runs.stopFlows(aoife, "test", "all");
      ok(rowsOf(aoife).every((r) => r.status === "cancelled"), "held rows are cancelled when the flow stops");

      // 6. Message undelivered: WhatsApp steps go by email.
      h.setFlowEnabled(s.tid, "lead_call_back", true);
      const ciara = newLead("Ciara");
      imported.placeImportedRun(ciara, { triggerKey: "lead_call_back", steps: [{ step: 0, dueAt: NOW + 3 * DAY }], finishAt: null, emailOnly: true }, NOW + 2 * DAY);
      const c = rowsOf(ciara).find((r) => r.kind === "message")!;
      ok(c.channel === "email" && c.sendTo === "ciara@example.com" && !!c.subject, "email only: the WhatsApp goes as an email");

      // 7. Long-term nurture needs marketing consent.
      h.setFlowEnabled(s.tid, "lead_nurture", true);
      const declan = newLead("Declan");
      ok(imported.placeImportedRun(declan, { triggerKey: "lead_nurture", steps: [{ step: 0, dueAt: NOW + 3 * DAY }], finishAt: null, emailOnly: false }).skipped === "no marketing consent", "nurture without consent: refused");

      // 8. Do not contact: refused by the import and by startFlow.
      const eimear = newLead("Eimear", { doNotContact: true });
      ok(imported.placeImportedRun(eimear, { triggerKey: "lead_no_answer", steps: [{ step: 0, dueAt: NOW + 3 * DAY }], finishAt: null, emailOnly: false }).skipped === "do not contact", "import refuses do not contact");
      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      ok(runs.startFlow(eimear, "lead_no_answer").skipped === "do not contact", "startFlow refuses do not contact");
      ok(tdb.select().from(q).where(and(eq(q.leadId, eimear))).all().length === 0, "nothing queued for them");
    });
    console.log(`importedRuns: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npm test -- src/lib/leadFlows/importedRuns.test.ts`
Expected: FAIL, `Cannot find module './importedRuns'`.

- [ ] **Step 9: Write `importedRuns.ts`**

Create `app/src/lib/leadFlows/importedRuns.ts`:

```ts
import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";

import { flowNow } from "./clock";
import { getFlowDefinition } from "./definitions";
import { CALL_BOOKED_FLOW, IMPORTED_RUN_SOURCE, LEAD_FLOW_KEY_SET, NURTURE_FLOW, PENDING_STATUSES } from "./flowModel";
import { pickForInterest } from "./flowPlan";
import { planRelease } from "./heldRows";
import { messageRow, messageVars, stopFlows } from "./runs";
import { todayIn } from "./sendingWindow";
import { flowTenant } from "./tenant";

/**
 * Runs placed by the GoHighLevel import (lib/ghlImport), part-way through.
 * Unlike startFlow, the steps and their times come worked out by the
 * importer (lib/ghlImport/placement.ts): steps GoHighLevel already sent, and
 * any whose time has passed, are left out. While the flow is off the rows
 * are "held": they wait, and are released, past steps skipped, when it is
 * switched on. Nothing is sent here. Ambient tenant.
 */

export interface ImportedRunPlan {
  triggerKey: string;
  /** Indexes into the lead's picked messages (pickForInterest on the lead's interest), with their times. */
  steps: { step: number; dueAt: number }[];
  /** The finish move's time, or null. */
  finishAt: number | null;
  /** WhatsApp steps go by email (Message undelivered). */
  emailOnly: boolean;
}

export interface ImportedRunResult {
  runId: number | null;
  queued: number;
  /** The flow is off: the rows wait. */
  held: boolean;
  skipped: string | null;
}

export const SKIPPED_WHILE_OFF = "Skipped: its time passed while the follow-up was off.";

export function placeImportedRun(leadId: number, plan: ImportedRunPlan, now: number = flowNow()): ImportedRunResult {
  const skip = (why: string): ImportedRunResult => ({ runId: null, queued: 0, held: false, skipped: why });
  if (!LEAD_FLOW_KEY_SET.has(plan.triggerKey)) return skip("not a lead flow");
  if (plan.triggerKey === CALL_BOOKED_FLOW) return skip("a booked call is not imported");
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return skip("no such lead");
  if (lead.doNotContact) return skip("do not contact");
  if (plan.triggerKey === NURTURE_FLOW && lead.marketingConsentAt == null) return skip("no marketing consent");
  const tenant = flowTenant();
  if (!tenant) return skip("no business");

  const def = getFlowDefinition(plan.triggerKey);
  const profile = getBusinessProfileForTenant(tenant.id);
  const picked = pickForInterest(def.messages, lead.therapyInterest);
  const vars = messageVars(lead, profile);
  const status = def.enabled ? "queued" : "held";

  const rows: (typeof schema.automationQueue.$inferInsert)[] = [];
  for (const s of plan.steps) {
    const m = picked[s.step];
    if (!m) continue;
    let channel = m.channel;
    let subject = m.subject;
    if (plan.emailOnly && channel === "whatsapp") {
      channel = "email";
      subject = `A message from ${profile.businessName}`;
    }
    const sendTo = channel === "whatsapp" ? lead.phone : lead.email;
    if (!sendTo) continue;
    rows.push({
      ...messageRow({ triggerKey: plan.triggerKey, leadId, step: s.step, channel, sendTo, subject, template: m.template, dueAt: s.dueAt, vars, businessName: profile.businessName }),
      status,
    });
  }
  const finishAt = plan.finishAt != null && def.finish ? plan.finishAt : null;
  if (rows.length === 0 && finishAt == null) return skip("nothing this lead can receive");

  const runId = db.transaction((tx) => {
    stopFlows(leadId, `${def.label} placed by the GoHighLevel import`, "all");
    const id = tx
      .insert(schema.leadFlowRuns)
      .values({ leadId, triggerKey: plan.triggerKey, status: "active", startedAt: new Date(now), source: IMPORTED_RUN_SOURCE })
      .returning({ id: schema.leadFlowRuns.id })
      .get().id;
    for (const r of rows) tx.insert(schema.automationQueue).values({ ...r, runId: id }).run();
    if (finishAt != null && def.finish) {
      tx.insert(schema.automationQueue)
        .values({
          triggerKey: plan.triggerKey,
          leadId,
          runId: id,
          kind: "move",
          channel: "chat",
          body: `Move to ${def.finish.column}`,
          dueAt: new Date(finishAt),
          payload: JSON.stringify({ column: def.finish.column }),
          status,
        })
        .run();
    }
    return id;
  });
  return { runId, queued: rows.length, held: !def.enabled, skipped: null };
}

/** The flow was switched on: its held rows go, except messages whose time passed (planRelease). */
export function releaseHeldImportRows(triggerKey: string, now: number = flowNow()): { queued: number; skipped: number } {
  const q = schema.automationQueue;
  const held = db
    .select({ id: q.id, runId: q.runId, kind: q.kind, dueAt: q.dueAt })
    .from(q)
    .where(and(eq(q.triggerKey, triggerKey), eq(q.status, "held")))
    .all();
  if (held.length === 0) return { queued: 0, skipped: 0 };
  const plan = planRelease(held.map((r) => ({ ...r, dueAt: r.dueAt.getTime() })), now, (at) => todayIn(at));
  db.transaction((tx) => {
    if (plan.cancel.length) tx.update(q).set({ status: "cancelled", error: SKIPPED_WHILE_OFF }).where(inArray(q.id, plan.cancel)).run();
    for (const r of plan.queue) tx.update(q).set({ status: "queued", dueAt: new Date(r.dueAt) }).where(eq(q.id, r.id)).run();
    // A run left with nothing to do has finished.
    const runIds = [...new Set(held.map((r) => r.runId).filter((id): id is number => id != null))];
    for (const runId of runIds) {
      const left = tx.select({ id: q.id }).from(q).where(and(eq(q.runId, runId), inArray(q.status, [...PENDING_STATUSES]))).get();
      if (!left) {
        tx.update(schema.leadFlowRuns)
          .set({ status: "finished", endedAt: new Date(now) })
          .where(and(eq(schema.leadFlowRuns.id, runId), eq(schema.leadFlowRuns.status, "active")))
          .run();
      }
    }
  });
  return { queued: plan.queue.length, skipped: plan.cancel.length };
}
```

- [ ] **Step 10: The ticker holds imported rows whose flow is off**

In `app/src/lib/leadFlows/dispatch.ts`:

a) Imports: add `isTriggerEnabled, IMPORTED_RUN_SOURCE, PENDING_STATUSES` to the `./flowModel` import.

b) `markRow`'s `patch.status` type becomes `"queued" | "sent" | "failed" | "cancelled" | "held"`.

c) In `closeRunIfDone`, replace `eq(schema.automationQueue.status, "queued")` with `inArray(schema.automationQueue.status, [...PENDING_STATUSES])`.

d) In `dispatchBound`, after `const leadStatus = new Map(...)`, add:

```ts
  // Imported runs (lib/ghlImport) only send while their flow is switched on.
  const runIds = [...new Set(due.map((d) => d.runId).filter((id): id is number => id != null))];
  const importedRuns = new Set(
    runIds.length
      ? tdb
          .select({ id: schema.leadFlowRuns.id })
          .from(schema.leadFlowRuns)
          .where(and(inArray(schema.leadFlowRuns.id, runIds), eq(schema.leadFlowRuns.source, IMPORTED_RUN_SOURCE)))
          .all()
          .map((r) => r.id)
      : [],
  );
  const triggerStates = new Map(tdb.select().from(schema.automationTriggers).all().map((t) => [t.key, t]));
```

and in the loop, right after the `if (item.leadId != null) { ... lost ... }` block and before `const handler = ...`:

```ts
    if (item.runId != null && importedRuns.has(item.runId) && !isTriggerEnabled(item.triggerKey, triggerStates.get(item.triggerKey))) {
      // Waits, untouched, until the flow is switched on (lib/leadFlows/importedRuns.ts releaseHeldImportRows).
      markRow(tdb, item.id, { status: "held" });
      continue;
    }
```

- [ ] **Step 11: Release held rows when a flow is switched on**

In `app/src/lib/automations.ts`:

a) Import: `import { releaseHeldImportRows } from "@/lib/leadFlows/importedRuns";`

b) At the end of `setTriggerEnabled` (after `upsertTriggerState(key, { enabled: persisted });`):

```ts
  // An imported run waiting for this flow carries on, past steps skipped.
  if (persisted && LEAD_FLOW_KEY_SET.has(key)) releaseHeldImportRows(key);
```

c) At the end of `saveTrigger` (after the `db.transaction(...)` call):

```ts
  if (enabled && LEAD_FLOW_KEY_SET.has(input.key)) releaseHeldImportRows(input.key);
```

- [ ] **Step 12: Run the tests**

Run, from `app/`:
- `npm test -- src/lib/leadFlows/importedRuns.test.ts` -> PASS
- `npm test -- src/lib/leadFlows/heldRows.test.ts` -> PASS
- the existing flow tests, which must still pass unchanged: `npm test -- src/lib/leadFlows/runs.test.ts`, `src/lib/leadFlows/dispatch.test.ts`, `src/lib/leadFlows/flows.e2e.test.ts`, `src/lib/leadFlows/consent.test.ts`, `src/lib/leadFlows/activityModel.test.ts`, `src/lib/leadFlows/activity.test.ts`, `src/lib/leadFlows/undelivered.test.ts`
- `npm run typecheck` -> clean

- [ ] **Step 13: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/tenant.ts src/lib/leadFlows/flowModel.ts src/lib/leadFlows/runs.ts src/lib/leadFlows/dispatch.ts src/lib/leadFlows/consent.ts src/lib/leadFlows/activityModel.ts src/lib/leadFlows/activity.ts src/lib/automations.ts src/lib/leadFlows/heldRows.ts src/lib/leadFlows/heldRows.test.ts src/lib/leadFlows/importedRuns.ts src/lib/leadFlows/importedRuns.test.ts
git commit -m "feat(lead-flows): imported runs, held while their flow is off, and do not contact

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any other file typecheck made you widen to the `git add` list by name.)

---

### Task 5: The dry run (pure planner)

**Files:**
- Create: `app/src/lib/ghlImport/plan.ts`
- Create: `app/src/lib/ghlImport/types.ts`
- Test: `app/src/lib/ghlImport/plan.test.ts`

**Interfaces:**
- Consumes: Task 1 `GhlContact`, `GhlOpportunity`, `toCsv`; Task 2 `decide`, `matchStaff`, `HOLDING`, `ImportColumn`; Task 3 `planSteps`, `DAY_MS`, `PlacedStep`; `columnMatches`, `resolveColumn`, `NEW_LEAD_FLOW`, `NURTURE_FLOW`, `ColumnRef` (flowModel); `pickForInterest` (flowPlan); `addDays`, `fitToWindow`, `morningOf`, `todayIn`, `SendingWindow` (sendingWindow); `resolveEntryStage`, `StageRole` (roles); `FollowUpKey` (followUpColumns); `normalizePhone` (`lib/whatsapp/phone.ts`); `splitFullName` (`lib/humanName.ts`).
- Produces (used by Tasks 6, 7):
  - `interface ImportPerson` (fields in the code), `joinPeople(contacts, opportunities): ImportPerson[]`
  - `interface Snapshot`, `SnapshotLead`, `SnapshotClient`, `SnapshotColumn`, `SnapshotFlow`
  - `type Outcome = "create" | "update" | "unchanged" | "already_imported" | "skip"`
  - `type LeadAction`, `interface RunAction`, `interface PersonPlan`, `interface PlanTotals`, `interface ImportPlan`
  - `buildPlan(people: ImportPerson[], snap: Snapshot, opts: { exportDay: string; now: number; assignees?: Record<string, number | null> }): ImportPlan`
  - `interface DryRunRow`, `dryRunRows(plan: ImportPlan): DryRunRow[]`, `dryRunCsv(rows: DryRunRow[], fmt: (ms: number) => string): string`, `displayName(p): string`
  - in `types.ts`: `StaffOption`, `AssigneeRow`, `DryRunData`, `DryRunResponse`, `ApplyResult`, `ImportResponse`, `ImportedPersonView`

- [ ] **Step 1: Write `types.ts`** (types only, nothing to test on its own)

Create `app/src/lib/ghlImport/types.ts`:

```ts
/**
 * The GoHighLevel import's shapes shared by the route, the store and the
 * screen. Types only. None of them carries the staff-only medical note
 * except ImportedPersonView, which only the lead and client pages read.
 */
import type { DryRunRow, PlanTotals } from "./plan";

export interface StaffOption {
  userId: number;
  name: string;
}

/** One GoHighLevel user from the files, and who their leads go to here. */
export interface AssigneeRow {
  ghlName: string;
  people: number;
  /** The automatic match by name, or null. */
  matchedUserId: number | null;
  /** Who it is now (the operator's pick, else the match); null = the default assignee. */
  userId: number | null;
}

export interface DryRunData {
  totals: PlanTotals;
  rows: DryRunRow[];
  assignees: AssigneeRow[];
  staff: StaffOption[];
  defaultAssigneeName: string | null;
  exportDay: string;
  now: number;
}

export type DryRunResponse = ({ ok: true } & DryRunData) | { ok: false; error: string };

export interface ApplyResult {
  leadsCreated: number;
  leadsUpdated: number;
  clientsCreated: number;
  clientsLinked: number;
  contactsAdded: number;
  doNotContact: number;
  runsPlaced: number;
  /** Of those, how many wait for a flow that is off. */
  runsWaiting: number;
  messagesQueued: number;
  unchanged: number;
  alreadyImported: number;
  skipped: number;
  failed: number;
  holdingCreated: boolean;
  /** At most 20, naming GoHighLevel contact ids only. */
  errors: string[];
}

export type ImportResponse = { ok: true; result: ApplyResult } | { ok: false; error: string };

/** What the lead and client pages show for an imported person. Staff only. */
export interface ImportedPersonView {
  ghlStage: string | null;
  daysInStage: number | null;
  ghlSource: string | null;
  tags: string[];
  treatment: string | null;
  usedBefore: string | null;
  town: string | null;
  staffMedicalNote: string | null;
  doNotContact: boolean;
  importedAt: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/ghlImport/plan.test.ts`:

```ts
// Run: npm test -- src/lib/ghlImport/plan.test.ts
//
// The whole dry run on a made-up business and made-up people: where each
// person goes, which follow-up and which step, duplicates, re-runs, do not
// contact, the totals, and that the dry run carries no medical note.
import assert from "node:assert/strict";

import { delayToMs, TRIGGER_LABELS } from "../automationModel";
import { FLOW_DEFAULTS } from "../leadFlows/flowModel";
import { FLOW_PRESETS } from "../leadFlows/presets";
import type { GhlContact, GhlOpportunity } from "./csv";
import { buildPlan, dryRunCsv, dryRunRows, joinPeople, type Snapshot, type SnapshotFlow, type SnapshotLead } from "./plan";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const DAY = 86_400_000;
const NOW = Date.parse("2030-01-16T10:00:00Z"); // Wednesday, 10:00 Irish time
const EXPORT_DAY = "2030-01-16";
const MORNING = (daysAgo: number) => Date.parse("2030-01-16T09:00:00Z") - daysAgo * DAY;
const MEDICAL = "FAKE-MEDICAL-SENTINEL";

// The default board: the nine columns and the five follow-up columns.
const columns: Snapshot["columns"] = [
  { id: 1, name: "New lead", role: "new", systemKey: null, position: 0 },
  { id: 2, name: "Hot lead", role: "engaged", systemKey: null, position: 1 },
  { id: 10, name: "No answer", role: null, systemKey: "no_answer", position: 2 },
  { id: 11, name: "Call back later", role: null, systemKey: "call_back", position: 3 },
  { id: 12, name: "Thinking about it", role: null, systemKey: "thinking", position: 4 },
  { id: 3, name: "Consultation booked", role: "booked", systemKey: null, position: 5 },
  { id: 4, name: "No-show", role: "no_show", systemKey: null, position: 6 },
  { id: 5, name: "Attended", role: "attended", systemKey: null, position: 7 },
  { id: 6, name: "Sale", role: "won", systemKey: null, position: 8 },
  { id: 7, name: "Repeat customer", role: "repeat", systemKey: null, position: 9 },
  { id: 13, name: "Long-term nurture", role: null, systemKey: "nurture", position: 10 },
  { id: 14, name: "Message undelivered", role: null, systemKey: "undelivered", position: 11 },
  { id: 8, name: "Lapsed", role: "lapsed", systemKey: null, position: 12 },
  { id: 9, name: "Lost", role: "lost", systemKey: null, position: 13 },
];

// Optimal Health's flows, all on except Thinking about it.
const preset = FLOW_PRESETS["optimal-health"];
const flow = (key: string, enabled = true): SnapshotFlow => {
  const d = FLOW_DEFAULTS[key];
  return {
    key,
    label: TRIGGER_LABELS[key] ?? key,
    enabled,
    messages: preset[key].map((m) => ({ channel: m.channel, delayMs: delayToMs(m.delayValue, m.delayUnit), matchInterest: m.matchInterest ?? null })),
    startColumn: d.startColumn,
    finish: d.finishColumn && d.finishAfter ? { column: d.finishColumn, afterMs: delayToMs(d.finishAfter.value, d.finishAfter.unit) } : null,
  };
};
const flows = [flow("new_lead"), flow("lead_no_answer"), flow("lead_call_back"), flow("lead_thinking", false), flow("lead_nurture")];

const existing = (over: Partial<SnapshotLead>): SnapshotLead => ({
  id: 500,
  email: null,
  phone: null,
  clientId: null,
  pipelineId: 1,
  therapyInterest: null,
  marketingConsentAt: null,
  lastStageAt: Date.parse("2029-06-01T00:00:00Z"),
  inActiveFlow: false,
  ...over,
});

const snap: Snapshot = {
  pipelineId: 1,
  importedContactIds: new Set(["done-1"]),
  leads: [
    existing({ id: 501, phone: "087 000 0009" }), // Ivan: matched by phone, old move
    existing({ id: 502, email: "joan@example.com", inActiveFlow: true }), // Joan: in a flow
    existing({ id: 503, email: "kate@example.com", lastStageAt: NOW - DAY }), // Kate: moved yesterday in Adonis
    existing({ id: 504, email: "liam@example.com", pipelineId: 7 }), // Liam: on a campaign board
  ],
  clients: [{ id: 900, email: "mary@example.com", phone: "" }],
  contactEmails: new Set(["nora@example.com"]),
  suppressedEmails: new Set(["olive@example.com"]),
  columns,
  flows,
  staff: [
    { userId: 1, name: "Sandra Example" },
    { userId: 2, name: "DJ" },
  ],
  defaultAssigneeUserId: 2,
  window: null,
};

let id = 0;
const contact = (first: string, over: Partial<GhlContact> = {}): GhlContact => ({
  contactId: `c-${++id}`,
  firstName: first,
  lastName: "Example",
  phone: `+3538700000${String(id).padStart(2, "0")}`,
  email: `${first.toLowerCase()}@example.com`,
  createdAt: Date.parse("2029-10-01T10:00:00Z"),
  tags: [],
  dnd: false,
  source: "Facebook",
  treatment: "",
  town: "Clonmel",
  medicalCondition: MEDICAL,
  usedBefore: "no",
  ...over,
});
const opp = (c: GhlContact, stage: string, days: number | null, over: Partial<GhlOpportunity> = {}): GhlOpportunity => ({
  opportunityId: `o-${c.contactId}`,
  contactId: c.contactId,
  contactName: `${c.firstName} ${c.lastName}`,
  phone: c.phone,
  email: c.email,
  pipeline: "Main Leads",
  stage,
  source: "Facebook",
  assigned: "Sandra Example",
  createdAt: Date.parse("2029-10-01T10:00:00Z"),
  updatedAt: Date.parse("2029-12-01T10:00:00Z"),
  notes: "Rang, no answer",
  tags: [],
  daysInStage: days,
  ...over,
});

const people = {
  aoife: contact("Aoife", { treatment: "Infrared Therapy" }),
  brian: contact("Brian"),
  ciara: contact("Ciara"),
  dara: contact("Dara"),
  eve: contact("Eve"),
  fiona: contact("Fiona", { dnd: true }),
  gavin: contact("Gavin", { tags: ["member"] }),
  hannah: contact("Hannah"),
  ivan: contact("Ivan", { phone: "+353870000009", email: "" }),
  joan: contact("Joan"),
  kate: contact("Kate"),
  liam: contact("Liam"),
  mary: contact("Mary"),
  nora: contact("Nora"),
  olive: contact("Olive"),
  pat: contact("Pat", { email: "hannah@example.com", phone: "" }),
  quinn: contact("Quinn"),
  rose: contact("Rose", { email: "", phone: "" }),
  done: { ...contact("Done"), contactId: "done-1" },
  won: contact("Wendy"),
};
const opps = [
  opp(people.aoife, "Long Term Nurture", 10),
  opp(people.brian, "Call Back Later", 3),
  opp(people.ciara, "Thinking About It", 40),
  opp(people.dara, "Call Back Later", 10),
  opp(people.eve, "Consult  Booked", 14),
  opp(people.fiona, "Long Term Nurture", 5),
  opp(people.ivan, "Call Back Later", 20),
  opp(people.joan, "Long Term Nurture", 30),
  opp(people.kate, "Long Term Nurture", 30),
  opp(people.liam, "Long Term Nurture", 30),
  opp(people.mary, "Long Term Nurture", 30),
  opp(people.quinn, "Holding", 3, { assigned: "Daniel O Dwyer" }),
  opp(people.won, "Won", 100),
  opp(people.done, "Lost", 3),
];
const persons = joinPeople(Object.values(people), opps);
const plan = buildPlan(persons, snap, { exportDay: EXPORT_DAY, now: NOW });
const of = (c: GhlContact) => plan.people.find((p) => p.person.ghlContactId === c.contactId)!;

ok(persons.length === Object.keys(people).length, "one person per contact");
ok(of(people.aoife).person.staffMedicalNote === MEDICAL, "the medical note is carried for the write");

// Aoife: 10 days into nurture, infrared: week 3's infrared WhatsApp is next, 14 days after she entered.
{
  const p = of(people.aoife);
  ok(p.outcome === "create" && p.lead?.mode === "place" && p.lead.columnName === "Long-term nurture", "nurture column");
  ok(p.lead?.mode === "place" && p.lead.consent && p.lead.enteredAt === MORNING(10), "consent, entered 10 days ago");
  ok(p.run?.flowKey === "lead_nurture" && p.run.steps[0].dueAt === MORNING(10) + 14 * DAY && p.run.steps[0].channel === "whatsapp", "week 3 WhatsApp next");
  ok(p.run!.steps.length === 5, "weeks 3, 6, 8, 10 and 12 left");
  ok(p.lead?.mode === "place" && p.lead.assigneeUserId === 1, "assigned to Sandra by name");
}
// Brian: 3 days into Call back later: the 4-day WhatsApp tomorrow, then the move at 6 days.
{
  const p = of(people.brian);
  ok(p.lead?.mode === "place" && p.lead.columnName === "Call back later" && p.run?.flowKey === "lead_call_back", "call back column and flow");
  ok(p.run!.steps.length === 1 && p.run!.steps[0].dueAt === MORNING(3) + 4 * DAY && p.run!.finishAt === MORNING(3) + 6 * DAY, "one WhatsApp, then the move");
}
// Ciara: 40 days thinking: stale, Long-term nurture from week 1, now. Her week-1 email is the only message today.
{
  const p = of(people.ciara);
  ok(p.lead?.mode === "place" && p.lead.columnName === "Long-term nurture" && p.lead.enteredAt === NOW, "stale: nurture, entered now");
  ok(p.run?.flowKey === "lead_nurture" && p.run.steps[0].dueAt === NOW && p.run.steps[0].step === 0, "week 1 now");
  ok(p.run!.steps.filter((s) => s.dueAt < NOW + DAY).length === 1, "one message on the import day");
}
// Dara: 10 days into Call back later: the flow ended at 6 days, so she moves on to nurture from week 1.
{
  const p = of(people.dara);
  ok(p.lead?.mode === "place" && p.lead.columnName === "Long-term nurture" && p.run?.flowKey === "lead_nurture" && p.run.steps[0].dueAt === NOW, "past its end: nurture from week 1");
}
// Eve: booked 14 days ago: Consultation booked, no flow.
ok(of(people.eve).lead?.mode === "place" && (of(people.eve).lead as { columnName: string }).columnName === "Consultation booked" && of(people.eve).run === null, "booked, no flow");
// Fiona: DND: column kept, no flow, no consent.
{
  const p = of(people.fiona);
  ok(p.doNotContact && p.run === null && p.lead?.mode === "place" && !p.lead.consent && p.lead.columnName === "Long-term nurture", "do not contact");
}
// Gavin: member tag, no opportunity: a client.
ok(of(people.gavin).client?.existingId === null && of(people.gavin).lead === null && of(people.gavin).to === "Clients", "member: new client");
// Hannah: no opportunity, no tags: an email contact.
ok(of(people.hannah).contact && of(people.hannah).to === "Email contacts", "contact only");
// Ivan: matched by phone (national format) to an Adonis lead, moved long ago: moved now.
{
  const p = of(people.ivan);
  ok(p.match?.kind === "lead" && p.match.id === 501 && p.lead?.mode === "place" && p.lead.existingId === 501 && p.outcome === "update", "matched by phone and moved");
}
// Joan: in an Adonis flow: only missing details.
ok(of(people.joan).lead?.mode === "fill" && of(people.joan).run === null && /follow-up/.test(of(people.joan).note), "in a flow: fill only");
// Kate: moved more recently in Adonis: only missing details.
ok(of(people.kate).lead?.mode === "fill" && /more recently/.test(of(people.kate).note), "newer Adonis stage kept");
// Liam: on another board: only missing details.
ok(of(people.liam).lead?.mode === "fill", "another board: fill only");
// Mary: already a client here, GoHighLevel says nurture: not put on the board.
ok(of(people.mary).lead === null && of(people.mary).outcome === "unchanged" && of(people.mary).match?.kind === "client", "a client stays a client");
// Nora: already an email contact.
ok(of(people.nora).outcome === "unchanged" && !of(people.nora).contact, "already a contact");
// Olive: on the do-not-email list: not added.
ok(!of(people.olive).contact && of(people.olive).outcome === "unchanged", "suppressed address not subscribed");
// Pat: same email as Hannah, later in the file: imported once.
ok(of(people.pat).outcome === "skip", "a twin in the file is skipped");
// Quinn: Holding, assigned to someone with no match: the default assignee; a new Holding column.
ok(of(people.quinn).lead?.mode === "place" && (of(people.quinn).lead as { columnId: number | null }).columnId === null && (of(people.quinn).lead as { columnName: string }).columnName === "Holding", "Holding, created on import");
ok((of(people.quinn).lead as { assigneeUserId: number | null }).assigneeUserId === 2, "no match: the default assignee");
// Rose: no email, no phone, no opportunity: nothing.
ok(of(people.rose).outcome === "skip", "nothing to add");
// Done: already imported.
ok(of(people.done).outcome === "already_imported", "already imported");
// Wendy: won: a client and a won lead.
ok(of(people.won).client?.existingId === null && (of(people.won).lead as { columnName: string }).columnName === "Sale", "won: client and Sale");

// The operator corrects an assignee.
{
  const again = buildPlan(persons, snap, { exportDay: EXPORT_DAY, now: NOW, assignees: { "Daniel O Dwyer": 1 } });
  const q = again.people.find((p) => p.person.ghlContactId === people.quinn.contactId)!;
  ok(q.lead?.mode === "place" && q.lead.assigneeUserId === 1, "the operator's pick wins");
  const row = again.assignees.find((a) => a.ghlName === "Daniel O Dwyer")!;
  ok(row.matchedUserId === null && row.userId === 1 && row.people === 1, "the assignee list shows the pick");
  const bad = buildPlan(persons, snap, { exportDay: EXPORT_DAY, now: NOW, assignees: { "Daniel O Dwyer": 99 } });
  ok((bad.people.find((p) => p.person.ghlContactId === people.quinn.contactId)!.lead as { assigneeUserId: number | null }).assigneeUserId === 2, "a user not on the team falls back to the default");
}

// Totals.
{
  const t = plan.totals;
  ok(t.people === persons.length && t.alreadyImported === 1, "people and already imported");
  ok(t.doNotContact === 1, "one do not contact");
  ok(t.clients === 2, "Gavin and Wendy are clients");
  ok(t.contactsOnly === 1, "Hannah is a contact");
  ok(t.duplicates >= 6, "Ivan, Joan, Kate, Liam, Mary and Nora matched");
  ok(t.columns.some((c) => c.name === "Holding" && c.count === 1) && t.newColumns.includes("Holding"), "the new Holding column is listed");
  const nurture = t.flows.find((f) => f.key === "lead_nurture")!;
  ok(nurture.people === 4 && nurture.enabled, "Aoife, Ciara, Dara and Ivan on nurture");
  const inSeven = plan.people.flatMap((p) => (p.run?.enabled ? p.run.steps : [])).filter((s) => s.dueAt >= NOW && s.dueAt < NOW + 7 * DAY).length;
  ok(t.messagesNext7Days === inSeven && inSeven > 0, "messages in the next 7 days");
}

// A flow that is off: placed, waiting.
{
  const ziggy = contact("Ziggy");
  const p = buildPlan(joinPeople([ziggy], [opp(ziggy, "Thinking About It", 2)]), snap, { exportDay: EXPORT_DAY, now: NOW });
  ok(p.people[0].run?.flowKey === "lead_thinking" && p.people[0].run.enabled === false, "placed on a flow that is off");
  ok(p.totals.waitingForFlowOff === 1 && p.totals.messagesNext7Days === 0, "counted as waiting, not as due");
}

// The dry run and its download carry no medical note.
{
  const rows = dryRunRows(plan);
  ok(rows.length === plan.people.length, "one row per person");
  ok(!JSON.stringify(rows).includes(MEDICAL), "no medical note in the dry run");
  const csv = dryRunCsv(rows, (ms) => new Date(ms).toISOString());
  ok(!csv.includes(MEDICAL) && csv.startsWith("Name,"), "no medical note in the download");
  const aoifeRow = rows.find((r) => r.id === people.aoife.contactId)!;
  ok(aoifeRow.to === "Long-term nurture" && aoifeRow.flow === "Long-term nurture" && aoifeRow.nextAt === MORNING(10) + 14 * DAY && aoifeRow.fromStage === "Long Term Nurture" && aoifeRow.days === 10, "a dry-run row says where, which flow and when");
}

console.log(`ghlImport plan: ${n} checks passed.`);
```

Note for the implementer: `TRIGGER_LABELS.lead_nurture` is the flow's label; check its exact value in `app/src/lib/automationModel.ts` and, if it is not "Long-term nurture", change the `aoifeRow.flow === "Long-term nurture"` check to that label (and nothing else).

Run: `npm test -- src/lib/ghlImport/plan.test.ts`
Expected: FAIL, `Cannot find module './plan'`.

- [ ] **Step 3: Write `plan.ts`**

Create `app/src/lib/ghlImport/plan.ts`:

```ts
/**
 * The GoHighLevel import's dry run: what happens to every person, from the
 * two exports and a snapshot of this business (snapshot.ts). Pure: no DB,
 * so the whole plan is tested without one, and the import (apply.ts) only
 * carries out what the plan says.
 */
import { splitFullName } from "@/lib/humanName";
import { columnMatches, NEW_LEAD_FLOW, NURTURE_FLOW, resolveColumn, type ColumnRef } from "@/lib/leadFlows/flowModel";
import { pickForInterest } from "@/lib/leadFlows/flowPlan";
import { addDays, fitToWindow, morningOf, todayIn, type SendingWindow } from "@/lib/leadFlows/sendingWindow";
import type { FollowUpKey } from "@/lib/pipeline/followUpColumns";
import { resolveEntryStage, type StageRole } from "@/lib/pipeline/roles";
import { normalizePhone } from "@/lib/whatsapp/phone";

import { toCsv, type GhlContact, type GhlOpportunity } from "./csv";
import { decide, HOLDING, matchStaff, type FlowIntent, type ImportColumn } from "./mapping";
import { DAY_MS, planSteps, type PlacedStep, type StepPlan } from "./placement";
import type { AssigneeRow } from "./types";

// ── people ─────────────────────────────────────────────────────────────────────

/** One GoHighLevel person: the contact joined with its latest opportunity. */
export interface ImportPerson {
  ghlContactId: string;
  ghlOpportunityId: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Lowercased. */
  email: string | null;
  phone: string | null;
  createdAt: number | null;
  ghlStage: string | null;
  daysInStage: number | null;
  ghlSource: string | null;
  tags: string[];
  notes: string | null;
  treatment: string | null;
  usedBefore: string | null;
  town: string | null;
  /** Staff only: written to ghl_import_people and nowhere else. */
  staffMedicalNote: string | null;
  assignedName: string | null;
  dnd: boolean;
}

const blank = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

function personFrom(c: GhlContact | null, o: GhlOpportunity | null): ImportPerson {
  const split = splitFullName(o?.contactName ?? "");
  const first = blank(c?.firstName);
  const last = blank(c?.lastName);
  return {
    ghlContactId: (c?.contactId ?? o?.contactId)!,
    ghlOpportunityId: blank(o?.opportunityId),
    firstName: first ?? (last ? null : split.firstName),
    lastName: last ?? (first ? null : split.lastName),
    email: (blank(c?.email) ?? blank(o?.email))?.toLowerCase() ?? null,
    phone: blank(c?.phone) ?? blank(o?.phone),
    createdAt: c?.createdAt ?? o?.createdAt ?? null,
    ghlStage: blank(o?.stage),
    daysInStage: o?.daysInStage ?? null,
    ghlSource: blank(c?.source) ?? blank(o?.source),
    tags: [...new Set([...(c?.tags ?? []), ...(o?.tags ?? [])])],
    notes: blank(o?.notes),
    treatment: blank(c?.treatment),
    usedBefore: blank(c?.usedBefore),
    town: blank(c?.town),
    staffMedicalNote: blank(c?.medicalCondition),
    assignedName: blank(o?.assigned),
    dnd: c?.dnd ?? false,
  };
}

/** Contacts in file order, each with its most recently updated opportunity; then opportunities with no contact row. */
export function joinPeople(contacts: GhlContact[], opportunities: GhlOpportunity[]): ImportPerson[] {
  const stamp = (o: GhlOpportunity) => o.updatedAt ?? o.createdAt ?? 0;
  const latest = new Map<string, GhlOpportunity>();
  for (const o of opportunities) {
    const cur = latest.get(o.contactId);
    if (!cur || stamp(o) > stamp(cur)) latest.set(o.contactId, o);
  }
  const out: ImportPerson[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    if (seen.has(c.contactId)) continue;
    seen.add(c.contactId);
    out.push(personFrom(c, latest.get(c.contactId) ?? null));
  }
  for (const o of latest.values()) {
    if (seen.has(o.contactId)) continue;
    seen.add(o.contactId);
    out.push(personFrom(null, o));
  }
  return out;
}

export function displayName(p: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email || p.phone || "No name";
}

// ── the business ───────────────────────────────────────────────────────────────

export interface SnapshotLead {
  id: number;
  /** Lowercased. */
  email: string | null;
  phone: string | null;
  clientId: number | null;
  pipelineId: number;
  therapyInterest: string | null;
  marketingConsentAt: number | null;
  /** The latest stage move (lead_stage_events.at), else when the lead was created. */
  lastStageAt: number;
  inActiveFlow: boolean;
}

export interface SnapshotClient {
  id: number;
  /** Lowercased. */
  email: string | null;
  phone: string;
}

export interface SnapshotColumn {
  id: number;
  name: string;
  role: StageRole | null;
  systemKey: FollowUpKey | null;
  position: number;
}

export interface SnapshotFlow {
  key: string;
  label: string;
  enabled: boolean;
  messages: { channel: string; delayMs: number; matchInterest: string | null }[];
  startColumn: ColumnRef | null;
  finish: { column: ColumnRef; afterMs: number } | null;
}

export interface Snapshot {
  /** The default board, where imported leads go. */
  pipelineId: number;
  importedContactIds: Set<string>;
  leads: SnapshotLead[];
  clients: SnapshotClient[];
  /** Lowercased marketing contact addresses. */
  contactEmails: Set<string>;
  /** Lowercased addresses on the do-not-email list, any reason. */
  suppressedEmails: Set<string>;
  /** The default board's columns. */
  columns: SnapshotColumn[];
  /** Every lead flow but a booked call, on or off, in catalog order. */
  flows: SnapshotFlow[];
  staff: { userId: number; name: string }[];
  defaultAssigneeUserId: number | null;
  window: SendingWindow | null;
}

// ── the plan ───────────────────────────────────────────────────────────────────

export type Outcome = "create" | "update" | "unchanged" | "already_imported" | "skip";

export type LeadAction =
  | {
      /** Fill fields the lead has empty; leave its column, follow-ups and consent alone. */
      mode: "fill";
      existingId: number;
      assigneeUserId: number | null;
    }
  | {
      /** Put the lead in a column (a new lead, or an existing one moved). */
      mode: "place";
      existingId: number | null;
      /** null = the Holding column, created on import. */
      columnId: number | null;
      columnName: string;
      role: StageRole | null;
      /** When they entered the column: the stage event's time. */
      enteredAt: number;
      lost: boolean;
      /** Record marketing consent now. */
      consent: boolean;
      assigneeUserId: number | null;
    };

export interface RunAction {
  flowKey: string;
  flowLabel: string;
  enabled: boolean;
  steps: PlacedStep[];
  finishAt: number | null;
  emailOnly: boolean;
}

export interface PersonPlan {
  person: ImportPerson;
  outcome: Outcome;
  /** Why, in plain words. */
  note: string;
  /** Who they matched in Adonis, if anyone (a contact match has no id). */
  match: { kind: "lead" | "client" | "contact"; id: number | null } | null;
  lead: LeadAction | null;
  client: { existingId: number | null } | null;
  /** Add to marketing contacts (people with no opportunity). */
  contact: boolean;
  doNotContact: boolean;
  run: RunAction | null;
  /** Where they go, for the dry run: a column, "Clients", "Email contacts", "Do-not-email list" or "No change". */
  to: string;
}

export interface PlanTotals {
  people: number;
  /** Leads placed in a column (new or moved). */
  leads: number;
  clients: number;
  contactsOnly: number;
  doNotContact: number;
  /** Matched to someone already in Adonis. */
  duplicates: number;
  alreadyImported: number;
  unchanged: number;
  skipped: number;
  columns: { name: string; count: number }[];
  /** Columns the import adds to the board. */
  newColumns: string[];
  flows: { key: string; label: string; enabled: boolean; people: number }[];
  /** Messages due in the 7 days from now, in flows that are on. */
  messagesNext7Days: number;
  /** People placed in a flow that is off. */
  waitingForFlowOff: number;
}

export interface ImportPlan {
  people: PersonPlan[];
  totals: PlanTotals;
  assignees: AssigneeRow[];
}

export interface PlanOptions {
  /** The day the files were exported, "YYYY-MM-DD" (Irish time). */
  exportDay: string;
  now: number;
  /** GoHighLevel user name -> Adonis user id, the operator's picks; null = the default assignee. */
  assignees?: Record<string, number | null>;
}

const HOLDING_NAME = "Holding";

function phoneKey(phone: string | null | undefined): string | null {
  const d = normalizePhone(phone);
  return d.length >= 7 ? d : null;
}

interface Index {
  leadByEmail: Map<string, SnapshotLead>;
  leadByPhone: Map<string, SnapshotLead>;
  clientByEmail: Map<string, SnapshotClient>;
  clientByPhone: Map<string, SnapshotClient>;
  holding: SnapshotColumn | null;
  entry: SnapshotColumn;
}

function indexSnapshot(snap: Snapshot): Index {
  const ix: Index = {
    leadByEmail: new Map(),
    leadByPhone: new Map(),
    clientByEmail: new Map(),
    clientByPhone: new Map(),
    holding: snap.columns.find((c) => c.role == null && c.systemKey == null && c.name.trim().toLowerCase() === HOLDING) ?? null,
    entry: (resolveEntryStage(snap.columns.map((c) => ({ ...c, colour: "" }))) as SnapshotColumn | null) ?? snap.columns[0],
  };
  for (const l of snap.leads) {
    if (l.email && !ix.leadByEmail.has(l.email)) ix.leadByEmail.set(l.email, l);
    const pk = phoneKey(l.phone);
    if (pk && !ix.leadByPhone.has(pk)) ix.leadByPhone.set(pk, l);
  }
  for (const c of snap.clients) {
    if (c.email && !ix.clientByEmail.has(c.email)) ix.clientByEmail.set(c.email, c);
    const pk = phoneKey(c.phone);
    if (pk && !ix.clientByPhone.has(pk)) ix.clientByPhone.set(pk, c);
  }
  return ix;
}

function assigneeFor(name: string | null, snap: Snapshot, opts: PlanOptions): number | null {
  const onTeam = (id: number | null | undefined) => (id != null && snap.staff.some((s) => s.userId === id) ? id : null);
  if (!name) return onTeam(snap.defaultAssigneeUserId);
  if (opts.assignees && name in opts.assignees) return onTeam(opts.assignees[name]) ?? onTeam(snap.defaultAssigneeUserId);
  return matchStaff(name, snap.staff) ?? onTeam(snap.defaultAssigneeUserId);
}

function flowForColumn(snap: Snapshot, col: SnapshotColumn): SnapshotFlow | null {
  return snap.flows.find((f) => f.startColumn != null && columnMatches(f.startColumn, col)) ?? null;
}

function schedule(
  p: ImportPerson,
  interest: string | null,
  snap: Snapshot,
  flow: SnapshotFlow,
  o: { from: FlowIntent["from"]; emailOnly: boolean; entry: number; now: number; suppressed: boolean },
): StepPlan {
  const picked = pickForInterest(flow.messages, interest);
  return planSteps({
    messages: picked.map((m) => ({ channel: o.emailOnly && m.channel === "whatsapp" ? "email" : m.channel, delayMs: m.delayMs })),
    startAt: o.from === "start" ? o.now : o.entry,
    doneThroughMs: o.from === "start" ? null : (p.daysInStage ?? 0) * DAY_MS,
    now: o.now,
    finishAfterMs: flow.finish?.afterMs ?? null,
    fit: (at, ch) => fitToWindow(at, ch, snap.window),
    dayOf: (at) => todayIn(at),
    canReceive: (ch) => (ch === "whatsapp" ? !!p.phone : ch === "email" ? !!p.email && !o.suppressed : false),
  });
}

function runFrom(flow: SnapshotFlow, sp: StepPlan, emailOnly: boolean): RunAction | null {
  if (sp.steps.length === 0 && sp.finishAt == null) return null;
  return { flowKey: flow.key, flowLabel: flow.label, enabled: flow.enabled, steps: sp.steps, finishAt: sp.finishAt, emailOnly };
}

function planPerson(p: ImportPerson, snap: Snapshot, ix: Index, opts: PlanOptions, seen: Set<string>): PersonPlan {
  const base = { person: p, match: null, lead: null, client: null, contact: false, doNotContact: false, run: null } as const;
  if (snap.importedContactIds.has(p.ghlContactId)) {
    return { ...base, outcome: "already_imported", note: "Already imported: nothing changes.", to: "No change" };
  }
  const keys = [p.email ? `e:${p.email}` : null, phoneKey(p.phone) ? `p:${phoneKey(p.phone)}` : null].filter((k): k is string => k != null);
  if (keys.some((k) => seen.has(k))) {
    return { ...base, outcome: "skip", note: "Same email or phone as another contact in these files: imported once.", to: "No change" };
  }
  keys.forEach((k) => seen.add(k));

  const d = decide({ stage: p.ghlStage, daysInStage: p.daysInStage, tags: p.tags, dnd: p.dnd });
  const pk = phoneKey(p.phone);
  const lead = (p.email ? ix.leadByEmail.get(p.email) : undefined) ?? (pk ? ix.leadByPhone.get(pk) : undefined) ?? null;
  const client = (p.email ? ix.clientByEmail.get(p.email) : undefined) ?? (pk ? ix.clientByPhone.get(pk) : undefined) ?? null;
  const isContact = !!p.email && snap.contactEmails.has(p.email);
  const match: PersonPlan["match"] = lead ? { kind: "lead", id: lead.id } : client ? { kind: "client", id: client.id } : isContact ? { kind: "contact", id: null } : null;
  const suppressed = !!p.email && snap.suppressedEmails.has(p.email);
  const dnc = d.doNotContact;
  const withDnc = { ...base, match, doNotContact: dnc };
  const pl = d.placement;

  if (pl.kind === "contact") {
    if (lead || client) {
      return { ...withDnc, outcome: dnc ? "update" : "unchanged", note: `Already here as a ${lead ? "lead" : "client"}${dnc ? ": marked do not contact" : ""}.`, to: "No change" };
    }
    if (!p.email) return { ...withDnc, outcome: "skip", note: "No email address and no opportunity: nothing to add.", to: "No change" };
    if (dnc) return { ...withDnc, outcome: "create", note: "Do not contact: added to your do-not-email list.", to: "Do-not-email list" };
    if (isContact) return { ...withDnc, outcome: "unchanged", note: "Already on your email contacts.", to: "No change" };
    if (suppressed) return { ...withDnc, outcome: "unchanged", note: "On your do-not-email list: not added.", to: "No change" };
    return { ...withDnc, contact: true, outcome: "create", note: `${d.rule}.`, to: "Email contacts" };
  }

  const assignee = assigneeFor(p.assignedName, snap, opts);

  if (pl.kind === "client") {
    if (client) return { ...withDnc, client: { existingId: client.id }, outcome: "update", note: "Already a client here: missing details filled.", to: "Clients" };
    return {
      ...withDnc,
      client: { existingId: lead?.clientId ?? null },
      lead: lead ? { mode: "fill", existingId: lead.id, assigneeUserId: assignee } : null,
      outcome: lead ? "update" : "create",
      note: `${d.rule}.`,
      to: "Clients",
    };
  }

  // A lead column.
  if (client && !lead && !pl.won) {
    return { ...withDnc, outcome: dnc ? "update" : "unchanged", note: "Already a client here: not put on the lead board.", to: "No change" };
  }
  const ghlStageAt = p.daysInStage != null ? morningOf(addDays(opts.exportDay, -p.daysInStage), snap.window) : (p.createdAt ?? opts.now);
  if (lead && (lead.inActiveFlow || lead.pipelineId !== snap.pipelineId || lead.lastStageAt >= ghlStageAt)) {
    const why = lead.inActiveFlow
      ? "In an Adonis follow-up already: only missing details filled."
      : lead.pipelineId !== snap.pipelineId
        ? "On another board here: only missing details filled."
        : "Moved more recently in Adonis: only missing details filled.";
    return { ...withDnc, lead: { mode: "fill", existingId: lead.id, assigneeUserId: assignee }, outcome: "update", note: why, to: "No change" };
  }

  let note = d.rule;
  let intent = pl.flow;
  let col: SnapshotColumn | null = pl.column === HOLDING ? ix.holding : resolveColumn(pl.column as ColumnRef, snap.columns);
  const newHolding = pl.column === HOLDING && !col;
  if (!col && !newHolding) {
    col = ix.entry;
    note = `No such column on your board: placed in ${col.name}`;
    intent = null;
  }
  const consent = d.consent && !suppressed;
  const hasConsent = consent || (lead?.marketingConsentAt != null && !dnc);
  const interest = lead?.therapyInterest?.trim() || p.treatment;
  let enteredAt = intent?.from === "start" ? opts.now : ghlStageAt;
  let run: RunAction | null = null;

  if (intent && col && !dnc) {
    const flow = intent.via === "new_lead" ? (snap.flows.find((f) => f.key === NEW_LEAD_FLOW) ?? null) : flowForColumn(snap, col);
    if (!flow) note = `${note}. No follow-up starts in this column`;
    else if (flow.key === NURTURE_FLOW && !hasConsent) note = `${note}. No marketing consent: column only`;
    else {
      const sp = schedule(p, interest, snap, flow, { from: intent.from, emailOnly: intent.emailOnly, entry: ghlStageAt, now: opts.now, suppressed });
      if (!sp.ended) run = runFrom(flow, sp, intent.emailOnly);
      else if (flow.finish) {
        const next = resolveColumn(flow.finish.column, snap.columns);
        if (next) {
          col = next;
          enteredAt = opts.now;
          const nextFlow = flowForColumn(snap, next);
          if (nextFlow && !(nextFlow.key === NURTURE_FLOW && !hasConsent)) {
            run = runFrom(nextFlow, schedule(p, interest, snap, nextFlow, { from: "start", emailOnly: false, entry: opts.now, now: opts.now, suppressed }), false);
          }
          note = `${flow.label} would have ended by now: moved to ${next.name}${run ? " from the start" : ""}`;
        } else note = `${note}. Past the end of ${flow.label}: column only`;
      } else note = `${note}. Past the end of ${flow.label}: column only`;
    }
  }

  const columnName = col?.name ?? HOLDING_NAME;
  return {
    ...withDnc,
    lead: {
      mode: "place",
      existingId: lead?.id ?? null,
      columnId: col?.id ?? null,
      columnName,
      role: col?.role ?? null,
      enteredAt,
      lost: pl.lost,
      consent: consent && lead?.marketingConsentAt == null,
      assigneeUserId: assignee,
    },
    client: pl.won ? { existingId: lead?.clientId ?? client?.id ?? null } : null,
    run,
    outcome: lead || (pl.won && client) ? "update" : "create",
    note: `${note}.`,
    to: columnName,
  };
}

function totalsFor(plans: PersonPlan[], now: number): PlanTotals {
  const t: PlanTotals = {
    people: plans.length,
    leads: 0,
    clients: 0,
    contactsOnly: 0,
    doNotContact: 0,
    duplicates: 0,
    alreadyImported: 0,
    unchanged: 0,
    skipped: 0,
    columns: [],
    newColumns: [],
    flows: [],
    messagesNext7Days: 0,
    waitingForFlowOff: 0,
  };
  const cols = new Map<string, number>();
  const flows = new Map<string, PlanTotals["flows"][number]>();
  for (const p of plans) {
    if (p.outcome === "already_imported") {
      t.alreadyImported++;
      continue;
    }
    if (p.outcome === "skip") t.skipped++;
    if (p.outcome === "unchanged") t.unchanged++;
    if (p.match) t.duplicates++;
    if (p.lead?.mode === "place") {
      t.leads++;
      cols.set(p.lead.columnName, (cols.get(p.lead.columnName) ?? 0) + 1);
      if (p.lead.columnId == null && !t.newColumns.includes(p.lead.columnName)) t.newColumns.push(p.lead.columnName);
    }
    if (p.client) t.clients++;
    if (p.contact) t.contactsOnly++;
    if (p.doNotContact) t.doNotContact++;
    if (p.run) {
      const f = flows.get(p.run.flowKey) ?? { key: p.run.flowKey, label: p.run.flowLabel, enabled: p.run.enabled, people: 0 };
      f.people++;
      flows.set(p.run.flowKey, f);
      if (!p.run.enabled) t.waitingForFlowOff++;
      else t.messagesNext7Days += p.run.steps.filter((s) => s.dueAt >= now && s.dueAt < now + 7 * DAY_MS).length;
    }
  }
  t.columns = [...cols].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  t.flows = [...flows.values()].sort((a, b) => b.people - a.people);
  return t;
}

function assigneeRows(people: ImportPerson[], snap: Snapshot, opts: PlanOptions): AssigneeRow[] {
  const counts = new Map<string, number>();
  for (const p of people) if (p.assignedName) counts.set(p.assignedName, (counts.get(p.assignedName) ?? 0) + 1);
  return [...counts].map(([ghlName, n]) => {
    const matched = matchStaff(ghlName, snap.staff);
    const picked = opts.assignees && ghlName in opts.assignees ? opts.assignees[ghlName] : matched;
    const userId = picked != null && snap.staff.some((s) => s.userId === picked) ? picked : null;
    return { ghlName, people: n, matchedUserId: matched, userId };
  });
}

export function buildPlan(people: ImportPerson[], snap: Snapshot, opts: PlanOptions): ImportPlan {
  const ix = indexSnapshot(snap);
  const seen = new Set<string>();
  const plans = people.map((p) => planPerson(p, snap, ix, opts, seen));
  return { people: plans, totals: totalsFor(plans, opts.now), assignees: assigneeRows(people, snap, opts) };
}

// ── what the screen shows ──────────────────────────────────────────────────────

/** One person in the dry run. Never carries the medical note. */
export interface DryRunRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  fromStage: string;
  days: number | null;
  to: string;
  flow: string | null;
  flowOff: boolean;
  nextChannel: string | null;
  nextAt: number | null;
  doNotContact: boolean;
  outcome: Outcome;
  note: string;
}

export function dryRunRows(plan: ImportPlan): DryRunRow[] {
  return plan.people.map((p) => {
    const next = p.run?.steps[0] ?? null;
    return {
      id: p.person.ghlContactId,
      name: displayName(p.person),
      email: p.person.email ?? "",
      phone: p.person.phone ?? "",
      fromStage: p.person.ghlStage ?? "No opportunity",
      days: p.person.daysInStage,
      to: p.to,
      flow: p.run?.flowLabel ?? null,
      flowOff: p.run ? !p.run.enabled : false,
      nextChannel: next?.channel ?? null,
      nextAt: next?.dueAt ?? null,
      doNotContact: p.doNotContact,
      outcome: p.outcome,
      note: p.note,
    };
  });
}

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

export function dryRunCsv(rows: DryRunRow[], fmt: (ms: number) => string): string {
  return toCsv([
    ["Name", "Email", "Phone", "GoHighLevel stage", "Days in stage", "Goes to", "Follow-up", "Next message", "Next message at", "Do not contact", "Notes"],
    ...rows.map((r) => [
      r.name,
      r.email,
      r.phone,
      r.fromStage,
      r.days,
      r.to,
      r.flow ? `${r.flow}${r.flowOff ? " (off: waits)" : ""}` : "",
      r.nextChannel ? (CHANNEL[r.nextChannel] ?? r.nextChannel) : "",
      r.nextAt != null ? fmt(r.nextAt) : "",
      r.doNotContact ? "Yes" : "",
      r.note,
    ]),
  ]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/ghlImport/plan.test.ts`
Expected: PASS. If a check fails, fix `plan.ts` (the test states the agreed behaviour); only the flow-label check may be adjusted, as noted above.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && npm run typecheck
git add src/lib/ghlImport/plan.ts src/lib/ghlImport/types.ts src/lib/ghlImport/plan.test.ts
git commit -m "feat(ghl-import): the dry run, person by person, from the files and the business

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The import: snapshot, apply, store, entry points, scoring

**Files:**
- Create: `app/src/lib/ghlImport/snapshot.ts`, `apply.ts`, `store.ts`, `run.ts`
- Modify: `app/src/lib/leadScoreModel.ts` (`scoreDue`), `app/src/lib/leadScore.ts` (`scoreLeadsIfDue`), `app/src/lib/leadScoreModel.test.ts`
- Test: `app/src/lib/ghlImport/import.e2e.test.ts`, `app/src/lib/ghlImport/medicalNote.guard.test.ts`

**Interfaces:**
- Consumes: Task 4 `placeImportedRun`, `schema.ghlImportPeople`, `schema.leads.doNotContact`; Task 5 `buildPlan`, `joinPeople`, `dryRunRows`, `ImportPlan`, `PersonPlan`, `Snapshot`; Task 1 parsers; `ensureLeadContact(conn, lead)` and `stopFlows` (leadFlows); `suppress(tenantId, email, "manual")` (`lib/marketing/suppress.ts`); `cancelForLead(conn, leadId, reason)` (`lib/voice/queue.ts`); `getFlowDefinition`, `listAssignableStaff`, `getLeadFlowSettings`; `defaultPipelineId`, `listStages`; `logActivity`; `runWithTenant`, `getTenantDbById`; `flowNow`, `todayIn`, `addDays`.
- Produces (used by Tasks 7, 8):
  - `loadSnapshot(tenantId: number): Snapshot`
  - `applyPlan(plan: ImportPlan, ctx: { tenantId: number; now: number }): ApplyResult`, `ensureHoldingColumn(pipelineId: number): number`
  - `getImportedPerson(by: { leadId: number } | { clientId: number }): ImportedPersonView | null`, `forgetImportedPerson(by: { leadId?: number; clientId?: number }): void`, `allowContactAgain(leadId: number): boolean`
  - `dryRunGhlImport(tenantId: number, input: GhlImportInput): DryRunResponse`, `runGhlImport(tenantId: number, input: GhlImportInput): ImportResponse`, `interface GhlImportInput { contactsText: string; opportunitiesText: string | null; exportDay: string; assignees?: Record<string, number | null> }`, `checkExportDay(day: string, now: number): string | null`, `MAX_PEOPLE = 20000`

- [ ] **Step 1: Scoring skips untouched imported leads (test first)**

In `app/src/lib/leadScoreModel.test.ts`, before the final log line, add:

```ts
check("an imported lead with no messages yet: not due", !scoreDue({ ...base, scoredAt: null, importedUntouched: true }, now));
check("an imported lead once it has messages: due as usual", scoreDue({ ...base, scoredAt: null, importedUntouched: false }, now));
```

(`base` and `check` already exist in that file; read it first and match their names.) Run `npm test -- src/lib/leadScoreModel.test.ts` -> FAIL (type error / wrong result).

In `app/src/lib/leadScoreModel.ts`, change `scoreDue`:

```ts
/**
 * `importedUntouched`: a lead brought in by the GoHighLevel import that has
 * no message on file yet. The import must not set off thousands of Jev
 * calls; such a lead is scored once something happens with it.
 */
export function scoreDue(l: { scoredAt: number | null; lastActivity: number; stageRole: string | null; isClient: boolean; importedUntouched?: boolean }, now: number): boolean {
  if (l.importedUntouched) return false;
  if (l.isClient || (l.stageRole && DONE_ROLES.has(l.stageRole))) return false;
  if (l.scoredAt === null) return true;
  return l.lastActivity > l.scoredAt || now - l.scoredAt > 24 * 3_600_000;
}
```

In `app/src/lib/leadScore.ts`, `scoreLeadsIfDue`: add `source: leads.source` to the `select({...})`, and pass `importedUntouched: r.source === GHL_LEAD_SOURCE && !r.lastMsgAt` in the `scoreDue({...})` call; import `GHL_LEAD_SOURCE` from `@/lib/ghlImport/mapping`. Run the test -> PASS.

- [ ] **Step 2: Write the failing guard test for the medical note**

Create `app/src/lib/ghlImport/medicalNote.guard.test.ts`:

```ts
// Run: npm test -- src/lib/ghlImport/medicalNote.guard.test.ts
//
// The staff-only medical note from a GoHighLevel import may only be touched
// by the files that store it and the lead and client pages that show it.
// Any other file naming it (an AI tool, the inbox triage, a message, an
// export) fails this test, so a new reader has to be a deliberate change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "src");
const PATTERN = /staffMedicalNote|staff_medical_note|medicalCondition/;
const ALLOWED = new Set(
  [
    "lib/db/schema.ts",
    "lib/db/tenant.ts",
    "lib/ghlImport/csv.ts",
    "lib/ghlImport/plan.ts",
    "lib/ghlImport/apply.ts",
    "lib/ghlImport/store.ts",
    "lib/ghlImport/types.ts",
    "components/people/GhlImportCard.tsx",
  ].map((p) => path.join(SRC, p)),
);
const NEVER = ["lib/ai/", "lib/agents/", "lib/inbox/", "lib/adonisMap/", "lib/leadFlows/", "lib/marketing/", "lib/email", "lib/assistant/", "app/api/agents/"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders = walk(SRC).filter((f) => !ALLOWED.has(f) && PATTERN.test(fs.readFileSync(f, "utf8")));
assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), [], "only the import's own files and the staff card may touch the medical note");
for (const f of ALLOWED) {
  const rel = path.relative(SRC, f);
  assert.ok(!NEVER.some((p) => rel.startsWith(p)), `${rel} is in a folder the medical note must never reach`);
}
console.log("medical note guard: 2 checks passed.");
```

- [ ] **Step 3: Write the failing end-to-end import test**

Create `app/src/lib/ghlImport/import.e2e.test.ts`:

```ts
// Run: npm test -- src/lib/ghlImport/import.e2e.test.ts
//
// A small made-up GoHighLevel export imported twice into a scratch business
// set up like Optimal Health, with a fake sender and a fixed clock. Checks
// where people land, the runs and their steps, held rows for a flow that is
// off, do not contact, that nothing is sent and no alert, notification or
// Meta event fires, that a second run changes nothing, and that the medical
// note reaches no AI tool, message or dry run.
import "../leadFlows/testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("../leadFlows/testing/harness") as typeof import("../leadFlows/testing/harness");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq, sql } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { saveLeadFlowSettings } = requireLocal("../leadFlows/settings") as typeof import("../leadFlows/settings");
  const { saveTrigger, setTriggerEnabled } = requireLocal("../automations") as typeof import("../automations");
  const { FLOW_PRESETS } = requireLocal("../leadFlows/presets") as typeof import("../leadFlows/presets");
  const runs = requireLocal("../leadFlows/runs") as typeof import("../leadFlows/runs");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const { getLeadHealthTool } = requireLocal("../agents/tools.sales") as typeof import("../agents/tools.sales");
  const ghl = requireLocal("./run") as typeof import("./run");
  const store = requireLocal("./store") as typeof import("./store");
  const { GHL_CONSENT_SOURCE } = requireLocal("./mapping") as typeof import("./mapping");

  const s = h.makeScratchTenant("ghl-import-e2e-test");
  const fake = h.installFakeTransport();
  const staffEmail = "ghl-e2e-staff@example.com";
  const dropStaff = () => {
    const u = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").get(staffEmail) as { id: number } | undefined;
    if (u) {
      controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ?").run(u.id);
      controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    }
  };
  dropStaff();
  const staffId = (controlSqlite.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, 'Sandra Example', 'x') RETURNING id").get(staffEmail) as { id: number }).id;
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'staff')").run(staffId, s.tid);

  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };
  const MED = "FAKE-MEDICAL-E2E-SENTINEL";

  const CONTACT_HEAD = "Contact Id,First Name,Last Name,Phone,Email,Business Name,Created,Last Activity,Tags,DND,Date of Birth,Source,utm Campaign ,Treatment interested in,Location,Medical Condition,Used treatments before?";
  const c = (id: string, first: string, phone: string, email: string, extra: { tags?: string; dnd?: string; treatment?: string } = {}) =>
    `${id},${first},Example,${phone},${email},,2029-10-01T10:00:00+01:00,,"${extra.tags ?? ""}",${extra.dnd ?? ""},,Facebook,,${extra.treatment ?? ""},Clonmel,${MED} ${first},no`;
  const CONTACTS = [
    CONTACT_HEAD,
    c("g-aoife", "Aoife", "+353870000101", "aoife@example.com", { treatment: "Infrared Therapy" }),
    c("g-brian", "Brian", "+353870000102", "brian@example.com"),
    c("g-ciara", "Ciara", "+353870000103", "ciara@example.com"),
    c("g-declan", "Declan", "+353870000104", "declan@example.com"),
    c("g-eimear", "Eimear", "+353870000105", "eimear@example.com"),
    c("g-fiona", "Fiona", "+353870000106", "fiona@example.com", { dnd: "true" }),
    c("g-gavin", "Gavin", "+353870000107", "gavin@example.com", { tags: "member" }),
    c("g-hannah", "Hannah", "", "hannah@example.com"),
    c("g-ivan", "Ivan", "+353870000109", "ivan@example.com"),
    c("g-joan", "Joan", "+353870000110", "joan@example.com"),
    c("g-kevin", "Kevin", "+353870000111", "kevin@example.com"),
    c("g-laura", "Laura", "+353870000112", "laura@example.com"),
    c("g-mary", "Mary", "", "hannah@example.com"),
  ].join("\n");
  const OPP_HEAD = "Opportunity name,Contact Name,phone,email,pipeline,stage,Lead Value,source,assigned,Created on,Updated on,lost reason ID,lost reason name,Followers,Notes,tags,Engagement score,status,Opportunity ID,Contact ID,Pipeline Stage ID,Pipeline ID,Days since last stage change ,Days since last status change ,Days since last update ";
  const o = (contactId: string, stage: string, days: string) =>
    `X,X Example,,,Main Leads,${stage},0,Facebook,Sandra Example,2029-10-01T09:00:00.000Z,2029-12-01T09:00:00.000Z,,,,Rang once,,0,open,o-${contactId},${contactId},s,p,${days},${days},${days}`;
  const OPPS = [
    OPP_HEAD,
    o("g-aoife", "Long Term Nurture", "10 Days"),
    o("g-brian", "Call Back Later", "3 Days"),
    o("g-ciara", "Thinking About It", "40 Days"),
    o("g-declan", "Won", "100 Days"),
    o("g-eimear", "Lost", "20 Days"),
    o("g-fiona", "Long Term Nurture", "5 Days"),
    o("g-ivan", "Call Back Later", "20 Days"),
    o("g-joan", "Long Term Nurture", "30 Days"),
    o("g-kevin", "Holding", "10 Days"),
    o("g-laura", "Message Undelivered", "20 Days"),
  ].join("\n");

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const DAY = 86_400_000;
      const NOW = Date.parse("2030-01-16T10:00:00Z"); // a Wednesday
      const clock = h.fakeClock(NOW);
      saveLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: "+353870000099" });
      // Optimal Health's copy, saved the way the editor saves it; Call back later is off.
      for (const key of ["new_lead", "lead_no_answer", "lead_call_back", "lead_thinking", "lead_nurture"]) {
        saveTrigger({ key, enabled: key !== "lead_call_back", externalEnabled: false, messages: FLOW_PRESETS["optimal-health"][key] });
      }
      const col = (k: string) => listStages().find((x) => x.systemKey === k)!.id;

      // Already in Adonis: Ivan (old move, by phone in national format), Joan (in a flow, phone only).
      const ivanId = tdb.insert(schema.leads).values({ source: "manual", firstName: "Ivan", phone: "087 000 0109", stageId: listStages()[0].id, createdAt: new Date("2029-06-01T00:00:00Z") }).returning({ id: schema.leads.id }).get().id;
      const joanId = tdb.insert(schema.leads).values({ source: "manual", firstName: "Joan", phone: "+353870000110", stageId: listStages()[0].id }).returning({ id: schema.leads.id }).get().id;
      ok(runs.startFlow(joanId, "lead_no_answer").runId != null, "Joan is in an Adonis flow");
      const queueBefore = tdb.select().from(schema.automationQueue).all().length;

      const input = { contactsText: CONTACTS, opportunitiesText: OPPS, exportDay: "2030-01-16" };

      // The dry run writes nothing and carries no medical note.
      const dry = ghl.dryRunGhlImport(s.tid, input);
      assert.ok(dry.ok);
      n++;
      ok(!JSON.stringify(dry).includes(MED), "the dry run carries no medical note");
      ok(tdb.select().from(schema.ghlImportPeople).all().length === 0 && tdb.select().from(schema.automationQueue).all().length === queueBefore, "the dry run writes nothing");

      // The import.
      const first = ghl.runGhlImport(s.tid, input);
      assert.ok(first.ok);
      n++;
      if (!first.ok) return;
      const r = first.result;
      ok(r.failed === 0 && r.errors.length === 0, "no failures");
      ok(r.leadsCreated === 8, "Aoife, Brian, Ciara, Declan, Eimear, Fiona, Kevin and Laura are new leads");
      ok(r.leadsUpdated === 2, "Ivan moved, Joan filled");
      ok(r.clientsCreated === 2 && r.contactsAdded === 1 && r.doNotContact === 1 && r.skipped === 1, "two clients, one contact, one do not contact, Mary skipped");
      ok(r.runsPlaced === 4 && r.runsWaiting === 1 && r.holdingCreated, "four runs (one waiting) and the Holding column");

      const lead = (contactId: string) => tdb.select().from(schema.leads).where(eq(schema.leads.sourceLeadId, contactId)).get()!;
      const queued = (leadId: number) => tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, leadId)).all();

      // Aoife: nurture, week 3 infrared WhatsApp first, on Monday 21 January at 09:00 (the 20th is a Sunday).
      const aoife = lead("g-aoife");
      ok(aoife.source === "gohighlevel" && aoife.stageId === col("nurture") && aoife.assignedUserId === staffId, "Aoife: nurture, assigned to Sandra");
      ok(aoife.marketingConsentSource === GHL_CONSENT_SOURCE && aoife.marketingConsentAt === NOW, "consent carried over, with the operator's decision as the source");
      ok(aoife.createdAt.getTime() === Date.parse("2029-10-01T10:00:00+01:00"), "created date from GoHighLevel");
      const aMsgs = queued(aoife.id).filter((x) => x.kind === "message").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(aMsgs.length === 5 && aMsgs[0].dueAt.getTime() === Date.parse("2030-01-21T09:00:00Z") && aMsgs[0].channel === "whatsapp" && /infrared/i.test(aMsgs[0].body), "week 3 infrared WhatsApp first, Monday 09:00");
      const ev = tdb.select().from(schema.leadStageEvents).where(eq(schema.leadStageEvents.leadId, aoife.id)).all();
      ok(ev.length === 1 && ev[0].at.getTime() === Date.parse("2030-01-06T09:00:00Z"), "the stage event is dated when she entered the stage in GoHighLevel");
      ok(!!tdb.select().from(schema.contacts).where(sql`lower(${schema.contacts.email}) = 'aoife@example.com'`).get(), "she is on the marketing contacts");

      // Brian: Call back later is off: his rows are held.
      const brian = lead("g-brian");
      ok(brian.stageId === col("call_back") && queued(brian.id).length === 2 && queued(brian.id).every((x) => x.status === "held"), "Brian: held until Call back later is switched on");

      // Ciara: stale, nurture from week 1 now; one message today.
      const ciara = lead("g-ciara");
      const cMsgs = queued(ciara.id).filter((x) => x.kind === "message");
      ok(ciara.stageId === col("nurture") && cMsgs.filter((x) => x.dueAt.getTime() < NOW + DAY).length === 1, "Ciara: nurture week 1, one message today");

      // Declan: won, a client; Eimear: lost; Fiona: do not contact.
      const declan = lead("g-declan");
      ok(declan.clientId != null && declan.pipelineStage === "sale" && queued(declan.id).length === 0, "Declan: a client and a sale, no flow");
      const eimear = lead("g-eimear");
      ok(eimear.status === "lost" && eimear.marketingConsentAt == null && queued(eimear.id).length === 0, "Eimear: lost, no consent, nothing queued");
      const fiona = lead("g-fiona");
      ok(fiona.doNotContact && fiona.doNotCall && fiona.marketingConsentAt == null && queued(fiona.id).length === 0, "Fiona: do not contact");
      ok(tdb.select().from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = 'fiona@example.com'`).get()?.reason === "manual", "Fiona is on the do-not-email list");

      // Gavin: a client only. Hannah: a contact only. Mary: Hannah's twin, skipped.
      ok(tdb.select().from(schema.clients).where(eq(schema.clients.email, "gavin@example.com")).all().length === 1 && !tdb.select().from(schema.leads).where(eq(schema.leads.sourceLeadId, "g-gavin")).get(), "Gavin: client, not a lead");
      const hannahContact = tdb.select().from(schema.contacts).where(eq(schema.contacts.email, "hannah@example.com")).get();
      ok(hannahContact?.status === "subscribed" && (hannahContact.tags ?? "").includes("gohighlevel"), "Hannah: an email contact");

      // Ivan: matched, moved to nurture; Joan: still in her own flow, email filled.
      const ivan = tdb.select().from(schema.leads).where(eq(schema.leads.id, ivanId)).get()!;
      ok(ivan.stageId === col("nurture") && ivan.source === "manual" && queued(ivanId).some((x) => x.kind === "message"), "Ivan: moved to nurture, keeps his own source");
      const joan = tdb.select().from(schema.leads).where(eq(schema.leads.id, joanId)).get()!;
      ok(joan.email === "joan@example.com" && runs.activeRun(joanId, "lead_no_answer") != null, "Joan: email filled, her flow untouched");

      // Kevin: the new Holding column. Laura: Message undelivered, no flow there.
      const holding = listStages().find((x) => x.name === "Holding");
      ok(!!holding && lead("g-kevin").stageId === holding.id && holding.role == null, "Kevin: Holding");
      ok(lead("g-laura").stageId === col("undelivered") && queued(lead("g-laura").id).length === 0, "Laura: Message undelivered, no flow");

      // Nothing was sent, and nothing told anyone.
      ok(fake.sent.length === 0, "nothing sent");
      ok(tdb.select().from(schema.notifications).all().length === 0, "no notifications");
      ok(tdb.select().from(schema.automationQueue).all().every((x) => x.triggerKey !== "alert" && x.kind !== "staff_alert"), "no staff alerts queued");
      ok((controlSqlite.prepare("SELECT count(*) AS n FROM capi_events WHERE tenant_id = ?").get(s.tid) as { n: number }).n === 0, "no Meta events");
      ok(tdb.select().from(schema.automationLog).all().length === 0, "nothing in the Sent log");

      // The medical note: on the import record, nowhere else.
      ok(store.getImportedPerson({ leadId: aoife.id })?.staffMedicalNote === `${MED} Aoife`, "the staff can see it on the lead");
      ok(store.getImportedPerson({ clientId: tdb.select().from(schema.clients).where(eq(schema.clients.email, "gavin@example.com")).get()!.id })?.staffMedicalNote === `${MED} Gavin`, "and on the client");
      const everything = JSON.stringify([
        tdb.select().from(schema.leads).all(),
        tdb.select().from(schema.clients).all(),
        tdb.select().from(schema.automationQueue).all(),
        tdb.select().from(schema.contacts).all(),
      ]);
      ok(!everything.includes(MED), "not in any lead, client, message or contact");
      const tool = getLeadHealthTool({ tenantId: s.tid }, { leadId: aoife.id });
      ok(!tool.text.includes(MED), "not in what Adonis reads about the lead");
      ok(!tdb.select().from(schema.ghlImportPeople).where(eq(schema.ghlImportPeople.ghlContactId, "g-hannah")).get()!.staffMedicalNote, "not kept for a contact-only person");

      // A second run of the same files changes nothing.
      const counts = () => ({
        leads: tdb.select().from(schema.leads).all().length,
        clients: tdb.select().from(schema.clients).all().length,
        contacts: tdb.select().from(schema.contacts).all().length,
        queue: tdb.select().from(schema.automationQueue).all().length,
        runs: tdb.select().from(schema.leadFlowRuns).all().length,
        events: tdb.select().from(schema.leadStageEvents).all().length,
        stages: listStages().length,
      });
      const before = counts();
      const second = ghl.runGhlImport(s.tid, input);
      ok(second.ok && second.result.alreadyImported === 13 && second.result.leadsCreated === 0, "second run: everyone already imported");
      assert.deepEqual(counts(), before);
      n++;

      // Call back later switched on two days later: Brian's passed WhatsApp is skipped, the move still comes.
      clock.set(NOW + 2 * DAY);
      setTriggerEnabled("lead_call_back", true);
      const b = queued(brian.id);
      ok(b.find((x) => x.kind === "message")!.status === "cancelled" && b.find((x) => x.kind === "move")!.status === "queued", "switched on: the passed step skipped, the move kept");

      // Forgetting a deleted person keeps the id (no re-import), drops the note.
      store.forgetImportedPerson({ leadId: aoife.id });
      const forgotten = tdb.select().from(schema.ghlImportPeople).where(eq(schema.ghlImportPeople.ghlContactId, "g-aoife")).get()!;
      ok(forgotten.staffMedicalNote === null && forgotten.leadId === null && forgotten.tags === null, "forgotten: personal fields cleared, id kept");

      // Allow contact again clears only the do-not-contact flag.
      ok(store.allowContactAgain(fiona.id) && !tdb.select().from(schema.leads).where(eq(schema.leads.id, fiona.id)).get()!.doNotContact, "a person can allow contact again");
    });
    console.log(`ghl import e2e: ${n} checks passed.`);
  } finally {
    fake.restore();
    dropStaff();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Notes for the implementer:
- `getLeadHealthTool` is synchronous in `lib/agents/tools.sales.ts` (returns `ToolResult` with `text`). If its name differs, use the read-only lead tool that returns a lead's notes (search `export function get.*Tool` in that file).
- If `capi_events` has no `tenant_id` column, count rows with `event_key LIKE 'crm-<tid>-%'` instead.

Run: `npm test -- src/lib/ghlImport/import.e2e.test.ts` -> FAIL (`Cannot find module './run'`). Run the guard test -> it passes now (nothing names the note yet) and must keep passing.

- [ ] **Step 4: Write `snapshot.ts`**

```ts
import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { listAssignableStaff } from "@/lib/leadFlows/assignment";
import { getFlowDefinition } from "@/lib/leadFlows/definitions";
import { CALL_BOOKED_FLOW, LEAD_FLOW_KEYS } from "@/lib/leadFlows/flowModel";
import { getLeadFlowSettings } from "@/lib/leadFlows/settings";
import { defaultPipelineId } from "@/lib/pipeline/pipelineRepo";
import { listStages } from "@/lib/pipeline/stageRepo";

import type { Snapshot } from "./plan";

/** This business, as the GoHighLevel planner needs it. Ambient tenant. Reads only. */
export function loadSnapshot(tenantId: number): Snapshot {
  const pipelineId = defaultPipelineId();
  const lastStage = new Map<number, number>();
  for (const r of db
    .select({ leadId: schema.leadStageEvents.leadId, at: sql<number>`max(${schema.leadStageEvents.at})` })
    .from(schema.leadStageEvents)
    .groupBy(schema.leadStageEvents.leadId)
    .all()) {
    lastStage.set(r.leadId, Number(r.at));
  }
  const inFlow = new Set(
    db.select({ leadId: schema.leadFlowRuns.leadId }).from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.status, "active")).all().map((r) => r.leadId),
  );
  const lower = (s: string | null) => (s ?? "").trim().toLowerCase() || null;
  const settings = getLeadFlowSettings();
  return {
    pipelineId,
    importedContactIds: new Set(db.select({ id: schema.ghlImportPeople.ghlContactId }).from(schema.ghlImportPeople).all().map((r) => r.id)),
    leads: db
      .select({
        id: schema.leads.id,
        email: schema.leads.email,
        phone: schema.leads.phone,
        clientId: schema.leads.clientId,
        pipelineId: schema.leads.pipelineId,
        therapyInterest: schema.leads.therapyInterest,
        marketingConsentAt: schema.leads.marketingConsentAt,
        createdAt: schema.leads.createdAt,
      })
      .from(schema.leads)
      .all()
      .map((l) => ({ ...l, email: lower(l.email), lastStageAt: lastStage.get(l.id) ?? l.createdAt.getTime(), inActiveFlow: inFlow.has(l.id) })),
    clients: db
      .select({ id: schema.clients.id, email: schema.clients.email, phone: schema.clients.phone })
      .from(schema.clients)
      .all()
      .map((c) => ({ ...c, email: lower(c.email) })),
    contactEmails: new Set(db.select({ email: schema.contacts.email }).from(schema.contacts).all().map((r) => r.email.trim().toLowerCase())),
    suppressedEmails: new Set(db.select({ email: schema.suppressions.email }).from(schema.suppressions).all().map((r) => r.email.trim().toLowerCase())),
    columns: listStages(pipelineId).map((s) => ({ id: s.id, name: s.name, role: s.role, systemKey: s.systemKey ?? null, position: s.position })),
    flows: LEAD_FLOW_KEYS.filter((k) => k !== CALL_BOOKED_FLOW).map((k) => {
      const d = getFlowDefinition(k);
      return {
        key: d.key,
        label: d.label,
        enabled: d.enabled,
        messages: d.messages.map((m) => ({ channel: m.channel, delayMs: m.delayMs, matchInterest: m.matchInterest })),
        startColumn: d.startColumn,
        finish: d.finish,
      };
    }),
    staff: listAssignableStaff(tenantId).map((s) => ({ userId: s.userId, name: s.name })),
    defaultAssigneeUserId: settings.defaultAssigneeUserId,
    window: settings.window,
  };
}
```

- [ ] **Step 5: Write `apply.ts`**

```ts
import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getTenantDbById } from "@/lib/db/tenant";
import { ensureLeadContact } from "@/lib/leadFlows/consent";
import { placeImportedRun } from "@/lib/leadFlows/importedRuns";
import { stopFlows } from "@/lib/leadFlows/runs";
import { suppress } from "@/lib/marketing/suppress";
import { defaultPipelineId } from "@/lib/pipeline/pipelineRepo";
import { OUT_OF_BAND, ROLE_TO_LEGACY_KEY, type StageRecord } from "@/lib/pipeline/roles";
import { listStages } from "@/lib/pipeline/stageRepo";
import { logActivity } from "@/lib/queries";
import { cancelForLead } from "@/lib/voice/queue";

import { GHL_CONSENT_SOURCE, GHL_LEAD_SOURCE } from "./mapping";
import type { ImportPerson, ImportPlan, LeadAction, PersonPlan } from "./plan";
import type { ApplyResult } from "./types";

/**
 * Carry out a GoHighLevel plan (plan.ts). Ambient tenant.
 *
 * Every write is direct, on purpose: none of the lead helpers that alert
 * staff, enrol sequences, queue calls, score, or tell Meta is called
 * (upsertLead, writeStageId, startFlow, setLeadMarketingConsent). One
 * transaction per person; the import record goes in first, so a contact id
 * already there (another import, a double click) changes nothing.
 */

export const DNC_STATEMENT = "Do not contact: carried over from GoHighLevel.";
type Delta = Partial<Record<Exclude<keyof ApplyResult, "holdingCreated" | "errors">, number>>;

/** The board's Holding column, created before Lapsed and Lost when missing. */
export function ensureHoldingColumn(pipelineId: number): number {
  const stages = listStages(pipelineId);
  const found = stages.find((s) => s.role == null && s.systemKey == null && s.name.trim().toLowerCase() === "holding");
  if (found) return found.id;
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  let at = ordered.findIndex((s) => s.role != null && OUT_OF_BAND.has(s.role));
  if (at < 0) at = ordered.length;
  return db.transaction((tx) => {
    ordered.forEach((s, i) => {
      const position = i < at ? i : i + 1;
      if (s.position !== position) tx.update(schema.pipelineStages).set({ position }).where(eq(schema.pipelineStages.id, s.id)).run();
    });
    return tx
      .insert(schema.pipelineStages)
      .values({ pipelineId, name: "Holding", colour: "#8b949e", position: at, role: null })
      .returning({ id: schema.pipelineStages.id })
      .get().id;
  });
}

const empty = (v: string | null | undefined) => !v || !v.trim();

function insertClient(p: ImportPerson, now: number): number {
  return db
    .insert(schema.clients)
    .values({
      firstName: p.firstName ?? p.lastName ?? "Unknown",
      lastName: p.firstName ? (p.lastName ?? "") : "",
      email: p.email,
      phone: p.phone ?? "",
      createdAt: new Date(p.createdAt ?? now),
      updatedAt: new Date(now),
    })
    .returning({ id: schema.clients.id })
    .get().id;
}

function fillClient(clientId: number, p: ImportPerson): void {
  const cur = db.select({ email: schema.clients.email, phone: schema.clients.phone }).from(schema.clients).where(eq(schema.clients.id, clientId)).get();
  if (!cur) return;
  const set: { email?: string; phone?: string } = {};
  if (empty(cur.email) && p.email) set.email = p.email;
  if (empty(cur.phone) && p.phone) set.phone = p.phone;
  if (Object.keys(set).length) db.update(schema.clients).set(set).where(eq(schema.clients.id, clientId)).run();
}

/** Empty fields only. Never bumps updated_at (that would set off a rescore). */
function fillLead(leadId: number, p: ImportPerson, assignee: number | null, clientId: number | null): void {
  const cur = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!cur) return;
  const set: Partial<typeof schema.leads.$inferInsert> = {};
  if (empty(cur.firstName) && empty(cur.lastName) && p.firstName) {
    set.firstName = p.firstName;
    if (p.lastName) set.lastName = p.lastName;
  }
  if (empty(cur.email) && p.email) set.email = p.email;
  if (empty(cur.phone) && p.phone) set.phone = p.phone;
  if (empty(cur.therapyInterest) && p.treatment) set.therapyInterest = p.treatment;
  if (empty(cur.notes) && p.notes) set.notes = p.notes;
  if (cur.assignedUserId == null && assignee != null) set.assignedUserId = assignee;
  if (cur.clientId == null && clientId != null) set.clientId = clientId;
  if (Object.keys(set).length) db.update(schema.leads).set(set).where(eq(schema.leads.id, leadId)).run();
}

function placeLead(p: ImportPerson, a: Extract<LeadAction, { mode: "place" }>, stage: StageRecord, clientId: number | null, pipelineId: number, now: number): number {
  const legacy = stage.role ? (ROLE_TO_LEGACY_KEY[stage.role] as typeof schema.leads.$inferInsert.pipelineStage) : undefined;
  let leadId: number;
  let fromStageId: number | null = null;
  if (a.existingId != null) {
    leadId = a.existingId;
    fromStageId = db.select({ stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get()?.stageId ?? null;
    fillLead(leadId, p, a.assigneeUserId, clientId);
    db.update(schema.leads)
      .set({ stageId: stage.id, ...(legacy ? { pipelineStage: legacy } : {}), ...(a.lost ? { status: "lost" as const } : {}) })
      .where(eq(schema.leads.id, leadId))
      .run();
  } else {
    leadId = db
      .insert(schema.leads)
      .values({
        source: GHL_LEAD_SOURCE,
        sourceLeadId: p.ghlContactId,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        phone: p.phone,
        therapyInterest: p.treatment,
        notes: p.notes,
        assignedUserId: a.assigneeUserId,
        pipelineId,
        stageId: stage.id,
        ...(legacy ? { pipelineStage: legacy } : {}),
        status: a.lost ? "lost" : "new",
        clientId,
        createdAt: new Date(p.createdAt ?? now),
        updatedAt: new Date(now),
      })
      .returning({ id: schema.leads.id })
      .get().id;
  }
  if (fromStageId !== stage.id) {
    db.insert(schema.leadStageEvents).values({ leadId, pipelineId, fromStageId, toStageId: stage.id, actor: "system", at: new Date(a.enteredAt) }).run();
  }
  if (a.consent) {
    db.update(schema.leads).set({ marketingConsentAt: now, marketingConsentSource: GHL_CONSENT_SOURCE }).where(eq(schema.leads.id, leadId)).run();
    if (p.email) ensureLeadContact(db, { email: p.email, firstName: p.firstName, lastName: p.lastName, phone: p.phone });
  }
  return leadId;
}

function markDoNotContact(tenantId: number, p: ImportPerson, leadId: number | null, clientId: number | null, now: number): void {
  if (leadId != null) {
    db.update(schema.leads).set({ doNotContact: true, doNotCall: true, marketingConsentAt: null, marketingConsentSource: null }).where(eq(schema.leads.id, leadId)).run();
    stopFlows(leadId, "do not contact (GoHighLevel)", "all");
    cancelForLead(getTenantDbById(tenantId), leadId, "Do not contact (GoHighLevel)");
  }
  if (clientId != null) {
    for (const channel of ["email", "sms"] as const) {
      db.insert(schema.clientConsents).values({ clientId, channel, granted: false, statement: DNC_STATEMENT, source: "staff", at: now }).run();
    }
  }
  if (p.email) suppress(tenantId, p.email, "manual");
}

function addContact(p: ImportPerson, now: number): number | null {
  if (!p.email) return null;
  const found = db.select({ id: schema.contacts.id }).from(schema.contacts).where(sql`lower(${schema.contacts.email}) = ${p.email}`).get();
  if (found) return null;
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null;
  return db
    .insert(schema.contacts)
    .values({ email: p.email, name, phone: p.phone, tags: JSON.stringify(["gohighlevel"]), status: "subscribed", source: GHL_LEAD_SOURCE, subscribedAt: new Date(now) })
    .returning({ id: schema.contacts.id })
    .get().id;
}

function applyPerson(plan: PersonPlan, ctx: { tenantId: number; now: number }, pipelineId: number, stages: Map<number, StageRecord>, holdingId: number | null): Delta {
  const p = plan.person;
  const d: Delta = {};
  const inserted = db
    .insert(schema.ghlImportPeople)
    .values({
      ghlContactId: p.ghlContactId,
      ghlOpportunityId: p.ghlOpportunityId,
      outcome: plan.outcome,
      ghlStage: p.ghlStage,
      daysInStage: p.daysInStage,
      ghlSource: p.ghlSource,
      tags: JSON.stringify(p.tags),
      treatment: p.treatment,
      usedBefore: p.usedBefore,
      town: p.town,
      doNotContact: plan.doNotContact,
      importedAt: new Date(ctx.now),
    })
    .onConflictDoNothing()
    .run();
  if (inserted.changes === 0) return { alreadyImported: 1 };
  if (plan.outcome === "skip") return { skipped: 1 };

  let clientId: number | null = plan.match?.kind === "client" ? plan.match.id : null;
  if (plan.client) {
    if (plan.client.existingId != null) {
      clientId = plan.client.existingId;
      fillClient(clientId, p);
      d.clientsLinked = 1;
    } else {
      clientId = insertClient(p, ctx.now);
      d.clientsCreated = 1;
    }
  }

  let leadId: number | null = plan.match?.kind === "lead" ? plan.match.id : null;
  if (plan.lead?.mode === "fill") {
    leadId = plan.lead.existingId;
    fillLead(leadId, p, plan.lead.assigneeUserId, clientId);
    d.leadsUpdated = 1;
  } else if (plan.lead?.mode === "place") {
    const stage = stages.get(plan.lead.columnId ?? holdingId ?? -1);
    if (!stage) throw new Error("Its column is not on the board.");
    leadId = placeLead(p, plan.lead, stage, clientId, pipelineId, ctx.now);
    if (plan.lead.existingId != null) d.leadsUpdated = 1;
    else d.leadsCreated = 1;
  }

  if (plan.run && leadId != null) {
    const placed = placeImportedRun(
      leadId,
      { triggerKey: plan.run.flowKey, steps: plan.run.steps.map((s) => ({ step: s.step, dueAt: s.dueAt })), finishAt: plan.run.finishAt, emailOnly: plan.run.emailOnly },
      ctx.now,
    );
    if (placed.runId != null) {
      d.runsPlaced = 1;
      d.messagesQueued = placed.queued;
      if (placed.held) d.runsWaiting = 1;
    }
  }
  if (plan.doNotContact) {
    markDoNotContact(ctx.tenantId, p, leadId, clientId, ctx.now);
    d.doNotContact = 1;
  }
  const contactId = plan.contact ? addContact(p, ctx.now) : null;
  if (contactId != null) d.contactsAdded = 1;
  if (plan.outcome === "unchanged") d.unchanged = 1;

  // The links, and the staff-only medical note when a lead or client page can show it.
  db.update(schema.ghlImportPeople)
    .set({ leadId, clientId, contactId, staffMedicalNote: leadId != null || clientId != null ? p.staffMedicalNote : null })
    .where(eq(schema.ghlImportPeople.ghlContactId, p.ghlContactId))
    .run();
  return d;
}

export function applyPlan(plan: ImportPlan, ctx: { tenantId: number; now: number }): ApplyResult {
  const r: ApplyResult = {
    leadsCreated: 0,
    leadsUpdated: 0,
    clientsCreated: 0,
    clientsLinked: 0,
    contactsAdded: 0,
    doNotContact: 0,
    runsPlaced: 0,
    runsWaiting: 0,
    messagesQueued: 0,
    unchanged: 0,
    alreadyImported: 0,
    skipped: 0,
    failed: 0,
    holdingCreated: false,
    errors: [],
  };
  const pipelineId = defaultPipelineId();
  let holdingId: number | null = null;
  if (plan.people.some((p) => p.outcome !== "already_imported" && p.lead?.mode === "place" && p.lead.columnId == null)) {
    const before = listStages(pipelineId).length;
    holdingId = ensureHoldingColumn(pipelineId);
    r.holdingCreated = listStages(pipelineId).length > before;
  }
  const stages = new Map(listStages(pipelineId).map((s) => [s.id, s]));
  for (const p of plan.people) {
    if (p.outcome === "already_imported") {
      r.alreadyImported++;
      continue;
    }
    try {
      const d = db.transaction(() => applyPerson(p, ctx, pipelineId, stages, holdingId));
      for (const [k, v] of Object.entries(d) as [keyof Delta, number][]) r[k] += v;
    } catch (err) {
      r.failed++;
      if (r.errors.length < 20) r.errors.push(`GoHighLevel contact ${p.person.ghlContactId}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  void logActivity(
    "import.gohighlevel",
    `GoHighLevel import: ${r.leadsCreated} new leads, ${r.leadsUpdated} updated, ${r.clientsCreated} new clients, ${r.contactsAdded} email contacts`,
    { ...r, errors: undefined },
  );
  return r;
}
```

(Check `cancelForLead`'s exact signature in `app/src/lib/voice/queue.ts` and `clientConsents` column names in schema.ts; adjust the call, not the behaviour.)

- [ ] **Step 6: Write `store.ts`**

```ts
import "server-only";

import { desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import type { ImportedPersonView } from "./types";

/** The GoHighLevel import record for a lead or client, for the staff pages. Ambient tenant. */
export function getImportedPerson(by: { leadId: number } | { clientId: number }): ImportedPersonView | null {
  const t = schema.ghlImportPeople;
  const row = db
    .select()
    .from(t)
    .where("leadId" in by ? eq(t.leadId, by.leadId) : eq(t.clientId, by.clientId))
    .orderBy(desc(t.id))
    .get();
  if (!row) return null;
  let tags: string[] = [];
  try {
    tags = row.tags ? (JSON.parse(row.tags) as string[]) : [];
  } catch {
    tags = [];
  }
  const leadDnc = "leadId" in by ? db.select({ v: schema.leads.doNotContact }).from(schema.leads).where(eq(schema.leads.id, by.leadId)).get()?.v : undefined;
  return {
    ghlStage: row.ghlStage,
    daysInStage: row.daysInStage,
    ghlSource: row.ghlSource,
    tags,
    treatment: row.treatment,
    usedBefore: row.usedBefore,
    town: row.town,
    staffMedicalNote: row.staffMedicalNote,
    doNotContact: leadDnc ?? row.doNotContact,
    importedAt: row.importedAt.getTime(),
  };
}

/**
 * A lead or client was deleted: drop the personal details the import kept
 * (the medical note, tags, custom fields). The GoHighLevel ids stay, so
 * importing the same files again does not bring the person back.
 */
export function forgetImportedPerson(by: { leadId?: number; clientId?: number }): void {
  const t = schema.ghlImportPeople;
  const blank = { staffMedicalNote: null, tags: null, treatment: null, usedBefore: null, town: null, ghlSource: null };
  if (by.leadId != null) db.update(t).set({ ...blank, leadId: null }).where(eq(t.leadId, by.leadId)).run();
  if (by.clientId != null) db.update(t).set({ ...blank, clientId: null }).where(eq(t.clientId, by.clientId)).run();
}

/** A person clears do not contact on the lead page. The do-not-email list and do-not-call are separate and stay. */
export function allowContactAgain(leadId: number): boolean {
  return db.update(schema.leads).set({ doNotContact: false }).where(eq(schema.leads.id, leadId)).run().changes > 0;
}
```

- [ ] **Step 7: Write `run.ts`**

```ts
import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { flowNow } from "@/lib/leadFlows/clock";
import { addDays, todayIn } from "@/lib/leadFlows/sendingWindow";

import { applyPlan } from "./apply";
import { parseGhlContacts, parseGhlOpportunities } from "./csv";
import { buildPlan, dryRunRows, joinPeople, type ImportPlan } from "./plan";
import { loadSnapshot } from "./snapshot";
import type { DryRunResponse, ImportResponse } from "./types";

export const MAX_PEOPLE = 20_000;

export interface GhlImportInput {
  contactsText: string;
  opportunitiesText: string | null;
  /** "YYYY-MM-DD", the day the files were exported. */
  exportDay: string;
  /** GoHighLevel user name -> Adonis user id; null = the default assignee. */
  assignees?: Record<string, number | null>;
}

/** Null when the day is usable, else what to change. */
export function checkExportDay(day: string, now: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) return "Enter the day you exported the files.";
  const today = todayIn(now);
  if (day > today) return "The export date can't be in the future.";
  if (day < addDays(today, -365)) return "The export date is more than a year ago. Export the files again.";
  return null;
}

function prepare(tenantId: number, input: GhlImportInput, now: number): { ok: true; plan: ImportPlan; staff: { userId: number; name: string }[]; defaultAssigneeUserId: number | null } | { ok: false; error: string } {
  const dayError = checkExportDay(input.exportDay, now);
  if (dayError) return { ok: false, error: dayError };
  const contacts = parseGhlContacts(input.contactsText);
  if (!contacts.ok) return contacts;
  const opps = input.opportunitiesText ? parseGhlOpportunities(input.opportunitiesText) : ({ ok: true, rows: [] } as const);
  if (!opps.ok) return opps;
  const people = joinPeople(contacts.rows, opps.rows);
  if (people.length === 0) return { ok: false, error: "There is nobody in these files." };
  if (people.length > MAX_PEOPLE) return { ok: false, error: `These files have more than ${MAX_PEOPLE.toLocaleString("en-IE")} people. Split the export.` };
  const snap = loadSnapshot(tenantId);
  return { ok: true, plan: buildPlan(people, snap, { exportDay: input.exportDay, now, assignees: input.assignees }), staff: snap.staff, defaultAssigneeUserId: snap.defaultAssigneeUserId };
}

/** What would happen. Writes nothing. */
export function dryRunGhlImport(tenantId: number, input: GhlImportInput): DryRunResponse {
  return runWithTenant(tenantId, () => {
    const now = flowNow();
    const prep = prepare(tenantId, input, now);
    if (!prep.ok) return prep;
    const def = prep.staff.find((s) => s.userId === prep.defaultAssigneeUserId) ?? null;
    return {
      ok: true,
      totals: prep.plan.totals,
      rows: dryRunRows(prep.plan),
      assignees: prep.plan.assignees,
      staff: prep.staff,
      defaultAssigneeName: def?.name ?? null,
      exportDay: input.exportDay,
      now,
    };
  });
}

/** The import: the plan is worked out again here, from the files, never taken from the browser. */
export function runGhlImport(tenantId: number, input: GhlImportInput): ImportResponse {
  return runWithTenant(tenantId, () => {
    const now = flowNow();
    const prep = prepare(tenantId, input, now);
    if (!prep.ok) return prep;
    return { ok: true, result: applyPlan(prep.plan, { tenantId, now }) };
  });
}
```

- [ ] **Step 8: Run the tests**

- `npm test -- src/lib/ghlImport/import.e2e.test.ts` -> PASS
- `npm test -- src/lib/ghlImport/medicalNote.guard.test.ts` -> PASS
- `npm test -- src/lib/leadScoreModel.test.ts` -> PASS
- `npm test -- src/lib/ghlImport/plan.test.ts` and the Task 4 tests -> still PASS
- `npm run typecheck` -> clean

- [ ] **Step 9: Commit**

```bash
git add src/lib/ghlImport/snapshot.ts src/lib/ghlImport/apply.ts src/lib/ghlImport/store.ts src/lib/ghlImport/run.ts src/lib/ghlImport/import.e2e.test.ts src/lib/ghlImport/medicalNote.guard.test.ts src/lib/leadScoreModel.ts src/lib/leadScoreModel.test.ts src/lib/leadScore.ts
git commit -m "feat(ghl-import): import people without sending anything, idempotent, medical note staff only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The upload route and the import screen

**Files:**
- Create: `app/src/app/api/import/gohighlevel/route.ts`
- Create: `app/src/app/settings/import/page.tsx`, `app/src/app/settings/import/gohighlevel/page.tsx`
- Create: `app/src/components/settings/ghlImport/GhlImportWizard.tsx`, `views.tsx`, `ghlImport.module.css`
- Modify: `app/src/app/settings/page.tsx` (one row in "Your business")

**Interfaces:**
- Consumes: Task 6 `dryRunGhlImport`, `runGhlImport`, `GhlImportInput`; Task 5 `dryRunCsv`, `DryRunRow`, `PlanTotals`; `types.ts`; `guard` (`lib/api/guard.ts`); `getCurrentTenant` (`lib/db/tenant.ts`); `requireAdminPage`, `getCurrentMembership` (`lib/auth.ts`); `listAssignableStaff`, `getLeadFlowSettings`; UI kit `Button`, `Badge`, `Input`, `Label`, `useConfirm`; `PageHeader`.
- Produces: `POST /api/import/gohighlevel` (multipart: `contacts` File, `opportunities` File optional, `exportDay`, `mode` = `"dry-run" | "import"`, `assignees` JSON) -> `DryRunResponse` or `ImportResponse`; `views.tsx` exports `UploadStep`, `DryRunView`, `ResultView` (props below) so a screenshot route can render them with fake data.

- [ ] **Step 1: The route**

Create `app/src/app/api/import/gohighlevel/route.ts`:

```ts
import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";
import { dryRunGhlImport, runGhlImport } from "@/lib/ghlImport/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Settings > Import > GoHighLevel. A route (not a Server Action) because
 * the exports are bigger than a Server Action body may be. Admin only. The
 * files are read in memory and never stored.
 */
export async function POST(req: Request) {
  const denied = await guard("admin");
  if (denied) return denied;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Upload the files again." }, { status: 400 });
  }
  const contacts = form.get("contacts");
  const opportunities = form.get("opportunities");
  if (!(contacts instanceof File) || contacts.size === 0) return NextResponse.json({ ok: false, error: "Add the contacts export." }, { status: 400 });
  if (contacts.size > MAX_BYTES || (opportunities instanceof File && opportunities.size > MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "A file is over 15 MB. Export fewer columns." }, { status: 400 });
  }
  let assignees: Record<string, number | null> = {};
  try {
    const raw = JSON.parse(String(form.get("assignees") ?? "{}")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) assignees[k] = Number.isInteger(v) ? (v as number) : null;
    }
  } catch {
    assignees = {};
  }
  const input = {
    contactsText: await contacts.text(),
    opportunitiesText: opportunities instanceof File && opportunities.size > 0 ? await opportunities.text() : null,
    exportDay: String(form.get("exportDay") ?? ""),
    assignees,
  };
  const tenantId = getCurrentTenant().id;
  const res = form.get("mode") === "import" ? runGhlImport(tenantId, input) : dryRunGhlImport(tenantId, input);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
```

- [ ] **Step 2: The pages and the settings row**

Create `app/src/app/settings/import/page.tsx`:

```tsx
import Link from "next/link";
import { ChevronRight, FileSpreadsheet, Workflow } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ITEMS = [
  { href: "/settings/import/gohighlevel", icon: Workflow, title: "GoHighLevel", desc: "Your leads, clients and contacts, into the right columns and follow-ups." },
  { href: "/clients/import", icon: FileSpreadsheet, title: "Members from a spreadsheet", desc: "A CSV of members from another system." },
];

export default async function ImportIndexPage() {
  await requireAdminPage();
  return (
    <div className="app-page" style={{ maxWidth: 860 }}>
      <PageHeader eyebrow="Settings" title="Import" subtitle="Bring people in from the system you used before." />
      <ul className="set-list">
        {ITEMS.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="set-row">
              <span className="set-icon" aria-hidden>
                <s.icon size={17} strokeWidth={1.7} />
              </span>
              <span className="set-text">
                <span className="set-title">{s.title}</span>
                <span className="set-desc">{s.desc}</span>
              </span>
              <span className="set-status-none" />
              <ChevronRight size={16} className="set-chev" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `app/src/app/settings/import/gohighlevel/page.tsx`:

```tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { GhlImportWizard } from "@/components/settings/ghlImport/GhlImportWizard";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GhlImportPage() {
  await requireAdminPage();
  return (
    <div className="app-page" style={{ maxWidth: 1100 }}>
      <PageHeader
        eyebrow="Settings"
        title="Import from GoHighLevel"
        subtitle="Upload your exports, check what will happen to each person, then import. The import sends nothing."
      />
      <GhlImportWizard />
    </div>
  );
}
```

In `app/src/app/settings/page.tsx`: add `Upload` to the lucide import list, and add this item at the end of the "Your business" group's `items`:

```ts
        { href: "/settings/import", icon: Upload, title: "Import", desc: "Bring in leads and clients from GoHighLevel or a spreadsheet." },
```

- [ ] **Step 3: The styles**

Create `app/src/components/settings/ghlImport/ghlImport.module.css`:

```css
/* Settings > Import > GoHighLevel. App tokens only, so dark and light both
   follow the admin theme. Controls keep at least 12px of side padding. */

.stack { display: grid; gap: 16px; }
.card { border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-1); padding: 20px; display: grid; gap: 14px; }
.cardTitle { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
.note { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-secondary); }
.files { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.drop { position: relative; display: grid; gap: 6px; padding: 18px; border: 1px dashed var(--hairline-strong); border-radius: 12px; background: var(--surface-2); cursor: pointer; transition: border-color .15s var(--ease); }
.drop:hover, .drop:focus-within { border-color: var(--accent); }
.drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.dropLabel { font-size: 14px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
.dropHint { font-size: 12.5px; color: var(--text-tertiary); overflow-wrap: anywhere; }
.dropChosen { font-size: 13px; color: var(--text-secondary); overflow-wrap: anywhere; }
.dateRow { display: grid; gap: 6px; max-width: 280px; }
.error { margin: 0; padding: 10px 14px; border-radius: 10px; background: var(--danger-soft); color: var(--danger); font-size: 13.5px; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.actionsStart { justify-content: flex-start; }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1px; border: 1px solid var(--hairline); border-radius: 12px; overflow: hidden; background: var(--hairline); }
.tile { background: var(--surface-1); padding: 14px 16px; display: grid; gap: 4px; }
.tileLabel { font-size: 12.5px; color: var(--text-tertiary); }
.tileValue { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: var(--text-primary); font-variant-numeric: tabular-nums; }

.lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.list { list-style: none; margin: 0; padding: 0; display: grid; }
.list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-top: 1px solid var(--hairline); font-size: 13.5px; color: var(--text-secondary); }
.list li:first-child { border-top: 0; }
.list b { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }

.assignee { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 240px); gap: 12px; align-items: center; padding: 8px 0; border-top: 1px solid var(--hairline); font-size: 13.5px; color: var(--text-secondary); }
.assignee:first-of-type { border-top: 0; }
.select { width: 100%; height: 40px; padding: 0 36px 0 12px; border-radius: var(--radius); border: 1px solid var(--hairline); background-color: var(--surface-2); color: var(--text-primary); font-size: 14px; font-family: inherit; }

.searchRow { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.search { position: relative; flex: 1 1 260px; max-width: 420px; }
.search svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); pointer-events: none; }
.search input { padding-left: 38px !important; }
.count { font-size: 13px; color: var(--text-tertiary); }

.tableWrap { border: 1px solid var(--hairline); border-radius: 12px; overflow: hidden; background: var(--surface-1); }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th { text-align: left; font-weight: 600; font-size: 12px; color: var(--text-tertiary); padding: 10px 12px; border-bottom: 1px solid var(--hairline); background: var(--surface-2); }
.table td { padding: 10px 12px; border-top: 1px solid var(--hairline); color: var(--text-secondary); vertical-align: top; }
.table tr:first-child td { border-top: 0; }
.name { color: var(--text-primary); font-weight: 600; }
.sub { display: block; font-size: 12px; color: var(--text-tertiary); overflow-wrap: anywhere; }
.more { display: flex; justify-content: center; padding: 12px; border-top: 1px solid var(--hairline); }

@media (max-width: 640px) {
  .card { padding: 16px; }
  .files { grid-template-columns: minmax(0, 1fr); }
  .assignee { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .dateRow { max-width: none; }
  .actions { justify-content: stretch; }
  .actions > * { flex: 1 1 100%; }
  .table thead { display: none; }
  .table, .table tbody, .table tr, .table td { display: block; width: 100%; }
  .table tr { padding: 12px 14px; border-top: 1px solid var(--hairline); }
  .table tr:first-child { border-top: 0; }
  .table td { border: 0; padding: 2px 0; }
  .table td[data-label]::before { content: attr(data-label) ": "; color: var(--text-tertiary); }
}
```

- [ ] **Step 4: The views**

Create `app/src/components/settings/ghlImport/views.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Download, FileSearch, FileUp, Search, Upload, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { dryRunCsv, type DryRunRow } from "@/lib/ghlImport/plan";
import type { ApplyResult, AssigneeRow, DryRunData } from "@/lib/ghlImport/types";

import styles from "./ghlImport.module.css";

const DUE = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDue = (ms: number) => DUE.format(new Date(ms));
const num = (n: number) => n.toLocaleString("en-IE");
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };
const PAGE = 50;

function FileBox(props: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void; id: string }) {
  return (
    <label className={styles.drop} htmlFor={props.id}>
      <input id={props.id} type="file" accept=".csv,text/csv" onChange={(e) => props.onFile(e.target.files?.[0] ?? null)} />
      <span className={styles.dropLabel}>
        <FileUp size={16} aria-hidden /> {props.label}
      </span>
      {props.file ? (
        <span className={styles.dropChosen}>
          {props.file.name}, {Math.max(1, Math.round(props.file.size / 1024))} KB
        </span>
      ) : (
        <span className={styles.dropHint}>{props.hint}</span>
      )}
    </label>
  );
}

export function UploadStep(props: {
  contacts: File | null;
  opportunities: File | null;
  exportDay: string;
  today: string;
  busy: boolean;
  error: string | null;
  onContacts: (f: File | null) => void;
  onOpportunities: (f: File | null) => void;
  onExportDay: (day: string) => void;
  onCheck: () => void;
}) {
  return (
    <section className={styles.card} aria-labelledby="ghl-upload">
      <h2 className={styles.cardTitle} id="ghl-upload">
        <Upload size={16} aria-hidden /> Upload your exports
      </h2>
      <p className={styles.note}>In GoHighLevel, export Contacts (all columns) and Opportunities as CSV files. The contacts file is needed; the opportunities file says where each lead was.</p>
      <div className={styles.files}>
        <FileBox id="ghl-contacts" label="Contacts export" hint="Required. A .csv file." file={props.contacts} onFile={props.onContacts} />
        <FileBox id="ghl-opportunities" label="Opportunities export" hint="Optional. A .csv file." file={props.opportunities} onFile={props.onOpportunities} />
      </div>
      <div className={styles.dateRow}>
        <Label htmlFor="ghl-export-day">Export date</Label>
        <Input id="ghl-export-day" type="date" value={props.exportDay} max={props.today} onChange={(e) => props.onExportDay(e.target.value)} />
        <p className={styles.note}>The day you downloaded the files. Days in each stage are counted back from it.</p>
      </div>
      {props.error && <p className={styles.error} role="alert">{props.error}</p>}
      <div className={styles.actions}>
        <Button onClick={props.onCheck} loading={props.busy} disabled={!props.contacts || !props.exportDay}>
          <FileSearch size={15} aria-hidden /> Check what will happen
        </Button>
      </div>
      <p className={styles.note}>Nothing is imported or sent until you press Import on the next screen.</p>
    </section>
  );
}

function Tiles({ items }: { items: [string, number][] }) {
  return (
    <div className={styles.tiles}>
      {items.map(([label, value]) => (
        <div className={styles.tile} key={label}>
          <span className={styles.tileLabel}>{label}</span>
          <span className={styles.tileValue}>{num(value)}</span>
        </div>
      ))}
    </div>
  );
}

function Assignees(props: { rows: AssigneeRow[]; staff: DryRunData["staff"]; defaultName: string | null; busy: boolean; onChange: (ghlName: string, userId: number | null) => void }) {
  if (props.rows.length === 0) return null;
  return (
    <section className={styles.card} aria-labelledby="ghl-assignees">
      <h2 className={styles.cardTitle} id="ghl-assignees">
        <UserRound size={16} aria-hidden /> Who their leads go to
      </h2>
      <p className={styles.note}>Each GoHighLevel user, and the person here who takes over their leads.</p>
      <div>
        {props.rows.map((a) => (
          <div className={styles.assignee} key={a.ghlName}>
            <span>
              {a.ghlName} <span className={styles.sub}>{num(a.people)} people</span>
            </span>
            <select
              className={styles.select}
              aria-label={`Leads assigned to ${a.ghlName} in GoHighLevel`}
              value={a.userId == null ? "" : String(a.userId)}
              disabled={props.busy}
              onChange={(e) => props.onChange(a.ghlName, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{props.defaultName ? `The default (${props.defaultName})` : "Nobody"}</option>
              {props.staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}

function matches(r: DryRunRow, q: string): boolean {
  if (!q) return true;
  return [r.name, r.email, r.phone, r.fromStage, r.to, r.flow ?? "", r.note].some((v) => v.toLowerCase().includes(q));
}

export function DryRunView(props: {
  data: DryRunData;
  busy: boolean;
  onAssignee: (ghlName: string, userId: number | null) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const { totals: t, rows } = props.data;
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((r) => matches(r, q)), [rows, q]);
  const toImport = t.people - t.alreadyImported - t.skipped - t.unchanged;

  function download() {
    const blob = new Blob([dryRunCsv(filtered, fmtDue)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gohighlevel-import-${props.data.exportDay}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.stack}>
      <Tiles
        items={[
          ["People in the files", t.people],
          ["On the lead board", t.leads],
          ["Clients", t.clients],
          ["Email contacts only", t.contactsOnly],
          ["Do not contact", t.doNotContact],
          ["Matched to someone here", t.duplicates],
          ["Already imported", t.alreadyImported],
          ["Messages in the next 7 days", t.messagesNext7Days],
        ]}
      />
      <div className={styles.lists}>
        <section className={styles.card} aria-labelledby="ghl-columns">
          <h2 className={styles.cardTitle} id="ghl-columns">Where leads go</h2>
          <ul className={styles.list}>
            {t.columns.map((c) => (
              <li key={c.name}>
                <span>
                  {c.name}
                  {t.newColumns.includes(c.name) && (
                    <>
                      {" "}
                      <Badge tone="info">New column</Badge>
                    </>
                  )}
                </span>
                <b>{num(c.count)}</b>
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.card} aria-labelledby="ghl-flows">
          <h2 className={styles.cardTitle} id="ghl-flows">Follow-ups</h2>
          {t.flows.length === 0 ? (
            <p className={styles.note}>Nobody is placed in a follow-up.</p>
          ) : (
            <ul className={styles.list}>
              {t.flows.map((f) => (
                <li key={f.key}>
                  <span>
                    {f.label}
                    {!f.enabled && (
                      <>
                        {" "}
                        <Badge tone="warning">Off: waits until you switch it on</Badge>
                      </>
                    )}
                  </span>
                  <b>{num(f.people)}</b>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.note}>Steps GoHighLevel already sent are not sent again. A step whose time has passed is skipped, and nobody gets more than one message today.</p>
        </section>
      </div>
      <Assignees rows={props.data.assignees} staff={props.data.staff} defaultName={props.data.defaultAssigneeName} busy={props.busy} onChange={props.onAssignee} />
      <section className={styles.card} aria-labelledby="ghl-people">
        <h2 className={styles.cardTitle} id="ghl-people">Everyone in the files</h2>
        <div className={styles.searchRow}>
          <div className={styles.search}>
            <Search size={15} aria-hidden />
            <Input
              aria-label="Search people"
              placeholder="Search by name, email, phone or stage"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
            />
          </div>
          <span className={styles.count}>{num(filtered.length)} people</span>
          <Button variant="outline" onClick={download}>
            <Download size={15} aria-hidden /> Download the list
          </Button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>From</th>
                <th>Days</th>
                <th>Goes to</th>
                <th>Follow-up</th>
                <th>Next message</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={styles.name}>{r.name}</span>
                    {r.email && <span className={styles.sub}>{r.email}</span>}
                    {r.doNotContact && <Badge tone="danger">Do not contact</Badge>}
                  </td>
                  <td data-label="From">{r.fromStage}</td>
                  <td data-label="Days">{r.days ?? ""}</td>
                  <td data-label="Goes to">{r.to}</td>
                  <td data-label="Follow-up">{r.flow ? `${r.flow}${r.flowOff ? " (off)" : ""}` : "None"}</td>
                  <td data-label="Next message">{r.nextAt != null ? `${CHANNEL[r.nextChannel ?? ""] ?? r.nextChannel}, ${fmtDue(r.nextAt)}` : "None"}</td>
                  <td data-label="Notes">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > shown && (
            <div className={styles.more}>
              <Button variant="secondary" onClick={() => setShown((s) => s + PAGE)}>
                Show {Math.min(PAGE, filtered.length - shown)} more
              </Button>
            </div>
          )}
        </div>
      </section>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={props.onBack} disabled={props.busy}>
          <ArrowLeft size={15} aria-hidden /> Back
        </Button>
        <Button onClick={props.onImport} loading={props.busy} disabled={toImport <= 0}>
          <Upload size={15} aria-hidden /> Import {num(Math.max(0, toImport))} people
        </Button>
      </div>
    </div>
  );
}

export function ResultView({ result, onAgain }: { result: ApplyResult; onAgain: () => void }) {
  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="ghl-done">
        <h2 className={styles.cardTitle} id="ghl-done">
          <CheckCircle2 size={16} aria-hidden /> Imported
        </h2>
        <p className={styles.note}>
          Nothing was sent. Follow-up messages go at their times while each follow-up is switched on.
          {result.runsWaiting > 0 ? ` ${num(result.runsWaiting)} people wait for a follow-up that is off.` : ""}
          {result.holdingCreated ? " A Holding column was added to the board." : ""}
        </p>
      </section>
      <Tiles
        items={[
          ["New leads", result.leadsCreated],
          ["Leads updated", result.leadsUpdated],
          ["New clients", result.clientsCreated],
          ["Email contacts added", result.contactsAdded],
          ["Do not contact", result.doNotContact],
          ["In a follow-up", result.runsPlaced],
          ["Messages scheduled", result.messagesQueued],
          ["Already imported", result.alreadyImported],
        ]}
      />
      {result.failed > 0 && (
        <p className={styles.error} role="alert">
          {num(result.failed)} people could not be imported. Import again to retry them; everyone else stays as they are.
        </p>
      )}
      <div className={`${styles.actions} ${styles.actionsStart}`}>
        <a className="btn btn--primary btn--md" href="/leads">
          Open the leads board
        </a>
        <Button variant="secondary" onClick={onAgain}>
          Import more files
        </Button>
      </div>
    </div>
  );
}
```

(Check `Badge`'s tone names in `components/ui/Badge.tsx`; use its success/info/warning/danger equivalents if these differ.)

- [ ] **Step 5: The wizard**

Create `app/src/components/settings/ghlImport/GhlImportWizard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { ApplyResult, DryRunData, DryRunResponse, ImportResponse } from "@/lib/ghlImport/types";

import { DryRunView, ResultView, UploadStep } from "./views";

const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (ms: number) => DAY_FMT.format(new Date(ms));

export function GhlImportWizard() {
  const confirm = useConfirm();
  const today = dayOf(Date.now());
  const [contacts, setContacts] = useState<File | null>(null);
  const [opportunities, setOpportunities] = useState<File | null>(null);
  const [exportDay, setExportDay] = useState(today);
  const [dayTouched, setDayTouched] = useState(false);
  const [assignees, setAssignees] = useState<Record<string, number | null>>({});
  const [data, setData] = useState<DryRunData | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post<T>(mode: "dry-run" | "import", picks: Record<string, number | null>): Promise<T> {
    const fd = new FormData();
    fd.set("mode", mode);
    if (contacts) fd.set("contacts", contacts);
    if (opportunities) fd.set("opportunities", opportunities);
    fd.set("exportDay", exportDay);
    fd.set("assignees", JSON.stringify(picks));
    const res = await fetch("/api/import/gohighlevel", { method: "POST", body: fd });
    const json = (await res.json().catch(() => null)) as ({ ok: boolean; error?: string } & T) | null;
    if (!json || !json.ok) throw new Error(json?.error ?? "Something went wrong. Try again.");
    return json;
  }

  async function check(picks = assignees) {
    setBusy(true);
    setError(null);
    try {
      const res = await post<Extract<DryRunResponse, { ok: true }>>("dry-run", picks);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!data) return;
    const n = data.totals.people - data.totals.alreadyImported - data.totals.skipped - data.totals.unchanged;
    const yes = await confirm({
      title: `Import ${n.toLocaleString("en-IE")} people?`,
      body: "They go on the board and into follow-ups as the list shows. The import sends nothing itself. Running it again with the same files changes nothing.",
      confirmLabel: "Import",
    });
    if (!yes) return;
    setBusy(true);
    try {
      const res = await post<Extract<ImportResponse, { ok: true }>>("import", assignees);
      setResult(res.result);
      toast.success("Imported from GoHighLevel.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The import failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ResultView
        result={result}
        onAgain={() => {
          setResult(null);
          setData(null);
        }}
      />
    );
  }
  if (data) {
    return (
      <DryRunView
        data={data}
        busy={busy}
        onBack={() => setData(null)}
        onImport={runImport}
        onAssignee={(name, userId) => {
          const picks = { ...assignees, [name]: userId };
          setAssignees(picks);
          void check(picks);
        }}
      />
    );
  }
  return (
    <UploadStep
      contacts={contacts}
      opportunities={opportunities}
      exportDay={exportDay}
      today={today}
      busy={busy}
      error={error}
      onContacts={setContacts}
      onOpportunities={(f) => {
        setOpportunities(f);
        // The day the file was downloaded is the export day, unless the operator has set it.
        if (f && !dayTouched) {
          const d = dayOf(f.lastModified);
          if (d <= today) setExportDay(d);
        }
      }}
      onExportDay={(d) => {
        setDayTouched(true);
        setExportDay(d);
      }}
      onCheck={() => void check()}
    />
  );
}
```

- [ ] **Step 6: Typecheck, build, commit**

Run from `app/`: `npm run typecheck` (clean), then `npx next build` (succeeds). Then:

```bash
git add src/app/api/import/gohighlevel/route.ts src/app/settings/import/page.tsx src/app/settings/import/gohighlevel/page.tsx src/components/settings/ghlImport/GhlImportWizard.tsx src/components/settings/ghlImport/views.tsx src/components/settings/ghlImport/ghlImport.module.css src/app/settings/page.tsx
git commit -m "feat(ghl-import): Settings > Import > GoHighLevel, with the dry run and the download

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: GoHighLevel details on the lead and client pages

**Files:**
- Create: `app/src/components/people/GhlImportCard.tsx`, `app/src/components/people/AllowContactButton.tsx`
- Modify: `app/src/app/leads/[id]/page.tsx`, `app/src/app/clients/[id]/page.tsx` (the `<aside className="cp-side">`, after the "Care" card)
- Modify: `app/src/app/leads/actions.ts` (new `allowContactAgainAction`; `deleteLeadAction` forgets the import record)
- Modify: `app/src/app/clients/actions.ts` (`deleteClientAction` forgets the import record)
- Modify: `app/src/components/leads/LeadDetail.tsx` (`SOURCE_NAME`)

**Interfaces:**
- Consumes: Task 6 `getImportedPerson`, `forgetImportedPerson`, `allowContactAgain`; `ImportedPersonView`; `Card`, `CardLabel`, `Badge`, `Button`; `requireAdmin`.
- Produces: `GhlImportCard({ person, leadId? })` server component; `allowContactAgainAction(leadId: number): Promise<{ ok: boolean }>`.

- [ ] **Step 1: The card**

Create `app/src/components/people/GhlImportCard.tsx`:

```tsx
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card, CardLabel } from "@/components/ui/Card";
import type { ImportedPersonView } from "@/lib/ghlImport/types";

import { AllowContactButton } from "./AllowContactButton";

const DAY = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" });

/**
 * What the GoHighLevel import brought in for this person. Staff only: the
 * medical note is shown here and nowhere else (never to the AI, never in a
 * message or an export).
 */
export function GhlImportCard({ person, leadId }: { person: ImportedPersonView; leadId?: number }) {
  const facts: [string, string | null][] = [
    ["Stage there", person.ghlStage ? `${person.ghlStage}${person.daysInStage != null ? `, ${person.daysInStage} days` : ""}` : null],
    ["Source", person.ghlSource],
    ["Treatment interested in", person.treatment],
    ["Used treatments before", person.usedBefore],
    ["Town", person.town],
    ["Imported", DAY.format(new Date(person.importedAt))],
  ];
  return (
    <Card style={{ padding: 18, display: "grid", gap: 12 }}>
      <CardLabel>From GoHighLevel</CardLabel>
      {person.doNotContact && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <Badge tone="danger">Do not contact</Badge>
          {leadId != null && <AllowContactButton leadId={leadId} />}
        </div>
      )}
      <dl style={{ margin: 0, display: "grid", gap: 8 }}>
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} style={{ display: "grid", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{k}</dt>
              <dd style={{ margin: 0, fontSize: 13.5, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{v}</dd>
            </div>
          ))}
      </dl>
      {person.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {person.tags.map((t) => (
            <Badge key={t} tone="neutral">
              {t}
            </Badge>
          ))}
        </div>
      )}
      {person.staffMedicalNote && (
        <div style={{ display: "grid", gap: 4, padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--hairline)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
            <ShieldAlert size={14} aria-hidden /> Medical note, staff only
          </span>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{person.staffMedicalNote}</p>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Never sent to the AI or in any message.</span>
        </div>
      )}
    </Card>
  );
}
```

Create `app/src/components/people/AllowContactButton.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { allowContactAgainAction } from "@/app/leads/actions";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export function AllowContactButton({ leadId }: { leadId: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      onClick={async () => {
        const yes = await confirm({
          title: "Allow contact again?",
          body: "Follow-ups can start for this lead again. Do not call and the do-not-email list stay as they are; change those separately.",
          confirmLabel: "Allow contact",
        });
        if (!yes) return;
        start(async () => {
          const res = await allowContactAgainAction(leadId);
          if (res.ok) {
            toast.success("Contact allowed again.");
            router.refresh();
          } else toast.error("Could not change it. Try again.");
        });
      }}
    >
      Allow contact again
    </Button>
  );
}
```

- [ ] **Step 2: Actions and delete hooks**

In `app/src/app/leads/actions.ts`: import `{ allowContactAgain, forgetImportedPerson } from "@/lib/ghlImport/store"`; in `deleteLeadAction`, before `db.delete(leads)...`, add `forgetImportedPerson({ leadId });`; and add:

```ts
/** Clear a lead's do-not-contact (from an import). Admin only, like do not call. */
export async function allowContactAgainAction(leadId: number): Promise<{ ok: boolean }> {
  const user = await requireAdmin();
  const id = z.number().int().positive().parse(leadId);
  const ok = allowContactAgain(id);
  if (ok) {
    await logActivity("lead.contact_allowed", `Lead #${id}: contact allowed again by user #${user.id}`, { leadId: id });
    revalidatePath(`/leads/${id}`);
  }
  return { ok };
}
```

In `app/src/app/clients/actions.ts`: import `{ forgetImportedPerson } from "@/lib/ghlImport/store"`; in `deleteClientAction`, before `db.delete(clients)...`, add `forgetImportedPerson({ clientId: id });`.

- [ ] **Step 3: The pages**

In `app/src/app/leads/[id]/page.tsx`: import `{ GhlImportCard } from "@/components/people/GhlImportCard"` and `{ getImportedPerson } from "@/lib/ghlImport/store"`; compute `const imported = getImportedPerson({ leadId: id });` and render, after `<LeadDetail ... />`:

```tsx
      {imported && (
        <div style={{ maxWidth: 560, marginTop: 16 }}>
          <GhlImportCard person={imported} leadId={id} />
        </div>
      )}
```

In `app/src/app/clients/[id]/page.tsx`: same imports; compute `const imported = getImportedPerson({ clientId: client.id });` next to the page's other data loads, and inside `<aside className="cp-side">`, after the "Care" card block, render `{imported && <GhlImportCard person={imported} />}`.

In `app/src/components/leads/LeadDetail.tsx`, add to `SOURCE_NAME`: `gohighlevel: "GoHighLevel import",`.

- [ ] **Step 4: Typecheck, the guard test, build, commit**

Run from `app/`: `npm run typecheck`; `npm test -- src/lib/ghlImport/medicalNote.guard.test.ts` (PASS: the card is on the allow list, the pages only pass the view through); `npx next build`.

```bash
git add src/components/people/GhlImportCard.tsx src/components/people/AllowContactButton.tsx "src/app/leads/[id]/page.tsx" src/app/leads/actions.ts "src/app/clients/[id]/page.tsx" src/app/clients/actions.ts src/components/leads/LeadDetail.tsx
git commit -m "feat(ghl-import): GoHighLevel details and the staff-only medical note on lead and client pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks (controller)

1. Full suite: `npm test`, `npm run typecheck`, `npx next build`.
2. Real-file dry run (local only, counts only): a scratch-tenant script outside the repo loads Optimal Health's flow copy, runs `dryRunGhlImport` on the two real files and prints totals only.
3. Browser check: a throwaway route `app/src/app/f/zz-ghl-shots/page.tsx` renders `UploadStep`, `DryRunView` and `ResultView` with invented data; screenshots at 1280 and 390, dark and light; the route is deleted afterwards.
4. Final whole-branch review on the most capable model.
