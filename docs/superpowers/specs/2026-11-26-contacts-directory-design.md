# Contacts directory and WhatsApp contact import: design

Date: 2026-11-26. Status: agreed with the operator in conversation. First
user: Optimal Health (tenant 1028). Built for every business.

## Problem

People live in four places: clients, leads (including Inbox-only
conversations, `leads.inbox_only`), the email mailing list (`contacts`,
under Campaigns) and the business's WhatsApp, whose saved contacts and chats
the system has never read. There is no one place to find a person.

## What gets built

### 1. WhatsApp contacts store

New tenant table `whatsapp_contacts`: id, phone (digits, unique), name,
saved (in the phone's contacts), last_chat_at (ms, null), hidden (boolean),
created_at, updated_at. Additive, create-only migration.

Filled from Whapi (shapes confirmed against the live connection):
- `GET /contacts?count=&offset=` returns `{contacts, count, total}`; each
  contact has `id` (phone digits), `name` (the saved name) or `pushname`,
  `saved`, `phonebook`.
- `GET /chats?count=&offset=` returns `{chats, count, total}`; each chat has
  `id` (`<digits>@s.whatsapp.net`, or a group / `status@broadcast`), `type`
  (`contact`, `group`, `stories`, ...), `timestamp` (seconds), sometimes
  `name`, and `last_message.from_name`.

Import = every saved contact plus every one-to-one chat (type `contact`, id
ending `@s.whatsapp.net`), one row per phone. Groups, status, channels, ids
that are not 7-15 digits, and the business's own number are skipped. Pages of
500, at most 20 pages per list. An existing row keeps `hidden`; name, saved
and last_chat_at are refreshed (a saved name beats a pushname).

Runs: when WhatsApp connects, once a day (the daily scheduler), and from a
"Refresh from WhatsApp" button. The result (time, count, or the reason it
failed, e.g. "WhatsApp is not connected") is kept in the setting
`whatsapp_contacts_sync` and shown on the page.

The import never makes a lead, starts a flow, sends a message or records
marketing consent. WhatsApp broadcasts stay opt-in only, so they never reach
these contacts.

### 2. The Contacts page (`/contacts`, sidebar beside Clients and Leads, all staff)

Built at request time from the four sources; no stored copy of "people".

- One row per person: records are joined when they share a phone (last 9
  digits of the normalised number) or an email (lowercased), transitively.
- Columns: name, what they are (tags: Client, Lead with its column, Not a
  lead, Mailing list, WhatsApp), phone, email, last message (latest lead or
  client message, or WhatsApp chat time).
- Name: client's, else the newest lead's, else mailing list, else WhatsApp
  saved name, else pushname, else the phone number.
- Search (name, phone, email). Filters: All, Clients, Leads (an on-board
  lead and not a client), Not leads (no client, no on-board lead), WhatsApp
  only (a WhatsApp row and nothing else). 100 per page, newest message first.
- Row actions:
  - Open: the client page; else the newest on-board lead's page; else the
    Inbox conversation of an Inbox-only lead.
  - Add as lead (anyone with no client and no on-board lead): an Inbox-only
    lead goes on the board (`addToPipeline`); a WhatsApp-only person becomes a
    lead with source `whatsapp`; a mailing-list-only person a lead with
    source `email`. No automatic follow-up for either (neither source is an
    enquiry).
  - Hide (WhatsApp-only rows): hidden rows are left out of the list and stay
    hidden after later imports.
- Responsive by its own width: a table on desktop, stacked rows on a phone,
  no horizontal page scroll at 390px.

## Out of scope

Editing details here, tags, export, merging records, messaging a
WhatsApp-only contact from this page.

## Testing

- Pure: parsing Whapi contacts and chats (groups/status/own number skipped,
  saved name beats pushname, seconds to ms), merging the two lists.
- Pure: the directory join (phone and email, transitive), names, tags,
  filters, search, hidden.
- Scratch tenant: the import upserts and keeps `hidden`; Add as lead for each
  kind; the import makes no lead and queues nothing.
- Browser check of the page at 1440, 820 and 390 wide.
- No real personal data in fixtures. No emojis. Plain copy.
