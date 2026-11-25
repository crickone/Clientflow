# Import from GoHighLevel: design

Date: 2026-11-25. Status: decisions agreed with the operator in conversation.
First user: Optimal Health (tenant 1028). Built as a reusable admin tool.

## Goal

An admin screen, Settings > Import > GoHighLevel, where staff upload the two
GoHighLevel exports (contacts CSV, opportunities CSV), see a dry run of
exactly what will happen to every person, download it, and then import with
one click. People land in the right column and pick up the lead flows where
they were in GoHighLevel. Nothing is sent by the import itself.

## Inputs (real headers seen in Optimal Health's exports)

Contacts: Contact Id, First Name, Last Name, Phone, Email, Business Name,
Created, Last Activity, Tags, DND, Date of Birth, Source, "utm Campaign ",
Treatment interested in, Location, Medical Condition, Used treatments before?
(columns vary by export; match by name, case-insensitive, trimmed).

Opportunities: Opportunity name, Contact Name, phone, email, pipeline, stage,
Lead Value, source, assigned, Created on, Updated on, lost reason ID, lost
reason name, Followers, Notes, tags, Engagement score, status, ..., Opportunity
ID, Contact ID, Pipeline Stage ID, Pipeline ID, "Days since last stage change "
("75 Days"), "Days since last status change ", "Days since last update ".
"Days since last stage change" is relative to the export date: the operator
confirms the export date on the screen (default: the file's upload day).

Optimal Health: 3,264 contacts, 2,314 opportunities (one per contact), one
pipeline "Optimal Health Leads".

## Mapping (agreed)

Stage -> Adonis column, flow and position:
- Long Term Nurture -> Long-term nurture column. Entered N days ago: if N <=
  the nurture flow's length (week 12 = day 77, see lib/leadFlows presets),
  start the nurture run at the next step due after day N (earlier steps
  marked as done in GoHighLevel, not re-sent). Past the end: column only, no
  flow (they get normal campaigns).
- Call Back Later / Thinking About It / No Answer Call Back / New Lead: if N <=
  14 days, place in the matching column and flow at the next step after day
  N; if the flow is already past its end, move on as that flow's finish says
  (Long-term nurture at week 1). If N > 14 days ("stale"): Long-term nurture at
  week 1.
- Consult Booked: N <= 14 -> Consultation booked column, no flow; N > 14 ->
  Long-term nurture at week 1.
- Message Undelivered -> Message undelivered column; email-only follow-ups
  as the flow defines.
- Holding -> a "Holding" column (create if missing, no role, no flow).
- Send Deposit Link -> Hot lead, no flow.
- Won -> becomes a client (and lead marked won), no flow.
- Lost -> Lost column, never messaged.
- Contacts with no opportunity: tags member / visited-once / lapsed-2-months
  -> clients; lost / not interested -> lost, never messaged; everyone else ->
  email contacts only (not on the lead board), no flow.
- "not interested" tag anywhere, or DND true -> do-not-contact: no flow, no
  campaign email, no WhatsApp broadcast, ever, unless a person changes it.

Placement safety: no catch-up bursts. A step whose due date falls in the past
is skipped; the first step a person gets is the next future one, and nobody
gets more than one message on the import day. Steps are due within sending
hours. Imported runs only send while their flow is switched on (if a flow is
off at import time, its placed runs wait and their past-due steps are
skipped when it is switched on).

Consent: the operator decided (2026-11-25) that leads already in
GoHighLevel's nurture continue to get it. Record marketing consent for
imported leads with source "Carried over from GoHighLevel (operator decision
2026-11-25)". DND and do-not-contact people get no consent.

Fields carried over onto the lead/client: name, phone, email, created date,
source, tags (as lead tags), GoHighLevel notes (as notes), Treatment
interested in (drives the nurture week-2 variant: massage, infrared, HBOT,
PEMF -> HIFEM, else General), Used treatments before?, Location (town),
assigned user (match DJ/Sandra by name to Adonis staff, else the default),
and Medical Condition as a STAFF-ONLY medical note: shown to staff on the
lead/client page, never sent to the AI, never in any message, never in
exports outside the admin.

Duplicates: match existing Adonis leads/clients by email or phone
(normalised); update their missing fields and column instead of creating a
second record; never overwrite a newer Adonis stage with an older one, and
never touch someone already in an Adonis flow.

## The screen

1. Upload both files (contacts required, opportunities optional), confirm
   the export date.
2. Dry run: totals per column, clients/leads/contacts-only, do-not-contact,
   duplicates matched, people placed in each flow and how many messages are
   due in the next 7 days; a searchable table of every person (name, from
   stage, days in stage, to column, flow + next message + date, notes); a
   "Download the list" CSV.
3. Import: idempotent (re-running with the same files changes nothing;
   GoHighLevel IDs are stored as source ids). Shows a result summary.
Admin only. Nothing is sent, and no notifications, AI drafts, Meta events or
lead alerts fire for imported people.

## Testing

Pure mapping per stage and day count (incl. boundaries 14, 77), CSV header
matching, duplicate matching, step placement with past-due skipping;
scratch-tenant integration importing a small fake export twice (idempotent);
the medical note never appears in AI context or messages. Browser check of
the upload, dry run and result at 1280 and 390. No real personal data in
fixtures or docs.
