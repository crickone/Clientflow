# Optimal Health website — expansion and premium pass

Date: 2026-09-29
Tenant: 1028 `optimal-health` · Source: `sites/optimal-health/` · Status: design approved

## Why

The rebuild shipped on 2026-09-08 carries 19.5 KB of copy across nine pages. The
client's live Webflow site at www.optimalhealthatinspire.ie carries 95.7 KB across
thirteen pages plus six blog posts. We are at roughly a fifth of it, and the
missing four fifths includes the material that actually sells: an eighteen-question
FAQ, two audience pages, insurance claim-back, a booking system, and a voucher shop.

Every "Book a session" button on our site currently points at nothing.

## What we are building

Nine pages become fourteen, plus six blog posts, on a new page structure that can
carry long-form content without reading as a wall of text.

### Site map

| State | Page | Notes |
| --- | --- | --- |
| Deepen | `index` | Audience routing, insurance, more testimonials, live CTAs |
| Deepen | `therapies` | Overview that routes into the four |
| Rebuild | `hbot` `infrared` `hifem` `massage` | Six-section rail, ~4x current depth |
| Rebuild | `pricing` | Correct blocks, memberships, insurance, vouchers |
| Deepen | `about` `contact` | Contact form wired to a real endpoint |
| New | `recovery` | Recovery and everyday health — reshaped from their `/medical-treatments` |
| New | `athletes` | Athletic performance — reshaped from their `/athletic-performance` |
| New | `collagen` | Skin and collagen — from `/collagen-production`, incl. the results timeline |
| New | `testimonials` | Every usable quote |
| New | `blog` + 6 posts | Carried across from their `/post/<slug>` |

### The therapy page structure

Six numbered sections on every therapy page, which is what the rail indexes:

```
01  What it is
02  How it works
03  What it supports
04  A session, start to finish
05  Questions
06  Pricing and booking
```

Infrared takes a seventh, the week-by-week results timeline. The eighteen-question
FAQ lands as HBOT's `05`; the other three get shorter FAQs written to the same
pattern.

## Design: the rail-ledger

A sticky index rail merged with a two-column ledger — the rail **is** the label
column, so nothing is drawn twice.

**Desktop.** A narrow left margin holds the numbered contents, highlights the
current section as you scroll, and carries one persistent Book button. Body copy
runs in a wide right column at a comfortable reading measure. Dotted rules and a
section number open each part.

**Phone.** No margin to spare, so the rail lies down: a horizontal chapter strip
that sticks under the header and tracks position. Book moves to a fixed bottom bar,
within the thumb's reach, which is where a phone visitor converts.

**Constraints this accepts.** The margin holds the page width, so full-bleed
photography moments get rarer. That is the deliberate trade for shipping before a
photography pass — we have eight photographs for nine pages today, and the massage
page shows its hero twice.

**Degradation.** The scroll-spy is progressive enhancement. With JS disabled the
rail renders as a plain anchor list and every section is still reachable.

## Content rules — the reshape

The live site's `/medical-treatments` page names conditions and claims treatment:
arthritis, fibromyalgia, diabetic foot ulcers, radiation cystitis,
osteoradionecrosis, chronic bone infection, Bell's palsy, concussion, cancer
aftercare. On the same page its own FAQ states *"we offer mild HBOT for general
wellness only; we don't diagnose or treat medical conditions."* Both cannot stand.

We bring across the weight and the structure, not the claims.

- **Mechanism explainers come across nearly intact.** They are factual, plainly
  written, and the best content on the site.
- **Benefit clusters keep their headings and their structure, lose their condition
  names.** "Eases chronic pain in osteoarthritis, rheumatoid arthritis" becomes
  joint comfort and stiffness, written without the diagnosis.
- **No treats, cures, heals.** Supports, promotes, may help.
- **Their FAQ comes across almost verbatim.** It is already written to the
  conservative line, GP-clearance gating included. It needs almost no editing and
  it is the strongest asset they have.
- **The two testimonials dropped on compliance grounds stay dropped** — the second
  operation line and the cardiac reference.

This continues the line the rebuild was already written to. The compliance and
voice document the brand pack refers to has still never been supplied; ask again.

## Pricing — correcting a reverted fix

