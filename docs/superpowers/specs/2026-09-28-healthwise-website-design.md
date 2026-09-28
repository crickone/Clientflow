# Healthwise website — design

**Date:** 2026-09-28
**Tenant:** Healthwise, id 1415, slug `healthwise` (production; active, billing-exempt)
**Replaces:** healthwiseclonmel.ie (Webflow template, Pexels stock, LegitFit embed)
**Direction chosen:** A, "The consultation" (of three mocked; see below)
**Photography:** AI-generated, art-directed (client decision 2026-09-28)
**Booking:** LegitFit stays, framed inside the new design (client decision 2026-09-28)

## 1. What this is

A bespoke website for Healthwise, DJ O'Dwyer's exercise and lifestyle
management studio at Unit 12E Ard Gaoithe Business Park, Clonmel, built the
way every tenant site on the platform is built: static HTML in
`sites/healthwise/`, imported into the CMS, edited in Studio, blog rendered
by the CMS wearing the site's own chrome, published by the site bundle on
deploy, served on the client's domain.

The site has one job: turn a nervous visitor — over 40 or over 60, usually a
woman, often after a health event, often arriving from one of DJ's Meta ads —
into an enquiry that lands on the Healthwise leads board. Its second job is
to keep booking painless for existing members, which LegitFit does today and
keeps doing.

Note on the domain: `healthwise.ie` is not theirs (it redirects to a
health-food store and refuses HTTPS). The real domain is
`healthwiseclonmel.ie`.

## 2. Facts the site is built on

All verified from the live site, the brand files in the DJ client folder,
LegitFit's public timetable, and DJ's own profile and decks. Anything marked
*confirm* is listed again in section 12.

**Business.** Healthwise Ltd, founded 2011 by DJ O'Dwyer. Exercise and
lifestyle management; medical exercise for chronic disease; corporate
wellness; driver safety (Drivewise, its own site at drivewiseireland.ie).
Sister businesses at Ard Gaoithe: Inspire Health & Fitness, Bodega Cafe @
Inspire.

**DJ.** 30 years An Garda Síochána including the Emergency Response Unit;
lecturer in Physical Studies at the Garda College; MSc Performance Coaching
(Setanta College); BACPR cardiac rehabilitation (2014); NCEF levels 1 and 2;
S&C coach to Munster Rugby development squads (2011–14), Tipperary minor
football (2013–15), Clonmel Commercials (first Tipperary club to win the
Munster club football championship, 2015), St Mary's hurling (2017 county
intermediate champions), seven-time Irish super-heavyweight boxing champion
Dean Gardiner (2016–). Heartwise director since November 2013.

**Programmes.**
- *Livewell*, 40 to 60. Five coached classes: Women's Cardio Tone, MoveWell
  Strength for Women (menopause-aware strength), Men's Gym, Women's MoveWell
  Mobility, Women's Circuit.
- *Vitality*, 60 and over. Sold as "Studio 60" / "Over 60's class" in the
  ads. Gentle group exercise on light weights, bands, treadmills, bikes and
  rowers; morning and afternoon classes; for beginners, limited mobility,
  and people returning after a health or cardiac event.
- *Heartwise*. Supervised exercise and lifestyle coaching for people who
  have had a cardiac procedure and finished hospital rehab, and for people
  managing type 2 diabetes, blood pressure and weight. Has its own lockup
  ("Heartwise", same heart-W and tagline).

**Audience, from the Studio 60 Meta campaign (Jan–May 2026):** 173 leads at
€8.50 each; 91% aged 55+; 72% women. Best-performing line: *"Getting older
doesn't mean slowing down & living with aches and pains."*

**Voice.** DJ's: plain, direct, evidence, no outcome promises. His own line:
*"Our business is all about adding years to your life and life to your
years."* Tagline: *Educate, Motivate, Activate.*

