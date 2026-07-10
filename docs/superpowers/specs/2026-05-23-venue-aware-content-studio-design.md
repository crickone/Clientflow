# Venue-Aware Content Studio

**Date:** 2026-05-23
**Status:** Design approved — spec under review
**Follows:** the venue-neutral domain refactor (`2026-05-23-venue-neutral-domain-design.md`). Builds on the `venue_type` setting + vocabulary system already shipped.

## Context & problem

Content Studio (Blogs, Carousels/Images, Videos) was excluded from the Phase 4b
vocabulary sweep. Investigation showed three distinct layers:

1. **Content source is already venue-driven.** The blog "from a therapy" mode and
   carousel topics pull from the **services table** (`therapies`), so a gym would
   already see *its own* services as content sources. No change needed.
2. **Labels are unwired** — `NewBlogForm` and related UI still say "Therapy" /
   "Pick a therapy". Cheap to wire via the existing vocab system.
3. **The AI prompts are hardcoded to Renova-the-clinic.** Each generator's
   `SYSTEM_PROMPT` opens with *"You are a copywriter for Renova Cellular Health, a
   wellness clinic in Clonmel… Therapies offered: HBOT, Infrared, PEMF… no medical
   claims… describe what the therapy is, not what it cures."* So the **output** is
   always a clinical wellness blog mentioning HBOT — regardless of venue type, and
   even for a different clinic with different services. This is the real reason
   Content Studio felt clinic-locked.

## Goal

Same Content Studio functionality, but the **generated content adapts to the venue
type**: a gym produces motivational, fitness-flavoured copy about its own classes;
a clinic produces the current grounded, claim-free wellness copy about its
therapies. Achieve this by making the AI prompts data-driven (services from the DB)
and venue-type-aware (voice/framing), and by wiring the Content Studio labels
through the vocabulary system.

Approved decisions:
- **Scope = venue voice + DB-driven services.** Switch AI voice/framing by venue
  type; build the services list from the DB; keep the **"Renova/Clonmel" business
  identity hardcoded** for now (single tenant).
- **Approach = a shared `businessContext` builder** the generators call (not
  per-generator inline switches, not per-call-site strings).

## Architecture

### 1. `src/lib/ai/businessContext.ts` (new, `server-only`)

Single source of the venue-aware prompt header. Reads `getVenueType()`
(`lib/settings`) and the active services from the DB.

`getBusinessContext(): string` composes three parts:

- **Identity** — a constant for now:
  `Renova Cellular Health · Ard Gaoithe Business Park, Clonmel, Co. Tipperary ·
  renovacellularhealth.ie · 083 867 2844`. (Becomes a per-tenant profile in the
  tenancy/branding phase — noted, not built here.)
- **Services** — built dynamically from active rows in the `therapies` table
  (name · `defaultDurationMinutes` min · €`defaultPriceEur` · `description`),
  with a generalized guardrail: *"These are the only services offered — do not
  invent or mention services not in this list."* (Replaces the hardcoded
  HBOT/Infrared/PEMF block + the "do not mention cryotherapy/red light" line.)
- **Voice** — switched on `venue_type`:
  - **clinic**: grounded, informative, Irish English; **no medical claims**
    ("describe what a service *is*, not what it *does to disease*"; "many clients
    find…"); avoid hype words; understated CTA. (Preserves today's Renova voice.)
  - **gym**: energetic, motivational, results- & community-focused, Irish
    English; action-led CTAs; still no false promises or guaranteed outcomes;
    avoid hype words.

Helper shape (illustrative): a small internal `VENUE_VOICE: Record<VenueType,
string>` map plus a `formatServices()` reader. Returns one composed string. Keep
it focused — voice text lives here, not scattered across generators.

### 2. Refactor the three Content Studio generators

`src/lib/ai/draftBlog.ts`, `src/lib/ai/generateCarousel.ts`,
`src/lib/ai/planCut.ts`:

- Replace the hardcoded identity + therapies + voice block at the top of each
  `SYSTEM_PROMPT` with `getBusinessContext()`.
- **Keep the format/structure rules per-generator** — markdown rules and output
  format (blog), the slide-template recipes / `SLOT_STYLES` / JSON `<slides>`
  schema (carousel), the B-roll placement rules + JSON schema (planCut). These
  are not venue-specific.
- Compose the system prompt as `getBusinessContext() + "\n\n" + FORMAT_RULES`.
  Preserve `cache_control: { type: "ephemeral" }` on the system block — it's
  still cacheable; the header is just data-driven now (cache key changes only
  when services or venue type change, which is correct).
- Lightly de-clinic the two hardcoded carousel examples in `SLOT_STYLES`
  (the `carousel-quote-slide` "Aoife M., HBOT client" testimonial example and the
  `question-hook` "Why does PEMF leave you feeling lighter?" example) so they
  reference a generic service rather than a clinic-only modality.

The generators currently import only Anthropic + types; they will additionally
import `getBusinessContext` from `./businessContext`. They already run server-side
(invoked from API routes), so a synchronous DB read in the builder is fine.

### 3. Wire Content Studio labels through vocab

The piece skipped in Phase 4b. Route user-visible "therapy" strings through the
vocabulary system (`useVocab()` in client components, `getVocab(getVenueType())`
in server pages):

- `components/content-studio/NewBlogForm.tsx` — the "Therapy" source-mode chip,
  the `Pick a therapy.` validation message, the source dropdown label.
- The blog/new page and any carousel/image source UI that names "therapy".
- Audit `content-studio/**` for remaining `Therap*` user-facing strings (skip
  code symbols, the `inputMode: "therapy"` enum value, and DB field names).

## Out of scope

- **Per-tenant business identity** (name/address/phone/contact) — tenancy/branding
  phase. Identity stays "Renova" here.
- **Lead follow-up drafter** (`lib/ai/draftFollowup.ts`) — also hardcoded to the
  clinic, but it belongs to the Leads module, not Content Studio. Note as a
  related future item; do not change here.
- **Marketing ad library** and **Training** — remain excluded (venue-specific
  content, not generic tooling).
- No changes to the image-template *designs* themselves (manual design tool).

## Verification

- With `venue_type = clinic` (default): generate a blog and a carousel; output
  matches today's Renova-style voice and references the actual seeded services.
  Content Studio labels read "Therapy" as before.
- Flip Settings → Venue type to **gym**: labels read "Class"; generate a blog and
  carousel and confirm the copy reads gym-appropriate (motivational, references
  the venue's own services, no "wellness clinic" / medical-claim framing).
- Confirm the services block reflects the DB (e.g. if a service is renamed or
  added, the prompt picks it up).
- `npm run build` / `tsc --noEmit` clean.

## Notes

- Repo is not under git, so this spec is saved but not committed.
- This makes the prompts correct for *any* clinic's services too (not just gyms),
  since the services list is no longer hardcoded — a useful pre-tenancy fix.
