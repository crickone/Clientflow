# Implementation Plan — Venue-Aware Content Studio

**Spec:** `docs/superpowers/specs/2026-05-23-venue-aware-content-studio-design.md`
**Approach:** a shared `businessContext` builder consumed by the three Content
Studio generators, plus label wiring. Identity stays "Renova" (hardcoded); voice
switches on `venue_type`; services come from the DB.

**Sequencing principle:** build the builder first, then refactor generators one at
a time (each independently testable), then wire labels, then verify both modes.
After every phase: `tsc` clean and the app still generates content.

---

## Phase 0 — `businessContext` builder

**Objective:** one server-only module that produces the venue-aware prompt header.

**Files:**
- `src/lib/ai/businessContext.ts` (new, `import "server-only"`):
  - `const IDENTITY` — constant string: "Renova Cellular Health · Ard Gaoithe
    Business Park, Clonmel, Co. Tipperary · renovacellularhealth.ie ·
    083 867 2844". (Comment: replaced by a per-tenant profile in the tenancy phase.)
  - `const VENUE_VOICE: Record<VenueType, string>` — the two voice blocks:
    - `clinic`: grounded/informative, Irish English, **no medical claims**
      ("describe what a service *is*, not what it *does to disease*"; "many
      clients find…"), avoid hype words, understated CTA.
    - `gym`: energetic/motivational, results- & community-focused, Irish English,
      action-led CTAs, no false/guaranteed outcomes, avoid hype words.
  - `formatServices(): string` — read active rows from `therapies` via `db`
    (name · `defaultDurationMinutes` min · €`defaultPriceEur` · `description`),
    one per line, then the guardrail line: "These are the only services offered —
    do not invent or mention services not in this list."
  - `getBusinessContext(): string` — compose:
    `You are a copywriter for ${IDENTITY}.\n\nServices offered:\n${formatServices()}\n\n${VENUE_VOICE[getVenueType()]}`
    (exact wording tuned to read naturally; the three parts are identity →
    services → voice).

**Verify:** temporary call logs a clinic header (lists seeded HBOT/Infrared/PEMF,
clinic voice); flipping `venue_type` to gym swaps the voice block. `tsc` clean.

---

## Phase 1 — Refactor `draftBlog.ts`

**Objective:** blog generation uses the shared header; output unchanged in clinic.

**Files:** `src/lib/ai/draftBlog.ts`
- Import `getBusinessContext` from `./businessContext`.
- Remove the hardcoded identity + "Therapies offered: HBOT/Infrared/PEMF" +
  "do not mention Red Light/cryotherapy" + voice rules from the top of
  `SYSTEM_PROMPT`. **Keep** the markdown/structure/output-format rules.
- Build the system prompt at call time inside `draftBlogPost`:
  `const system = getBusinessContext() + "\n\n" + BLOG_FORMAT_RULES;`
  (rename the trimmed constant to `BLOG_FORMAT_RULES`). Pass it as the cached
  system block (`cache_control: { type: "ephemeral" }` preserved).
- Leave `buildUserPrompt` as-is (it already takes the selected therapy/service).

**Verify:** generate a blog in clinic mode → reads like today (Renova voice, real
services). `tsc` clean.

---

## Phase 2 — Refactor `generateCarousel.ts`

**Objective:** carousel generation uses the shared header; de-clinic examples.

**Files:** `src/lib/ai/generateCarousel.ts`
- Same swap: replace the hardcoded business/therapies/voice block with
  `getBusinessContext()`, keeping the carousel structure rules, `SLOT_STYLES`,
  and the `<slides>` JSON schema as `CAROUSEL_FORMAT_RULES`. Compose
  `getBusinessContext() + "\n\n" + CAROUSEL_FORMAT_RULES` inside
  `generateCarouselSlides`; preserve `cache_control`.
- De-clinic the two hardcoded `SLOT_STYLES` examples so they aren't clinic-locked:
  - `carousel-quote-slide.contentNotes`: change "Aoife M., HBOT client, 4-session
    package" to a generic service-agnostic attribution example.
  - `question-hook.contentNotes`: change "Why does PEMF leave you feeling
    lighter?" to a generic service-agnostic question example.

**Verify:** generate a carousel in clinic mode → coherent, on-voice, references
real services. `tsc` clean.

---

## Phase 3 — Refactor `planCut.ts`

**Objective:** video B-roll planner uses the shared header.

**Files:** `src/lib/ai/planCut.ts`
- Replace the opening business sentence ("You are a short-form video editor for
  Renova Cellular Health, a wellness clinic in Clonmel. The clinic offers HBOT,
  Infrared Therapy, and PEMF Therapy.") with `getBusinessContext()`, keeping all
  the B-roll placement rules + JSON schema as the format block. Compose + preserve
  `cache_control`.
- (B-roll planning is structural; voice matters less here, but using the shared
  header keeps services/identity consistent and removes the hardcoded therapy
  list.)

**Verify:** `tsc` clean; if a video project with b-roll exists, a plan still
generates. (Functional behaviour unchanged — only the prompt preamble.)

---

## Phase 4 — Wire Content Studio labels through vocab

**Objective:** the UI labels skipped in Phase 4b now follow the venue.

**Method:** grep `content-studio/**` for user-facing `Therap*` strings.
```
rg -n "Therap(y|ies)" src/app/content-studio src/components/content-studio
```
Skip code symbols, the `inputMode/Mode = "therapy"` enum value, and DB field
names (`sourceTherapyId`). Wire the rest:
- `components/content-studio/NewBlogForm.tsx` (client → `useVocab`): the "Therapy"
  source-mode chip/label, the `Pick a therapy.` validation message, the source
  dropdown label/heading.
- `content-studio/blogs/new/page.tsx` and any carousel/image source UI that names
  "therapy" → `getVocab(getVenueType())` (server) or `useVocab()` (client).

**Verify:** clinic mode shows "Therapy" (unchanged); gym mode shows "Class" in the
blog source picker and validation. `tsc` clean.

---

## Phase 5 — Verification pass

- **Clinic (default):** generate a blog + a carousel → today's Renova voice, real
  seeded services, no behavioural change; CS labels read "Therapy".
- **Gym:** flip Settings → Venue type; CS labels read "Class"; generate a blog +
  carousel → motivational/community voice, references the venue's own services,
  no "wellness clinic"/medical-claim framing.
- Rename/add a service in Settings → confirm the generated content's service
  references update (proves DB-driven, not hardcoded).
- `npm run build` / `tsc --noEmit` clean.

---

## Risk notes
- The voice blocks are prompt-engineering text; quality is judged by reading a
  sample generation in each mode (Phase 5), not just compilation.
- Keep `cache_control: ephemeral` on the system block in all three generators —
  losing it would silently increase token cost.
- The builder does a synchronous DB read; that's consistent with the rest of the
  server code (better-sqlite3) and runs only at generation time.
- API keys (`ANTHROPIC_API_KEY`) must be set for live generation tests; the
  refactor itself is verifiable by `tsc` + reading the composed prompt.