The current pricing page carries six correct numbers under invented labels. Commit
`223437b` found this on 2026-09-08 and fixed it; commit `0afb614`, two minutes
later, reverted it on the grounds that the printed flyer was superseded. The client
has now confirmed the flyer was current: **the HIFEM chair sells in blocks of 6 and
12, the other therapies in 5 and 10.**

The page is rebuilt to this list:

| Therapy | Single | Block | Block |
| --- | --- | --- | --- |
| Infrared | €50 | €225 / 5 | €400 / 10 |
| Hyperbaric oxygen | €100 | €450 / 5 | €800 / 10 |
| HIFEM chair | €70 | €375 / 6 | €670 / 12 |
| Massage | per treatment, ten treatments | | |

Infrared and HBOT match the live site exactly. The chair does not appear on the
live site at all — what is there is "PEMF" at €315/€560 in blocks of 5 and 10,
which is a stale description of the same machine. **`PEMF` is not used anywhere on
our site; the therapy is the HIFEM chair.**

**Struck-through "was €X" prices are dropped.** A strike-through is a claim that
the higher price was genuinely charged for a reasonable period, and we have no
source for that beyond the live page itself. Flagged for the client to overrule.

## Integrations

| Destination | Target |
| --- | --- |
| Book a session | `https://optimalhealthatinspire.simplybook.it/v2` |
| Client login | `https://optimalhealthatinspire.simplybook.it/v2/#client/sign-in` |
| Vouchers | `https://optimalhealth.voucherconnect.com` |
| Contact form | `POST /api/site/enquiry` — lands a lead in tenant 1028 |

The enquiry route is the machinery Healthwise proved on 2026-09-28. One change is
needed: `app/src/lib/cms/enquiry.ts` hardcodes Healthwise's programme list
(`livewell`, `vitality`, `heartwise`, `unsure`) in a module whose name promises to
be generic. The programme set becomes per-site, with Optimal Health's being the
four therapies plus "not sure yet". Existing Healthwise behaviour must not change —
its test file pins the current list.

## Also added

- **Monthly memberships** on the pricing page — €169 / €299 / €399. Their Premium
  tier is priced `$399` on the live site, a typo we do not carry across. The
  session contents name PEMF and so need confirming against the chair's blocks.
- **Insurance claim-back** — Irish Life and Laya for massage, VHI for reflexology,
  both worded as "may be able to claim depending on your plan", with a line telling
  people to confirm with their provider before booking.
- **The full massage menu** — sports, deep tissue, hot shells, oncology, holistic,
  reflexology, lymphatic drainage, cupping, Indian head, sculpting facial.
- **Infrared wavelengths** — 633, 660, 810, 850, 940 nm, as specification not claim.

## Build

The build shape does not change: `_style.css` + `pages/*.html` + `build.mjs`, with
every page emitted self-contained because that is what the CMS importer files
correctly. `node build.mjs` after every edit.

New in `build.mjs`:

- a **rail generator** that derives each page's index from its section markup, so
  the contents list can never drift from the sections it points at;
- the **scroll-spy** in the tail zone, which the Studio editor never runs.

All fourteen pages must verify as Studio-editable, as the current nine do.

## Out of scope

- **A photography pass.** The design was chosen so we can ship without one. The
  site runs on eight images and wants roughly thirty; that is its own piece of work
  and it is the single biggest remaining gap after this.
- **Importing to the CMS and going live.** Bundle, site row, domain — a separate
  step once the content is signed off.
- **GA4 and Meta Pixel.** Their live site carries both. Ours will need them before
  the domain switches, but it is a deploy concern, not a content one.

## Open questions for the client

1. The compliance and voice document referenced by the brand pack, asked for again.
2. Membership contents — the three tiers name PEMF sessions; what do they contain
   now that the chair sells in 6 and 12?
3. Struck-through prices — drop them, as specified here, or can they be stood over?

## Sequence

1. Rail-ledger structure in `build.mjs` and `_style.css`; booking, login and
   voucher links live everywhere. Smallest change that removes every dead CTA.
2. The four therapy pages rebuilt to the six sections, HBOT's FAQ included.
3. Pricing rebuilt; memberships, insurance and the massage menu.
4. `recovery`, `athletes`, `collagen`, `testimonials`.
5. The enquiry-route generalisation; contact form wired.
6. Blog index and the six posts carried across.