**Contact.** 086 242 2388 · dj@healthwiseclonmel.ie · Unit 12E Ard Gaoithe
Business Park, Clonmel, Co. Tipperary, E91 A6F4 (*confirm*: the Over 60's
flyer prints E91 E049, which is Optimal Health's Eircode) · Facebook
/healthwiseclonmel · Instagram @healthwise_clonmel · DJ on LinkedIn.

**Hours.** The old site's schema says Mon–Thu 09:00–12:00 and 17:00–20:00,
Fri 09:00–12:00 and 17:00–19:00, but LegitFit lists classes at 07:00. The
site will not print an hours block; it says "classes from 7am, mornings and
evenings" and points at the timetable (*confirm* with DJ).

**Booking.** LegitFit, public timetable at
`https://legitfit.com/p/timetable/healthwise`. Shows memberships, packages
and a "€1 drop-in". We print no prices.

**Tracking on the old site, to carry over:** Google Analytics
`G-F46FGCY1D3`; Meta pixel `495090635138220`.

## 3. Site map

| Path | Page | Content |
|---|---|---|
| `/` | Home | Hero, proof strip, three programmes, method, DJ in one paragraph, three hand-picked blog links, contact strip |
| `/livewell` | Livewell 40–60 | Who it's for, the five classes, what a week looks like, the coach, enquiry CTA |
| `/vitality` | Vitality 60+ | The Studio 60 promise; what a session actually is; for beginners and people coming back; morning and afternoon; enquiry CTA |
| `/heartwise` | Heartwise | After hospital rehab ends; diabetes, blood pressure, weight; the Heartwise lockup; BACPR; since 2013; enquiry CTA |
| `/classes` | Classes and times | Every class described, who it's for, LegitFit timetable embed, "Book on LegitFit" fallback link |
| `/about` | About DJ | Bio, credentials, timeline (2011, 2013, 2015, 2016, 2017, 2019), philosophy |
| `/contact` | Book a consultation | The enquiry form (see section 7), phone, email, address with map link, how to find the unit, socials |
| `/drivewise` | Drivewise | One short page: what it is, for whom, links out to drivewiseireland.ie. Footer link only |
| `/blog` | Blog | CMS-rendered index and 21 migrated posts (section 9) |

Main navigation: Livewell 40–60 · Vitality 60+ · Heartwise · Classes ·
About DJ · Blog · **Book a consultation** (button). Mobile header also
carries a tap-to-call phone link.

Every call to action on the site is the phrase **Book a consultation** and
goes to `/contact#book`. "Free consultation" is never written. Inspire and
Bodega appear only in the footer under "Also at Ard Gaoithe".

## 4. Visual system (direction A)

**Idea.** A good clinic, not a gym. White ground, big calm navy type, one
photograph doing the emotional work per section, the pulse line as the only
decoration, and a structure that follows DJ's actual method.

**Colour** — the brand's own values, nothing added (from the logo file and
the social post kit's contrast-checked palette):

| Token | Value | Use |
|---|---|---|
| navy | `#28245C` | all display type, rules, the method section ground |
| red | `#EA1C28` | the pulse line and the primary button — nothing else |
| red-dark | `#BB1620` | primary button hover/active |
| red-tint | `#FCE8E9` | the Heartwise panel ground |
| ink-2 | `#241A1B` | body text |
| mid | `#544D4D` | secondary text, eyebrows, captions (8.25:1 on white) |
| mute | `#858080` | never for text (3.9:1 fails AA); hairlines and dividers only |
| surf | `#F2F2F2` | proof strip, alternating section ground |
| white | `#FFFFFF` | page ground |

Grounds rotate white, surf, and at most one navy section per page. Never two
dark sections in a row. Red is never a ground.

**Type.** Manrope 800 for display, Open Sans 400/600 for text — the pair
the post kit already codified as "Healthwise Display/Text", so the site and
the social posts read as one brand. Loaded from Google Fonts with
preconnect. Scale: h1 `clamp(40px, 5.2vw, 68px)` at line-height 1.02 and
−0.02em; section titles 36–40px; programme names 40px; body **18px** desktop,
17px mobile, line-height 1.6, max 60ch; eyebrows Open Sans 600 12px,
0.14em tracking, upper case, mid. The audience is over 60: the type is
honestly big and never lighter than 400.

**Signature: the pulse line.** An inline SVG, flat → one beat → flat, red,
2px stroke, 140px wide in the hero. It is the line painted across their own
shopfront glass. One rule: one beat per section — under the key phrase in
the hero, and as the divider before each section title. Never used as
decoration anywhere else, never animated except its single draw-on in the
hero.

**Structure encodes the method.** The home page's method section is
numbered 01–04 because DJ's process is genuinely a sequence: a conversation,
your programme, coached sessions, progress measured. The programmes are three
doors: age band as the eyebrow, the name big, one paragraph, one photograph,
one link.

**Header/footer.** A `<header>` and `<footer>` element on every page — the
CMS lifts them from the home page as the chrome for blog pages. Header:
logo left, links, the button. Footer: logo, address, phone and email, hours
line, programme links, "Also at Ard Gaoithe", legal line.

**Motion** — the Optimal Health GSAP vocabulary, one easing set: hero copy
rises and the photo settles; photographs wipe up as reached; method steps
arrive in sequence; the pulse line draws on once. Everything gated on the
`js` class set in the head, so pages read fully without JavaScript and the
Studio canvas (which never runs the tail zone) shows every section. Reduced
motion respected: the flag is removed and nothing hides.

**Legibility floor.** WCAG AA for all text; 48px minimum button height;
visible focus rings; 44px tap targets; the phone number as `tel:` in the
mobile header; the LegitFit iframe at a fixed height so nothing shifts.

## 5. Photography

An art-directed, AI-generated set, graded to sit beside the real photographs
we have (the shopfront sign with the ECG line across the glass, the Heartwise
class from behind, the studio floor). No real member's face appears
anywhere, which also removes the consent question.

**The room, in every prompt:** a small bright exercise studio; pale
blue-grey painted walls; white and maroon resistance machines; black
treadmills and recumbent bikes; a blue LED strip along one wall; drop
ceiling; large front windows with daylight; grey rubber floor. Documentary
photograph, 35mm, natural window light, shallow depth of field, no text, no
logos, no watermarks.

**The people, in every prompt:** realistic Irish adults, ordinary gym
clothes (t-shirts, leggings, trainers), mixed men and women, ages as
specified, no stock smile, caught mid-movement or mid-conversation.

**Shot list** (12 generated; three real):

| # | File | Ratio | Brief |
|---|---|---|---|
| 1 | `hero-portrait` | 4:5 | Woman, mid-60s, grey hair, mid-set with light dumbbells or on a recumbent bike, laughing at someone off-frame |
| 2 | `livewell` | 4:3 | Woman around 50, kettlebell at her side, resting between sets, focused |
| 3 | `vitality` | 4:3 | Three people over 65 seated on the white machines, a coach standing beside one |
| 4 | `heartwise` | 4:3 | Man around 70 walking on a treadmill, coach beside him with a hand near the console |
| 5 | `livewell-hero` | 3:2 | Small group 45–60 in a circuit with resistance bands |
| 6 | `vitality-hero` | 3:2 | Woman around 70 on a seated leg press, smiling at the coach |
| 7 | `heartwise-hero` | 3:2 | Man mid-60s on a recumbent bike checking a chest-strap monitor, calm |
| 8 | `classes-hero` | 3:2 | The room mid-morning, four people, movement, window light |
| 9 | `detail-hands` | 1:1 | Older hands adjusting a light dumbbell |
| 10 | `detail-band` | 1:1 | A resistance band around two ankles on the grey floor |
| 11 | `detail-chat` | 1:1 | Two women in their 60s talking after a class, water bottles |
| 12 | `detail-floor` | 1:1 | Trainers on the rubber floor, window light across it |
| — | `shopfront` | real | The sign and the ECG line on the glass (`PXL_20250704_163417277`) |
| — | `class-real` | real | Heartwise Tuesday from behind (`PXL_20251021_104017984`), used small |
| — | `room-real` | real | Studio floor (`PXL_20250730_163729618`) (*confirm* this is Healthwise's room, not Inspire's) |

**Pipeline.** `sites/healthwise/photos.mjs`: one prompt per shot, four
candidates each, FLUX 1.1 Pro via fal.ai using the platform's prod `FAL_KEY`
run locally (4c per image; ~48 generations, under €3). Every candidate is
looked at before it is kept: reject wrong hands, wrong room, a stock face,
any text. Keepers are graded (saturation −10%, warm-neutral) and exported as
progressive JPEG under 250KB at 1600px on the long edge, with a 2x hero.
Prompts and the chosen seed per keeper are committed beside the images so a
shot can be re-run.

**DJ himself cannot be generated.** The About page needs a real portrait;
until it arrives the About hero is the shopfront door. Ask DJ for a phone
photo by the studio window (section 12).

## 6. Build shape

`sites/healthwise/` follows `sites/optimal-health/`:

```
sites/healthwise/
  _style.css          one stylesheet, inlined into every page by the build
  build.mjs           composes nav + page partial + footer + scripts → standalone pages
  photos.mjs          the photography pipeline (section 5)
  pages/*.html        body partials: home, livewell, vitality, heartwise, classes,
                      about, contact, drivewise
  assets/             logo.png, logo-white.png, heartwise-logo.png, heart.png,
                      pulse.svg, photography (section 5)
  index.html …        BUILD OUTPUT, committed: what the importer reads
```

Each emitted page is self-contained: `<link>` fonts and one `<style>` in
the head (the importer's head zone), the markup (content zone, the only
part Studio edits), GSAP `<script>`s at the end of the body (tail zone).
Every page must pass `studioEditability`. Titles and meta descriptions are
written per page; the importer maps them to SEO. Each page head also
carries LocalBusiness JSON-LD with the corrected details from section 2.

## 7. Enquiries become leads (platform change)

No bespoke site today has a working form (Optimal Health's posts to `#`).
This site's form creates a lead in the Healthwise pipeline, with the same
trust model as campaign landing pages: the browser never names a tenant; a
server-minted signed token does.

**Token.** `app/src/lib/cms/enquiryToken.ts`:
`signSiteEnquiryToken({tenantId, siteId})` and
`verifySiteEnquiryToken(token)`. HMAC-SHA256 with `EMAIL_TOKEN_SECRET`,
same shape as `lib/campaigns/signupToken.ts` (`base64url(payload).
base64url(sig)`), payload `{t, s, k: "enquiry"}` — a disjoint claim from the
campaign token's `{t, c}` so neither can be replayed as the other. Verify
returns `null` for missing secret, bad shape, bad signature, or wrong `k`.

**Injection.** `RenderCtx` (components/cms/Block.tsx) gains `tenantId`,
set in `resolvePageContext` from `resolved.tenantId`. The `clientflow-live`
template (lib/cms/sites/renova/templates.tsx) mints a token when — and only
when — the body contains the literal `__ADONIS_ENQUIRY_TOKEN__`, and
replaces every occurrence. Sites without the placeholder render exactly as
before. The Studio canvas leaves the placeholder literal.

**Form** (on `/contact`, mirrored as a short strip on programme pages):
`<form method="post" action="/api/site/enquiry">` with fields `name`,
`phone`, `email`, `programme` (`livewell` | `vitality` | `heartwise` |
`unsure`), `about` (textarea, ≤ 1000 chars), hidden `token`, honeypot
`company_website`. Name and one of phone/email are required. Native POST
works without JavaScript (the route redirects back with `?ok=1` or
`?err=…`, read by the page); a tail script enhances it with `fetch` and an
inline thank-you: "Thanks — we'll be in touch shortly."

**Route.** `app/src/app/api/site/enquiry/route.ts`, mirroring
`api/campaigns/signup/route.ts`: content-length pre-check and a 32KB cap on
the decoded body; per-IP rate limit (8 per 10 minutes, like `f/submit`);
JSON or url-encoded, branched on Content-Type/Accept like `f/submit`;
honeypot → 200 `{ok:true}` with nothing stored; token verify (missing,
tampered and unknown all → the same 400); validate; then inside
`runWithTenant(tenantId)`: `upsertLead({ source: "website", campaign:
"Website enquiry", fullName, email, phone, notes })` into the default
pipeline's entry stage, `notes` carrying programme and the "about" text,
then `logActivity("lead.new", …)`. Response `{ok, leadId, created}` for
JSON, 303 back to `/contact` otherwise. The site slug and tenant never
appear in the request body.

New-lead automations and the nurture sequence pick the lead up like any
other; nothing else is wired.

## 8. Classes: LegitFit inside the design

`/classes` is our copy — each class in DJ's words, who it is for, "classes
from 7am, mornings and evenings" — then the LegitFit timetable in a framed
panel: `<iframe src="https://legitfit.com/p/timetable/healthwise?isIframe=true"
title="Healthwise class timetable" loading="lazy" width="100%" height="800">`
at a max-width of 600px, height fixed so the page does not shift, and a plain
"Book on LegitFit" link beneath it for browsers that block embeds. Verified:
neither the public render (`clientflow-live` is verbatim) nor the Studio
save path sanitises the content zone, so the iframe survives import and
later edits.

## 9. Blog: 21 posts move with their URLs

**Migration.** `node tools/scrape-webflow-blog.cjs --index
https://www.healthwiseclonmel.ie/blog --prefix /post/ --site-slug healthwise
--site-host www.healthwiseclonmel.ie --assets app/public/sites/healthwise/blog
--drop-cover logo --out app/public/sites/healthwise/_posts.json`, reviewed
with `--report`, committed. `syncBundledSites()` seeds the posts at boot:
published, create-only, blank-fill, never overwriting a post DJ edits.
Blog pages wear the site chrome lifted from the home page.

**Redirects (platform change).** A generic per-site redirect map so old
URLs keep working without another hard-coded route:
`app/public/sites/<slug>/_redirects.json`, hand-authored and committed:

```json
{
  "/post/:slug": "/blog/:slug",
  "/about-healthwise": "/about",
  "/classes-timetable": "/classes",
  "/contact-page": "/contact",
  "/sign-up": "/contact",
  "/inspire-health-fitness": "https://inspirehealthandfitness.ie"
}
```

`app/src/lib/cms/siteRedirects.ts`: `resolveSiteRedirect(slug, path)` loads
and caches the map, matches exact paths first, then single-`:param`
patterns, and returns the target with the param substituted, or `null`.
The site catch-all (`app/site/[siteSlug]/[...slug]/page.tsx`) consults it
after the page lookup fails and before `notFound()`: a root-relative target
is prefixed with `/site/<slug>` unless the site was resolved by host
(exactly the Inspire `blog-posts` route's logic); a `/blog/:slug` target is
only issued when that post exists and is published; an absolute `https://`
target is issued as-is; all as 308 via `permanentRedirect`. Inspire's
existing route is left alone.

## 10. Import, publish, go-live

1. **Local:** `node tools/create-account.cjs --slug healthwise --name
   Healthwise` (dev tenant), then `node tools/import-site.cjs --tenant
   healthwise --slug healthwise --name "Healthwise"`. Preview at
   `/site/healthwise`, open every page with `?cmsedit=1`.
2. **Bundle:** `node tools/build-site-bundle.cjs --slug healthwise --tenant
   healthwise`; commit `app/public/sites/healthwise/` (`_pages.json`,
   `_posts.json`, `_redirects.json`, assets, blog images).
3. **Deploy** (`cd app && railway up`); the boot sync publishes into tenant
   1415. `tools/push-site-to-prod.cjs` is the immediate alternative.
4. **Tracking:** set the CMS site's `googleTagId` = `G-F46FGCY1D3` and
   `metaPixelId` = `495090635138220` (the platform's `SiteTracking` injects
   both; the site's own HTML carries neither).
5. **Domain:** CMS → Domains → add `healthwiseclonmel.ie` and
   `www.healthwiseclonmel.ie`, publish the `_adonisagent-verify.<host>` TXT
   records, verify; set the primary host; append
   `www.healthwiseclonmel.ie=healthwise,healthwiseclonmel.ie=healthwise` to
   `CMS_SITE_HOSTS`; point DNS at Railway; switch Webflow off. Sitemap and
   robots are per host automatically.

## 11. Testing and acceptance

**Unit** (all under `app/`, `npm test`): `enquiryToken.test.ts` (round
trip, tampered, wrong claim kind, missing secret); `api/site/enquiry/route.test.ts`
(forged/tampered/missing token → 400; honeypot → 200 and no lead; both
encodings; rate limit; the lead lands in the token's tenant and no other);
`siteRedirects.test.ts` (exact, `:slug`, absolute, no match, blog-existence
gate); template placeholder substitution (present → replaced everywhere,
absent → body byte-identical); a pageBody round-trip over the eight built
pages.

**Visual:** screenshot pass of every page at 1440 and 390, as static files
and after import, plus the Studio canvas for each; the LegitFit panel loads
inside the page.

**Acceptance:** an enquiry submitted on the live site is on the Healthwise
leads board within seconds with programme and notes; each old URL 308s to
the right place; 21 posts with covers under `/blog`; booking completes inside
the classes page; every page opens in Studio and a small text edit publishes
and survives the next deploy.

## 12. Needs the client (does not block the build)

- A portrait of DJ, even a phone photo by the studio window.
- Confirm the Eircode (E91 A6F4 vs the flyer's E91 E049).
- Confirm class hours to print ("from 7am, mornings and evenings") and
  whether Saturday runs.
- Confirm the grey-brick room with the green turf is Healthwise's, not
  Inspire's, before it is used as a "strength room" photograph.
- The three blog posts to feature on the home page (default: the three
  most recent).

## 13. Out of scope

Moving off LegitFit; the member app; any pricing on the site; the Drivewise
site itself; changing Inspire's existing redirect route.
