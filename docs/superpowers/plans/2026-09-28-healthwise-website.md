# Healthwise Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and launch the Healthwise website (healthwiseclonmel.ie) as a bespoke tenant site on AdonisAgent — direction A, "the consultation" — with an enquiry form that lands as a lead, LegitFit booking embedded, 21 blog posts migrated, and old URLs redirecting.

**Architecture:** Static pages in `sites/healthwise/` are composed by a build script into standalone HTML (head = fonts and one stylesheet, content, tail = scripts), imported into the CMS by the existing importer, published by the site bundle on deploy, and served on the client's domain. Two small platform additions: a site-scoped HMAC enquiry token + `POST /api/site/enquiry` (mirrors the campaign signup model), and a per-site `_redirects.json` consulted by the public site's catch-all route before it 404s.

**Tech Stack:** Node 22 ESM build scripts, plain HTML/CSS, GSAP 3.12 (CDN), Next.js 14 App Router route handlers, better-sqlite3/drizzle tenant DBs, the repo's `node:assert` test runner (`npm test`), Playwright Chromium for screenshots, fal.ai FLUX 1.1 Pro for photography.

**Spec:** `docs/superpowers/specs/2026-09-28-healthwise-website-design.md` — read sections 2 (facts), 4 (visual system) and 5 (photography) before Tasks 5–8.

## Global Constraints

- **No emojis** anywhere: code, comments, copy, commit messages, replies.
- Tenant: `healthwise`, id 1415 in production. Site slug: `healthwise`. Never import into another tenant.
- Brand tokens, exact: navy `#28245C`, red `#EA1C28`, red-dark `#BB1620`, red-tint `#FCE8E9`, ink `#241A1B`, mid `#544D4D`, mute `#858080` (never for text), surf `#F2F2F2`, white `#FFFFFF`. Red is used only for the pulse line and the primary button. Red is never a ground.
- Type: Manrope 800 display, Open Sans 400/600 text, Google Fonts. Body 18px desktop, 17px mobile, line-height 1.6, max 60ch. Nothing lighter than 400.
- Every call to action reads exactly **Book a consultation** and links to `contact.html#book`. Never write "free consultation". Never print a price. Never promise a health outcome (supports, helps, coached — not cures, fixes, reverses).
- Every emitted page: `<header class="nav">` and `<footer class="foot">` elements (the CMS lifts them as chrome); fonts `<link>` + one `<style>` in the head; GSAP `<script>`s last in the body; no `<style>` or `<script>` inside the content; must pass `studioEditability` (Task 5 step 6 shows the check).
- Assets live under `sites/healthwise/assets/` only (the importer copies `assets/`, `logo/`, `fonts/`); referenced as `assets/...` in HTML; JPEGs under 250KB, 1600px long edge (hero 2x = 1600 wide at 4:5).
- Internal links between pages are `name.html` (the importer rewrites them); links to blog posts are `/site/healthwise/blog/<slug>` (the shape Inspire's live site uses).
- Before any deploy: `cd app && npm run typecheck && npm test && npx next build` all pass. Deploy is `cd app && railway up`. Commit to `main` first.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tests are plain `node:assert/strict` scripts named `*.test.ts` under `app/src/`, run with `cd app && npm test -- <path>`; each prints its own passed line and exits non-zero on failure. Route tests use the `Module._load` shim exactly as `src/app/f/[slug]/submit/route.test.ts` does.

---

## File Structure

**Platform (app/src):**
- `lib/signedToken.ts` — the one HMAC primitive (sign a claim, verify + parse a token), shared by the campaign signup token and the site enquiry token. Pure.
- `lib/campaigns/signupToken.ts` — refactored onto `lib/signedToken.ts`; wire format, behaviour and tests unchanged.
- `lib/cms/enquiryToken.ts` — the site-enquiry claim's shape on top of the primitive; the `__ADONIS_ENQUIRY_TOKEN__` placeholder substitution. Pure, no DB.
- `lib/cms/enquiry.ts` — validation of the enquiry form fields, honeypot, safe return path, notes text. Pure.
- `lib/publicFormExchange.ts` — how a public form talks to a route: JSON-or-url-encoded field parsing and the JSON-or-303 reply. Shared by `f/[slug]/submit` and `api/site/enquiry`.
- `app/f/[slug]/submit/route.ts` — refactored onto `lib/publicFormExchange.ts`; behaviour and test unchanged.
- `app/api/site/enquiry/route.ts` — the public POST handler, creates the lead inside `runWithTenant`.
- `lib/cms/siteRedirects.ts` — loads `public/sites/<slug>/_redirects.json`, matches exact and `:param` patterns. Pure apart from `fs`.
- `components/cms/Block.tsx` — `RenderCtx` gains `tenantId`.
- `lib/cms/render.ts` — sets `ctx.tenantId`.
- `lib/cms/sites/renova/templates.tsx` — `clientflow-live` substitutes the placeholder.
- `app/site/[siteSlug]/[...slug]/page.tsx` — consults the redirect map before `notFound()`.
- `public/sites/healthwise/_redirects.json` — the Healthwise map (hand-authored, committed).

**Site (sites/healthwise):**
- `_style.css` — the whole design; inlined into every page.
- `build.mjs` — nav, footer, enquiry strip, scripts, page shell, per-page metadata; emits `*.html` at the folder root.
- `pages/{home,livewell,vitality,heartwise,classes,about,contact,drivewise}.html` — body partials.
- `photos.mjs` — the photography pipeline (generate candidates, pick, grade).
- `shots.mjs` — screenshot every built page at two widths.
- `assets/` — brand marks, `pulse.svg`, real photos, the picked AI photographs. `assets/ai/` (candidates) is gitignored.

**Bundle (app/public/sites/healthwise):** `_pages.json` (from `tools/build-site-bundle.cjs`), `_posts.json` + `blog/` (from `tools/scrape-webflow-blog.cjs`), `_redirects.json`, and the copied assets.

---

### Task 1: Shared signed-token helper and the site enquiry token

**Files:**
- Create: `app/src/lib/signedToken.ts`
- Test: `app/src/lib/signedToken.test.ts`
- Modify: `app/src/lib/campaigns/signupToken.ts` (use the helper; wire format and behaviour unchanged; `app/src/lib/campaigns/signupToken.test.ts` must pass UNCHANGED)
- Create: `app/src/lib/cms/enquiryToken.ts`
- Test: `app/src/lib/cms/enquiryToken.test.ts`

**Interfaces:**
- Produces: `signTokenPayload(claim: object): string | null`, `readTokenPayload(token: string): Record<string, unknown> | null`, `getTokenSecret(): string | null` in `@/lib/signedToken`; `ENQUIRY_TOKEN_PLACEHOLDER = "__ADONIS_ENQUIRY_TOKEN__"`, `signSiteEnquiryToken({tenantId, siteId}): string` (throws when `EMAIL_TOKEN_SECRET` unset), `verifySiteEnquiryToken(token): {tenantId, siteId} | null`, `injectEnquiryToken(body: string, mint: () => string): string` in `@/lib/cms/enquiryToken`.
- Decision (pre-flight, 2026-09-28): the HMAC primitive is SHARED, not mirrored. The campaign token keeps its own shape checks and its own module; only `sign`, `getSecret` and the signature/parse block move into the helper.

- [ ] **Step 1: Write the failing helper test**

`app/src/lib/signedToken.test.ts`:

```ts
// Run: npm test -- src/lib/signedToken.test.ts
//
// The one HMAC primitive behind every server-minted browser token. Round
// trip, tamper detection on payload and signature, malformed shapes never
// throw, fail closed without EMAIL_TOKEN_SECRET, and non-object payloads
// (arrays, strings) come back null so callers can shape-check an object.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { getTokenSecret, readTokenPayload, signTokenPayload } from "./signedToken";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-signed-token-secret-do-not-use";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;

function buildToken(payloadText: string, secret: string): string {
  const payload = Buffer.from(payloadText, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

try {
  process.env.EMAIL_TOKEN_SECRET = SECRET;
  check("secret is read", getTokenSecret() === SECRET);

  const token = signTokenPayload({ a: 1, b: "two" });
  check("sign returns payload.signature", typeof token === "string" && token.split(".").length === 2);
  const back = readTokenPayload(token!);
  check("round-trip object", back?.a === 1 && back?.b === "two");
  check("hand-built token with the same secret reads", readTokenPayload(buildToken(JSON.stringify({ x: 9 }), SECRET))?.x === 9);

  const [payload, sig] = token!.split(".");
  const other = Buffer.from(JSON.stringify({ a: 2, b: "two" }), "utf8").toString("base64url");
  check("payload swap fails", readTokenPayload(`${other}.${sig}`) === null);
  const flipped = sig!.endsWith("A") ? sig!.slice(0, -1) + "B" : sig!.slice(0, -1) + "A";
  check("flipped signature char fails", readTokenPayload(`${payload}.${flipped}`) === null);
  check("wrong secret fails", readTokenPayload(buildToken(JSON.stringify({ x: 1 }), "another-secret")) === null);

  check("empty -> null", readTokenPayload("") === null);
  check("no dot -> null", readTokenPayload("abc") === null);
  check("two dots -> null", readTokenPayload("a.b.c") === null);
  check("empty payload part -> null", readTokenPayload(`.${sig}`) === null);
  check("non-JSON payload -> null", readTokenPayload(buildToken("not json", SECRET)) === null);
  check("array payload -> null", readTokenPayload(buildToken("[1,2]", SECRET)) === null);
  check("string payload -> null", readTokenPayload(buildToken("\"str\"", SECRET)) === null);
  check("null payload -> null", readTokenPayload(buildToken("null", SECRET)) === null);
  check("non-string token -> null", readTokenPayload(undefined as unknown as string) === null);

  delete process.env.EMAIL_TOKEN_SECRET;
  check("no secret -> getTokenSecret null", getTokenSecret() === null);
  check("no secret -> sign null", signTokenPayload({ a: 1 }) === null);
  check("no secret -> read null even for a valid token", readTokenPayload(token!) === null);

  console.log(`signedToken.test.ts: ${passed} checks passed`);
} finally {
  if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalSecret;
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/signedToken.test.ts`
Expected: FAIL — `Cannot find module './signedToken'`.

- [ ] **Step 3: Write the helper**

`app/src/lib/signedToken.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The one HMAC token primitive behind every server-minted claim the platform
 * hands to a browser — the campaign signup token (lib/campaigns/signupToken)
 * and the site enquiry token (lib/cms/enquiryToken). It signs a JSON claim,
 * verifies a signature in constant time, and returns the parsed payload for
 * the caller to shape-check; what a claim MEANS stays with each token kind.
 *
 * Wire format: `<base64url(payload)>.<base64url(HMAC-SHA256(secret, payloadB64))>`
 * where the HMAC is computed over the base64url payload text. The secret is
 * EMAIL_TOKEN_SECRET, read fresh on every call with no dev fallback, so sign
 * and read always agree on whether one exists (see signupToken.ts's header
 * for why a silent fallback is the worse failure). Reading fails closed:
 * every bad case is `null`, never a throw, so a public route answers one 400.
 *
 * Extracted from signupToken.ts (2026-09-28) when a second token kind
 * needed the same primitive; the wire format did not change.
 */
export function getTokenSecret(): string | null {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  return secret ? secret : null;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Mint a token for a JSON-serialisable claim. Null when the secret is unset — the caller decides whether that throws. */
export function signTokenPayload(claim: object): string | null {
  const secret = getTokenSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify(claim), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify a token's signature and return its parsed object payload, or null
 * for every failure: unset secret, wrong shape, bad signature, undecodable
 * payload, or a payload that is not a plain object. Constant-time compare
 * (length check, then timingSafeEqual, never `===`).
 */
export function readTokenPayload(token: string): Record<string, unknown> | null {
  const secret = getTokenSecret();
  if (!secret) return null;
  if (typeof token !== "string" || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the helper test**

Run: `cd app && npm test -- src/lib/signedToken.test.ts`
Expected: `signedToken.test.ts: 19 checks passed`.

- [ ] **Step 5: Refactor the campaign token onto the helper**

In `app/src/lib/campaigns/signupToken.ts`:

1. Replace the import `import { createHmac, timingSafeEqual } from "node:crypto";` with `import { readTokenPayload, signTokenPayload } from "@/lib/signedToken";`.
2. Delete the local `sign()` function, the local `getSecret()` function and their doc comments (the header comment above them stays; add one line to it: `The HMAC primitive itself lives in lib/signedToken.ts, shared with the site enquiry token.`).
3. `signCampaignSignupToken` keeps its argument guard exactly as it is, then becomes:

```ts
  const token = signTokenPayload({ t: tenantId, c: campaignId });
  if (!token) {
    throw new Error(
      "[campaigns] EMAIL_TOKEN_SECRET is not set — refusing to mint a campaign-signup token. " +
        "Set EMAIL_TOKEN_SECRET before rendering a campaign landing page.",
    );
  }
  return token;
```

4. `verifyCampaignSignupToken` keeps its doc comment and becomes:

```ts
export function verifyCampaignSignupToken(token: string): CampaignSignupClaim | null {
  const obj = readTokenPayload(token);
  if (!obj) return null;

  const tenantId = obj.t;
  const campaignId = obj.c;
  if (typeof tenantId !== "number" || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    return null;
  }
  if (typeof campaignId !== "number" || !Number.isSafeInteger(campaignId) || campaignId <= 0) {
    return null;
  }

  return { tenantId, campaignId };
}
```

Nothing else in the file changes. Do NOT edit `signupToken.test.ts`.

- [ ] **Step 6: Prove the campaign token is unchanged**

Run: `cd app && npm test -- src/lib/campaigns/signupToken.test.ts && npm test -- src/lib/campaigns/signup.test.ts`
Expected: both pass with the same check counts they printed before (run `git stash; npm test -- src/lib/campaigns/signupToken.test.ts; git stash pop` first if you want the "before" number in front of you).

- [ ] **Step 7: Write the failing enquiry-token test**

`app/src/lib/cms/enquiryToken.test.ts`:

```ts
// Run: npm test -- src/lib/cms/enquiryToken.test.ts
//
// The site-enquiry token is the ONLY thing that names a tenant for
// POST /api/site/enquiry — the browser never sends a slug or id. Built on
// lib/signedToken (which owns the crypto tests); this file covers what THIS
// claim means: its shape, that a CAMPAIGN token ({t, c}) signed with the
// same secret never verifies as an enquiry claim, fail-closed behaviour, and
// the placeholder substitution the verbatim template performs at render.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  ENQUIRY_TOKEN_PLACEHOLDER,
  injectEnquiryToken,
  signSiteEnquiryToken,
  verifySiteEnquiryToken,
} from "./enquiryToken";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-site-enquiry-secret-do-not-use";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;

function buildToken(payloadText: string, secret: string): string {
  const payload = Buffer.from(payloadText, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

try {
  process.env.EMAIL_TOKEN_SECRET = SECRET;

  // round trip
  const token = signSiteEnquiryToken({ tenantId: 1415, siteId: 7 });
  check("token is payload.signature", token.split(".").length === 2);
  const claim = verifySiteEnquiryToken(token);
  check("round-trip tenantId", claim?.tenantId === 1415);
  check("round-trip siteId", claim?.siteId === 7);
  check("different siteId -> different token", signSiteEnquiryToken({ tenantId: 1415, siteId: 8 }) !== token);

  // tamper: payload
  const [payload, sig] = token.split(".");
  const otherPayload = Buffer.from(JSON.stringify({ t: 1, s: 7, k: "enquiry" }), "utf8").toString("base64url");
  check("payload swapped to another tenant fails", verifySiteEnquiryToken(`${otherPayload}.${sig}`) === null);
  // tamper: signature
  const flipped = sig.endsWith("A") ? sig.slice(0, -1) + "B" : sig.slice(0, -1) + "A";
  check("one flipped signature char fails", verifySiteEnquiryToken(`${payload}.${flipped}`) === null);

  // shape
  check("empty string -> null", verifySiteEnquiryToken("") === null);
  check("no dot -> null", verifySiteEnquiryToken("abc") === null);
  check("two dots -> null", verifySiteEnquiryToken("a.b.c") === null);
  check("garbage payload, valid sig -> null", verifySiteEnquiryToken(buildToken("not json", SECRET)) === null);
  check("wrong kind -> null", verifySiteEnquiryToken(buildToken(JSON.stringify({ t: 1, s: 7, k: "other" }), SECRET)) === null);
  check("campaign-shaped claim never verifies as enquiry",
    verifySiteEnquiryToken(buildToken(JSON.stringify({ t: 1, c: 7 }), SECRET)) === null);
  check("non-integer ids -> null", verifySiteEnquiryToken(buildToken(JSON.stringify({ t: "1", s: 7, k: "enquiry" }), SECRET)) === null);
  check("zero id -> null", verifySiteEnquiryToken(buildToken(JSON.stringify({ t: 0, s: 7, k: "enquiry" }), SECRET)) === null);

  // sign guards
  assert.throws(() => signSiteEnquiryToken({ tenantId: 0, siteId: 7 }), /positive integers/);
  passed++; console.log("  ✓ sign refuses a non-positive tenantId");

  // injection
  const bodyNo = "<form><input name=\"token\" value=\"x\"></form>";
  check("no placeholder -> body byte-identical", injectEnquiryToken(bodyNo, () => "T") === bodyNo);
  let minted = 0;
  injectEnquiryToken(bodyNo, () => { minted++; return "T"; });
  check("no placeholder -> mint never called", minted === 0);
  const bodyYes = `<input value="${ENQUIRY_TOKEN_PLACEHOLDER}"><span>${ENQUIRY_TOKEN_PLACEHOLDER}</span>`;
  const out = injectEnquiryToken(bodyYes, () => "TOK");
  check("placeholder replaced everywhere", out === "<input value=\"TOK\"><span>TOK</span>");
  const outThrow = injectEnquiryToken(bodyYes, () => { throw new Error("no secret"); });
  check("mint failure -> empty token, page still renders", outThrow === "<input value=\"\"><span></span>");

  // fail closed without a secret
  delete process.env.EMAIL_TOKEN_SECRET;
  check("no secret -> verify null even for a previously valid token", verifySiteEnquiryToken(token) === null);
  assert.throws(() => signSiteEnquiryToken({ tenantId: 1, siteId: 1 }), /EMAIL_TOKEN_SECRET/);
  passed++; console.log("  ✓ no secret -> sign throws");

  console.log(`enquiryToken.test.ts: ${passed} checks passed`);
} finally {
  if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalSecret;
}
```

- [ ] **Step 8: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/cms/enquiryToken.test.ts`
Expected: FAIL — `Cannot find module './enquiryToken'`.

- [ ] **Step 9: Write the enquiry token**

`app/src/lib/cms/enquiryToken.ts`:

```ts
import { readTokenPayload, signTokenPayload } from "@/lib/signedToken";

/**
 * The site-enquiry token: how a bespoke site's contact form proves which
 * tenant it belongs to without the browser ever naming one.
 *
 * Same trust model as lib/campaigns/signupToken.ts (read its header for the
 * vulnerability this design closes): the verbatim page template mints a
 * token at render time, HMAC-signed with the server-only EMAIL_TOKEN_SECRET,
 * encoding {tenantId, siteId}. POST /api/site/enquiry verifies it and writes
 * the lead into THAT tenant. The claim carries `k: "enquiry"` and a campaign
 * token carries `c`, so neither shape verifies as the other even though they
 * share a secret and the primitive in lib/signedToken.ts.
 *
 * The placeholder is a literal string the site's HTML carries in its hidden
 * `token` field. Sites that never wrote it are untouched by injection.
 */
export const ENQUIRY_TOKEN_PLACEHOLDER = "__ADONIS_ENQUIRY_TOKEN__";

export interface SiteEnquiryClaim {
  tenantId: number;
  siteId: number;
}

/** Mint a signed, non-expiring token for (tenantId, siteId). Throws loudly when the secret is unset. */
export function signSiteEnquiryToken(input: { tenantId: number; siteId: number }): string {
  const { tenantId, siteId } = input;
  if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(siteId) || siteId <= 0) {
    throw new Error(
      `[cms] signSiteEnquiryToken: tenantId and siteId must be positive integers (got ${tenantId}, ${siteId}).`,
    );
  }
  const token = signTokenPayload({ t: tenantId, s: siteId, k: "enquiry" });
  if (!token) {
    throw new Error(
      "[cms] EMAIL_TOKEN_SECRET is not set — refusing to mint a site-enquiry token. Set EMAIL_TOKEN_SECRET before rendering a bespoke site.",
    );
  }
  return token;
}

/** Verify + decode. Fails CLOSED with `null` for every bad case (see readTokenPayload) plus the wrong claim kind or ids. */
export function verifySiteEnquiryToken(token: string): SiteEnquiryClaim | null {
  const obj = readTokenPayload(token);
  if (!obj) return null;
  if (obj.k !== "enquiry") return null;
  const t = obj.t;
  const s = obj.s;
  if (typeof t !== "number" || !Number.isSafeInteger(t) || t <= 0) return null;
  if (typeof s !== "number" || !Number.isSafeInteger(s) || s <= 0) return null;
  return { tenantId: t, siteId: s };
}

/**
 * Replace every placeholder in a page body with a freshly minted token. A body
 * without the placeholder is returned as-is and `mint` is never called, so
 * every other bespoke site renders byte-for-byte as before. If minting throws
 * (no secret on this machine) the placeholder becomes "" — the form then gets
 * a 400 on submit, which is visible, rather than the whole page failing.
 */
export function injectEnquiryToken(body: string, mint: () => string): string {
  if (!body.includes(ENQUIRY_TOKEN_PLACEHOLDER)) return body;
  let token = "";
  try {
    token = mint();
  } catch (err) {
    console.error("[cms] site enquiry token could not be minted:", err instanceof Error ? err.message : err);
  }
  return body.split(ENQUIRY_TOKEN_PLACEHOLDER).join(token);
}
```

- [ ] **Step 10: Run the enquiry test, then typecheck and the whole suite**

Run: `cd app && npm test -- src/lib/cms/enquiryToken.test.ts`
Expected: `enquiryToken.test.ts: 21 checks passed`.

Run: `cd app && npm run typecheck && npm test`
Expected: typecheck prints nothing; every test file passes.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/signedToken.ts app/src/lib/signedToken.test.ts app/src/lib/campaigns/signupToken.ts app/src/lib/cms/enquiryToken.ts app/src/lib/cms/enquiryToken.test.ts
git commit -m "feat(cms): a bespoke site can prove which tenant its enquiry form belongs to

One HMAC primitive (lib/signedToken) now serves both the campaign signup
token and the new site enquiry token; the campaign token's wire format and
tests are unchanged.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Mint the token at render

**Files:**
- Modify: `app/src/components/cms/Block.tsx:9-14` (RenderCtx)
- Modify: `app/src/lib/cms/render.ts:59-64` (the RenderCtx literal)
- Modify: `app/src/lib/cms/sites/renova/templates.tsx` (the `clientflow-live` Component)

**Interfaces:**
- Consumes: `injectEnquiryToken`, `signSiteEnquiryToken` from Task 1.
- Produces: `RenderCtx.tenantId: number` (every other constructor of `RenderCtx` in the repo is `lib/cms/render.ts:59` — verified with `grep -rn "RenderCtx = {"`).

- [ ] **Step 1: Add `tenantId` to `RenderCtx`**

In `app/src/components/cms/Block.tsx` change the interface to:

```ts
export interface RenderCtx {
  db: TenantDb;
  /** The tenant that owns the site — needed to mint tokens that name it (lib/cms/enquiryToken). */
  tenantId: number;
  siteId: number;
  siteSlug: string;
  pageId: number;
}
```

- [ ] **Step 2: Set it in `resolvePageContext`**

In `app/src/lib/cms/render.ts` the literal at line 59 becomes:

```ts
  const ctx: RenderCtx = {
    db: resolved.db,
    tenantId: resolved.tenantId,
    siteId: resolved.site.id,
    siteSlug: resolved.site.slug,
    pageId: page.id,
  };
```

- [ ] **Step 3: Substitute in the verbatim template**

In `app/src/lib/cms/sites/renova/templates.tsx`, add the import at the top with the others:

```ts
import { injectEnquiryToken, signSiteEnquiryToken } from "@/lib/cms/enquiryToken";
```

and replace the `clientflow-live` registration's Component with:

```tsx
  Component: ({ ctx }) => {
    const row = getBlockValue(ctx.db, ctx.siteId, ctx.pageId, "body");
    // Verbatim render: first-party HTML with its own styles + scripts. Server-
    // rendered, so the browser runs the scripts on load. The one substitution:
    // a page carrying the enquiry placeholder gets a token minted for THIS
    // tenant and site, so its form can post to /api/site/enquiry. Pages
    // without it are returned untouched (see injectEnquiryToken).
    const html = injectEnquiryToken(row?.value ?? "", () =>
      signSiteEnquiryToken({ tenantId: ctx.tenantId, siteId: ctx.siteId }),
    );
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  },
```

- [ ] **Step 4: Typecheck and run the whole suite**

Run: `cd app && npm run typecheck && npm test`
Expected: typecheck prints nothing; all test files pass (the count is whatever the suite has, currently 223 with Task 1's file).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/cms/Block.tsx app/src/lib/cms/render.ts app/src/lib/cms/sites/renova/templates.tsx
git commit -m "feat(cms): the verbatim template mints an enquiry token for the page it renders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Enquiry validation, the shared form exchange, and the public route

**Files:**
- Create: `app/src/lib/cms/enquiry.ts`
- Test: `app/src/lib/cms/enquiry.test.ts`
- Create: `app/src/lib/publicFormExchange.ts`
- Modify: `app/src/app/f/[slug]/submit/route.ts` (use the shared exchange; behaviour unchanged; `app/src/app/f/[slug]/submit/route.test.ts` must pass UNCHANGED)
- Create: `app/src/app/api/site/enquiry/route.ts`
- Test: `app/src/app/api/site/enquiry/route.test.ts`

**Interfaces:**
- Consumes: `verifySiteEnquiryToken`, `signSiteEnquiryToken` (Task 1); `rateLimit(key, limit, windowMs)`, `clientIp(req)` from `@/lib/rateLimit`; `runWithTenant(tenantId, fn)` from `@/lib/db/tenant`; `upsertLead(input): {lead, created}` from `@/lib/leads`; `logActivity(type, message, meta)` from `@/lib/queries`.
- Produces: `ENQUIRY_HONEYPOT_FIELD = "company_website"`, `validateEnquiry(fields): {ok:true, data: ValidEnquiry} | {ok:false, error}`, `safeReturnPath(v, fallback)`, `enquiryNotes(data)`; `isJsonExchange(req)`, `parsePublicFormFields(req, rawText): Record<string,string>` (throws on malformed JSON), `respondPublicForm(req, returnPath, ok, {status?, error?, extra?, headers?})` in `@/lib/publicFormExchange`; and `POST /api/site/enquiry` accepting fields `name, phone, email, programme, about, token, return, company_website`.
- Decision (pre-flight, 2026-09-28): the JSON/url-encoded exchange is SHARED with `f/[slug]/submit`, not mirrored.

- [ ] **Step 1: Write the failing validation test**

`app/src/lib/cms/enquiry.test.ts`:

```ts
// Run: npm test -- src/lib/cms/enquiry.test.ts
import assert from "node:assert/strict";

import { ENQUIRY_HONEYPOT_FIELD, enquiryNotes, isEnquiryHoneypotTripped, safeReturnPath, validateEnquiry } from "./enquiry";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const good = validateEnquiry({ name: "  Mary Byrne ", phone: "086 123 4567", programme: "vitality", about: "Had a stent in March." });
check("valid -> ok", good.ok);
if (good.ok) {
  check("name trimmed", good.data.name === "Mary Byrne");
  check("email null when blank", good.data.email === null);
  check("programme kept", good.data.programme === "vitality");
  check("notes carry programme label and about", enquiryNotes(good.data) === "Programme: Vitality 60+\nAbout: Had a stent in March.");
}
check("unknown programme -> unsure", (() => { const r = validateEnquiry({ name: "A", phone: "1", programme: "hacker" }); return r.ok && r.data.programme === "unsure"; })());
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

console.log(`enquiry.test.ts: ${passed} checks passed`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/cms/enquiry.test.ts`
Expected: FAIL — `Cannot find module './enquiry'`.

- [ ] **Step 3: Write the validation module**

`app/src/lib/cms/enquiry.ts`:

```ts
/**
 * The bespoke-site enquiry form's fields, validated once, here, for both the
 * JSON and the url-encoded path of POST /api/site/enquiry. Pure: no DB, no
 * request object. Mirrors lib/campaigns/signup.ts's shape and caps.
 */
export const ENQUIRY_PROGRAMMES = ["livewell", "vitality", "heartwise", "unsure"] as const;
export type EnquiryProgramme = (typeof ENQUIRY_PROGRAMMES)[number];

const PROGRAMME_LABEL: Record<EnquiryProgramme, string> = {
  livewell: "Livewell 40–60",
  vitality: "Vitality 60+",
  heartwise: "Heartwise",
  unsure: "Not sure yet",
};

export const ENQUIRY_HONEYPOT_FIELD = "company_website";

export interface ValidEnquiry {
  name: string;
  email: string | null;
  phone: string | null;
  programme: EnquiryProgramme;
  about: string | null;
}

export type ValidateEnquiryResult = { ok: true; data: ValidEnquiry } | { ok: false; error: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_PHONE = 60;
const MAX_ABOUT = 1000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isEnquiryHoneypotTripped(fields: Record<string, string>): boolean {
  return asString(fields[ENQUIRY_HONEYPOT_FIELD]).length > 0;
}

export function validateEnquiry(fields: Record<string, string>): ValidateEnquiryResult {
  const name = asString(fields.name);
  if (!name) return { ok: false, error: "Please enter your name." };
  if (name.length > MAX_NAME) return { ok: false, error: "That name is too long." };

  const email = asString(fields.email);
  if (email.length > MAX_EMAIL) return { ok: false, error: "That email address is too long." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "Please check the email address." };

  const phone = asString(fields.phone);
  if (phone.length > MAX_PHONE) return { ok: false, error: "That phone number is too long." };
  if (!email && !phone) return { ok: false, error: "Please give a phone number or an email address so we can reply." };

  const rawProgramme = asString(fields.programme);
  const programme: EnquiryProgramme = (ENQUIRY_PROGRAMMES as readonly string[]).includes(rawProgramme)
    ? (rawProgramme as EnquiryProgramme)
    : "unsure";

  const about = asString(fields.about);
  if (about.length > MAX_ABOUT) return { ok: false, error: "Please keep the message under 1000 characters." };

  return {
    ok: true,
    data: { name, email: email || null, phone: phone || null, programme, about: about || null },
  };
}

/**
 * The no-JS fallback bounces back to the page the form was on. That path is
 * client input, so it is accepted only as a root-relative path: no scheme, no
 * protocol-relative "//host", no backslash tricks, query and hash dropped.
 */
export function safeReturnPath(v: unknown, fallback = "/contact"): string {
  const s = asString(v);
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return fallback;
  const bare = s.split("?")[0]!.split("#")[0]!;
  return bare || fallback;
}

/** The lead's notes: what the operator sees on the card. */
export function enquiryNotes(d: ValidEnquiry): string {
  const lines = [`Programme: ${PROGRAMME_LABEL[d.programme]}`];
  if (d.about) lines.push(`About: ${d.about}`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the validation test**

Run: `cd app && npm test -- src/lib/cms/enquiry.test.ts`
Expected: `enquiry.test.ts: 20 checks passed`.

- [ ] **Step 4b: Extract the shared form exchange and move `f/[slug]/submit` onto it**

Create `app/src/lib/publicFormExchange.ts`:

```ts
/**
 * How a public form talks to a route. Two exchanges, branched on Content-Type
 * and Accept: a page's fetch (JSON in, JSON out) and a plain <form> post with
 * JavaScript off (url-encoded in, a 303 back to the page with `?ok=1` or
 * `?err=…` out, which the page reads). Shared by f/[slug]/submit and
 * api/site/enquiry so the two public forms cannot drift in how they answer.
 *
 * Plain Request/Response, not next/server, so the routes that use this load
 * in the test runner (see f/[slug]/submit/route.ts's banner for the reason).
 */
export function isJsonExchange(req: Request): boolean {
  const accept = req.headers.get("accept") || "";
  const contentType = req.headers.get("content-type") || "";
  return accept.includes("application/json") || contentType.includes("application/json");
}

/**
 * The submitted fields as flat strings, whichever way they arrived. Throws on
 * malformed JSON — the caller turns that into its own 400.
 */
export function parsePublicFormFields(req: Request, rawText: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (isJsonExchange(req)) {
    const body: unknown = rawText ? JSON.parse(rawText) : {};
    if (body && typeof body === "object") {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        fields[k] = v == null ? "" : String(v);
      }
    }
  } else {
    for (const [k, v] of new URLSearchParams(rawText).entries()) fields[k] = v;
  }
  return fields;
}

export interface PublicFormReply {
  status?: number;
  error?: string;
  /** Extra JSON fields for a fetch caller (a lead id, a created flag). Ignored on the redirect path. */
  extra?: Record<string, unknown>;
  headers?: HeadersInit;
}

/** JSON callers get `{ok, error, ...extra}`; a plain form post is bounced to `returnPath` with the outcome in the query. */
export function respondPublicForm(req: Request, returnPath: string, ok: boolean, opts: PublicFormReply = {}): Response {
  if (isJsonExchange(req)) {
    return Response.json(
      { ok, error: opts.error, ...(opts.extra ?? {}) },
      { status: opts.status ?? (ok ? 200 : 400), headers: opts.headers },
    );
  }
  const url = new URL(returnPath, req.url);
  url.search = ok ? "ok=1" : `err=${encodeURIComponent(opts.error || "Something went wrong.")}`;
  return Response.redirect(url.toString(), 303);
}
```

Then in `app/src/app/f/[slug]/submit/route.ts`:

1. Add `import { parsePublicFormFields, respondPublicForm } from "@/lib/publicFormExchange";`.
2. Delete the local `isJsonExchange` and `respond` functions.
3. Replace every call `respond(req, slug, X, Y)` with `respondPublicForm(req, \`/f/${slug}\`, X, Y)` (there are seven; `respond(req, slug, true)` becomes `respondPublicForm(req, \`/f/${slug}\`, true)`).
4. Replace the fields-parsing block (from `const fields: Record<string, string> = {};` through the closing `}` of its `catch`) with:

```ts
  let fields: Record<string, string>;
  try {
    fields = parsePublicFormFields(req, rawText);
  } catch {
    return respondPublicForm(req, `/f/${slug}`, false, { status: 400, error: "Please check the form and try again." });
  }
```

5. Update the banner comment's sentence that describes the branching to say the exchange lives in `lib/publicFormExchange.ts`.

Run: `cd app && npm test -- "src/app/f/[slug]/submit/route.test.ts"`
Expected: `f/[slug]/submit/route.test.ts: all assertions passed` — the test file is unchanged.

- [ ] **Step 5: Write the failing route test**

`app/src/app/api/site/enquiry/route.test.ts`:

```ts
// Run: npm test -- src/app/api/site/enquiry/route.test.ts
//
// The public enquiry handler, exercised through the real route with a real
// scratch tenant DB, exactly as src/app/f/[slug]/submit/route.test.ts does
// (same Module._load shim, same reason: react's cache and next/navigation
// cannot load under --conditions=react-server without full React).
//
// Covers: a signed token puts the lead in ITS tenant; a tampered token, a
// campaign-shaped token and a missing token are all one 400 with nothing
// written; honeypot is a silent 200; validation 400; url-encoded no-JS path
// gets a 303 back to a SAFE return path; oversized payload 413; the per-IP
// rate limit; a repeat enquiry from the same contact dedupes to one lead.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const SECRET = "test-site-enquiry-route-secret";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;
process.env.EMAIL_TOKEN_SECRET = SECRET;

(async () => {
  const { controlSqlite } = requireLocal("../../../../lib/db/control") as typeof import("@/lib/db/control");
  const { getTenantDbById } = requireLocal("../../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { leads } = requireLocal("../../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { signSiteEnquiryToken } = requireLocal("../../../../lib/cms/enquiryToken") as typeof import("@/lib/cms/enquiryToken");
  const { POST } = requireLocal("./route") as typeof import("./route");

  const slug = "route-enquiry-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Route Enquiry Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
    if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
    else process.env.EMAIL_TOKEN_SECRET = originalSecret;
  };

  try {
    const tdb = getTenantDbById(tid);
    const leadCount = () => tdb.select({ id: leads.id }).from(leads).all().length;
    const token = signSiteEnquiryToken({ tenantId: tid, siteId: 1 });

    const post = (body: Record<string, string>, ip = "10.77.0.1") =>
      POST(
        new Request("http://localhost/api/site/enquiry", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "x-forwarded-for": ip },
          body: JSON.stringify(body),
        }),
      );

    // 1. a signed token puts the lead in ITS tenant
    assert.equal(leadCount(), 0);
    const r1 = await post({ name: " Mary Byrne ", phone: "086 123 4567", programme: "vitality", about: "Had a stent in March.", token });
    assert.equal(r1.status, 200);
    const b1 = (await r1.json()) as { ok: boolean; created: boolean };
    assert.equal(b1.ok, true);
    assert.equal(b1.created, true);
    assert.equal(leadCount(), 1);
    const lead = tdb.select().from(leads).get();
    assert.equal(lead?.source, "website");
    assert.equal(lead?.firstName, "Mary");
    assert.equal(lead?.lastName, "Byrne");
    assert.equal(lead?.campaign, "Website enquiry");
    assert.match(lead?.notes ?? "", /Programme: Vitality 60\+/);
    assert.match(lead?.notes ?? "", /Had a stent/);

    // 2. a repeat from the same contact dedupes to the same lead
    const r2 = await post({ name: "Mary Byrne", phone: "086 123 4567", programme: "heartwise", token });
    assert.equal(r2.status, 200);
    const b2 = (await r2.json()) as { ok: boolean; created: boolean };
    assert.equal(b2.created, false, "same phone -> existing lead, not a duplicate");
    assert.equal(leadCount(), 1);

    // 3. tampered / campaign-shaped / missing tokens are one 400, nothing written
    //    (own IP: the route counts a rejected request against the caller's
    //    budget, and this file must never trip its own rate limit by accident)
    const [payload, sig] = token.split(".");
    const flipped = sig!.endsWith("A") ? sig!.slice(0, -1) + "B" : sig!.slice(0, -1) + "A";
    const bad = [
      `${payload}.${flipped}`,
      (() => { const p = Buffer.from(JSON.stringify({ t: tid, c: 1 }), "utf8").toString("base64url"); return `${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`; })(),
      "",
    ];
    for (const badToken of bad) {
      const r = await post({ name: "Eve", phone: "1", token: badToken }, "10.77.0.3");
      assert.equal(r.status, 400, `bad token "${badToken.slice(0, 12)}" -> 400`);
      const b = (await r.json()) as { ok: boolean; error: string };
      assert.equal(b.error, "Invalid or missing token.");
    }
    assert.equal(leadCount(), 1, "no bad-token request wrote a lead");

    // 4. honeypot: silent 200, nothing written (answered before the throttle, so not counted)
    const r4 = await post({ name: "Bot", phone: "1", token, company_website: "http://spam.example" });
    assert.equal(r4.status, 200);
    assert.equal(((await r4.json()) as { ok: boolean }).ok, true);
    assert.equal(leadCount(), 1);

    // 5. validation
    const r5 = await post({ phone: "1", token }, "10.77.0.4");
    assert.equal(r5.status, 400);
    assert.match(((await r5.json()) as { error: string }).error, /name/i);

    // 6. no-JS: url-encoded, no JSON accept -> 303 to a SAFE return path, lead written
    const r6 = await POST(
      new Request("http://localhost/api/site/enquiry", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", "x-forwarded-for": "10.77.0.4" },
        body: new URLSearchParams({ name: "No JS Nancy", email: "nancy@example.ie", programme: "livewell", token, return: "https://evil.example/" }).toString(),
      }),
    );
    assert.equal(r6.status, 303);
    assert.equal(r6.headers.get("location"), "http://localhost/contact?ok=1", "absolute return path refused -> fallback");
    assert.equal(leadCount(), 2);
    const r6b = await POST(
      new Request("http://localhost/api/site/enquiry", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", "x-forwarded-for": "10.77.0.4" },
        body: new URLSearchParams({ name: "Bad Email", email: "nope", token, return: "/site/healthwise/contact" }).toString(),
      }),
    );
    assert.equal(r6b.status, 303);
    assert.match(r6b.headers.get("location") ?? "", /^http:\/\/localhost\/site\/healthwise\/contact\?err=/);

    // 7. oversized
    const r7 = await post({ name: "x".repeat(40_000), phone: "1", token });
    assert.equal(r7.status, 413);

    // 8. rate limit: 8 per 10 minutes per IP
    let last = 0;
    for (let i = 0; i < 9; i++) {
      const r = await post({ name: `Burst ${i}`, phone: `08${i}`, token }, "10.77.0.2");
      last = r.status;
    }
    assert.equal(last, 429, "the ninth request in the window is throttled");

    console.log("api/site/enquiry/route.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd app && npm test -- src/app/api/site/enquiry/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 7: Write the route**

`app/src/app/api/site/enquiry/route.ts`:

```ts
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { runWithTenant } from "@/lib/db/tenant";
import { upsertLead } from "@/lib/leads";
import { logActivity } from "@/lib/queries";
import { verifySiteEnquiryToken } from "@/lib/cms/enquiryToken";
import { enquiryNotes, isEnquiryHoneypotTripped, safeReturnPath, validateEnquiry } from "@/lib/cms/enquiry";
import { parsePublicFormFields, respondPublicForm } from "@/lib/publicFormExchange";

export const dynamic = "force-dynamic";

/**
 * Public enquiry handler for bespoke tenant sites (first used by Healthwise).
 * Unauthenticated and unkeyed. The tenant comes ONLY from the signed token
 * the verbatim template minted into the page (lib/cms/enquiryToken.ts) —
 * the same model as api/campaigns/signup/route.ts, whose header explains why
 * host- or slug-based resolution is not safe here. Protections mirror
 * f/[slug]/submit/route.ts: size cap before parsing, honeypot, per-IP
 * throttle; the JSON-or-url-encoded exchange itself is shared with that
 * route (lib/publicFormExchange.ts).
 *
 * Plain Request/Response, not next/server, so the route loads in the test
 * runner (see f/[slug]/submit/route.ts for the same choice).
 */
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return respondPublicForm(req, "/contact", false, { status: 413, error: "That message is too long." });
  }
  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    return respondPublicForm(req, "/contact", false, { status: 413, error: "That message is too long." });
  }

  let fields: Record<string, string>;
  try {
    fields = parsePublicFormFields(req, rawText);
  } catch {
    return respondPublicForm(req, "/contact", false, { status: 400, error: "Please check the form and try again." });
  }
  const returnTo = safeReturnPath(fields.return);

  // Honeypot: a bot that fills every field gets a quiet success and nothing stored.
  if (isEnquiryHoneypotTripped(fields)) return respondPublicForm(req, returnTo, true);

  const rl = rateLimit(`site-enquiry:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!rl.ok) {
    return respondPublicForm(req, returnTo, false, {
      status: 429,
      error: "Too many messages — please try again shortly.",
      headers: { "Retry-After": String(rl.retryAfterSec) },
    });
  }

  const validated = validateEnquiry(fields);
  if (!validated.ok) return respondPublicForm(req, returnTo, false, { status: 400, error: validated.error });
  const data = validated.data;

  const claim = verifySiteEnquiryToken(fields.token ?? "");
  if (!claim) return respondPublicForm(req, returnTo, false, { status: 400, error: "Invalid or missing token." });

  // Stable dedupe key so a double-click or a second enquiry from the same
  // person updates one card rather than adding a twin (upsertLead is
  // idempotent on source + sourceLeadId). validateEnquiry guarantees one of
  // email/phone is present.
  const contactKey = (data.email || data.phone || "").toLowerCase().replace(/\s+/g, "");
  const result = await runWithTenant(claim.tenantId, async () => {
    const { lead, created } = upsertLead({
      source: "website",
      sourceLeadId: `website:${contactKey}`,
      campaign: "Website enquiry",
      fullName: data.name,
      email: data.email,
      phone: data.phone,
      notes: enquiryNotes(data),
    });
    await logActivity(
      "lead.new",
      created ? `Website enquiry: ${data.name}` : `Repeat website enquiry: ${data.name}`,
      { leadId: lead.id, programme: data.programme, siteId: claim.siteId, created },
    );
    return { leadId: lead.id, created };
  });

  return respondPublicForm(req, returnTo, true, { extra: { leadId: result.leadId, created: result.created } });
}
```

- [ ] **Step 8: Run the route test, then the full suite and typecheck**

Run: `cd app && npm test -- src/app/api/site/enquiry/route.test.ts`
Expected: `api/site/enquiry/route.test.ts: all assertions passed`.

Run: `cd app && npm run typecheck && npm test`
Expected: clean typecheck; every file passes.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/cms/enquiry.ts app/src/lib/cms/enquiry.test.ts app/src/lib/publicFormExchange.ts "app/src/app/f/[slug]/submit/route.ts" app/src/app/api/site/enquiry/route.ts app/src/app/api/site/enquiry/route.test.ts
git commit -m "feat(cms): a bespoke site's enquiry form lands as a lead in its own tenant

The JSON-or-url-encoded exchange is shared with the public forms route
(lib/publicFormExchange), which moves onto it unchanged in behaviour.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Per-site redirect map

**Files:**
- Create: `app/src/lib/cms/siteRedirects.ts`
- Test: `app/src/lib/cms/siteRedirects.test.ts`
- Create: `app/public/sites/healthwise/_redirects.json`
- Modify: `app/src/app/site/[siteSlug]/[...slug]/page.tsx`

**Interfaces:**
- Consumes: `resolvePublicSite({host, siteParam}): PublicSite | null` (`resolvedVia: "host" | "fallback"`, `site.slug`, `site.id`, `db`) from `@/lib/cms/resolveHost`; `getPublishedPostBySlug(db, siteId, slug)` from `@/lib/cms/blog`; `permanentRedirect` from `next/navigation`; `headers` from `next/headers`.
- Produces: `resolveSiteRedirect(slug, pathname, baseDir?): {target, kind: "internal" | "external"} | null`, `clearRedirectCache()`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/cms/siteRedirects.test.ts`:

```ts
// Run: npm test -- src/lib/cms/siteRedirects.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearRedirectCache, matchRedirect, resolveSiteRedirect } from "./siteRedirects";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "site-redirects-"));
try {
  const map = {
    "/post/:slug": "/blog/:slug",
    "/about-healthwise": "/about",
    "/inspire-health-fitness": "https://inspirehealthandfitness.ie",
  };
  fs.mkdirSync(path.join(base, "hw"), { recursive: true });
  fs.writeFileSync(path.join(base, "hw", "_redirects.json"), JSON.stringify(map));
  fs.mkdirSync(path.join(base, "broken"), { recursive: true });
  fs.writeFileSync(path.join(base, "broken", "_redirects.json"), "{ not json");

  check("exact match", resolveSiteRedirect("hw", "/about-healthwise", base)?.target === "/about");
  check("exact match kind internal", resolveSiteRedirect("hw", "/about-healthwise", base)?.kind === "internal");
  check("trailing slash ignored", resolveSiteRedirect("hw", "/about-healthwise/", base)?.target === "/about");
  check(":slug substituted", resolveSiteRedirect("hw", "/post/walking-after-60", base)?.target === "/blog/walking-after-60");
  check(":slug with encoded chars kept", resolveSiteRedirect("hw", "/post/caf%C3%A9-tips", base)?.target === "/blog/caf%C3%A9-tips");
  check("pattern needs the same depth", resolveSiteRedirect("hw", "/post/a/b", base) === null);
  check("pattern needs a value", resolveSiteRedirect("hw", "/post/", base) === null);
  check("external kind", resolveSiteRedirect("hw", "/inspire-health-fitness", base)?.kind === "external");
  check("external target verbatim", resolveSiteRedirect("hw", "/inspire-health-fitness", base)?.target === "https://inspirehealthandfitness.ie");
  check("no match -> null", resolveSiteRedirect("hw", "/nothing-here", base) === null);
  check("root never matches", resolveSiteRedirect("hw", "/", base) === null);
  check("missing file -> null", resolveSiteRedirect("nope", "/about-healthwise", base) === null);
  check("invalid json -> null, no throw", resolveSiteRedirect("broken", "/about-healthwise", base) === null);

  // the map is cached; a rewrite is invisible until the cache is cleared
  fs.writeFileSync(path.join(base, "hw", "_redirects.json"), JSON.stringify({ "/x": "/y" }));
  check("cached map still serves", resolveSiteRedirect("hw", "/about-healthwise", base)?.target === "/about");
  clearRedirectCache();
  check("after clear, new map", resolveSiteRedirect("hw", "/x", base)?.target === "/y");

  // pure matcher: non-string values are ignored
  check("matchRedirect ignores non-string targets", matchRedirect({ "/a": 1 as unknown as string, "/b": "/c" }, "/a") === null);

  console.log(`siteRedirects.test.ts: ${passed} checks passed`);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/cms/siteRedirects.test.ts`
Expected: FAIL — `Cannot find module './siteRedirects'`.

- [ ] **Step 3: Write the module**

`app/src/lib/cms/siteRedirects.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

/**
 * Per-site redirect map: `public/sites/<slug>/_redirects.json`, a flat object
 * of `from` -> `to`. Keys are root-relative paths; a segment starting with
 * `:` matches one non-empty segment and is substituted into the target.
 * Targets are root-relative paths or absolute https URLs.
 *
 * Why a file in the bundle rather than a table: a site's old URLs are known
 * when the site is built, they change with the site, and they travel with the
 * pages in the same deploy. The Inspire `/blog-posts/[slug]` route is the
 * hard-coded precedent this generalises; it is left in place.
 *
 * The public catch-all consults this only after the page lookup has failed,
 * so a real page always wins over a redirect. Cached per file for the life of
 * the process; the bundle only changes on deploy.
 */
export interface RedirectMatch {
  target: string;
  kind: "internal" | "external";
}

type RedirectMap = Record<string, string>;

const cache = new Map<string, RedirectMap | null>();

function defaultBaseDir(): string {
  return path.join(process.cwd(), "public", "sites");
}

export function clearRedirectCache(): void {
  cache.clear();
}

function loadRedirectMap(slug: string, baseDir: string): RedirectMap | null {
  const file = path.join(baseDir, slug, "_redirects.json");
  if (cache.has(file)) return cache.get(file) ?? null;
  let map: RedirectMap | null = null;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed as RedirectMap;
    }
  } catch (err) {
    console.error(`[cms] ${file} is not valid JSON; ignoring redirects for "${slug}":`, err instanceof Error ? err.message : err);
    map = null;
  }
  cache.set(file, map);
  return map;
}

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function classify(target: string): RedirectMatch {
  return /^https?:\/\//i.test(target) ? { target, kind: "external" } : { target, kind: "internal" };
}

/** Pure matcher over an already-loaded map. Exact keys win; then `:param` patterns in object order. */
export function matchRedirect(map: RedirectMap, pathname: string): RedirectMatch | null {
  const p = normalize(pathname);
  if (p === "/") return null;
  const exact = map[p];
  if (typeof exact === "string") return classify(exact);
  const segs = p.split("/");
  for (const [pattern, target] of Object.entries(map)) {
    if (typeof target !== "string" || !pattern.includes(":")) continue;
    const parts = pattern.split("/");
    if (parts.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const want = parts[i]!;
      const got = segs[i]!;
      if (want.startsWith(":")) {
        if (!got) { ok = false; break; }
        params[want.slice(1)] = got;
      } else if (want !== got) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    return classify(target.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, k: string) => params[k] ?? ""));
  }
  return null;
}

export function resolveSiteRedirect(slug: string, pathname: string, baseDir = defaultBaseDir()): RedirectMatch | null {
  const map = loadRedirectMap(slug, baseDir);
  return map ? matchRedirect(map, pathname) : null;
}
```

- [ ] **Step 4: Run the test**

Run: `cd app && npm test -- src/lib/cms/siteRedirects.test.ts`
Expected: `siteRedirects.test.ts: 16 checks passed`.

- [ ] **Step 5: Write the Healthwise map**

`app/public/sites/healthwise/_redirects.json`:

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

- [ ] **Step 6: Consult it in the catch-all before 404**

In `app/src/app/site/[siteSlug]/[...slug]/page.tsx`, add imports:

```ts
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { getPublishedPostBySlug } from "@/lib/cms/blog";
import { resolveSiteRedirect } from "@/lib/cms/siteRedirects";
```

(replace the existing `import { notFound } from "next/navigation";` line) and replace

```ts
  const pc = resolvePageContext(params, searchParams);
  if (!pc || !pc.template) notFound();
```

with

```ts
  const pc = resolvePageContext(params, searchParams);
  if (!pc || !pc.template) {
    // No page at this path. Before 404ing, a bespoke site may map an OLD
    // URL here (public/sites/<slug>/_redirects.json — see lib/cms/siteRedirects).
    // A blog target is only issued when the post actually exists, so a
    // missing article gets a 404 rather than a redirect into another 404.
    const host = headers().get("host");
    const resolved = resolvePublicSite({ host, siteParam: searchParams.site ?? params.siteSlug });
    if (resolved) {
      const hit = resolveSiteRedirect(resolved.site.slug, pathFromSlugParam(params.slug));
      if (hit) {
        if (hit.kind === "external") permanentRedirect(hit.target);
        const blog = /^\/blog\/([^/]+)$/.exec(hit.target);
        const postOk = !blog || getPublishedPostBySlug(resolved.db, resolved.site.id, decodeURIComponent(blog[1]!)) !== null;
        if (postOk) {
          // Root-relative keeps the browser on its current host; a mapped
          // domain serves the site at its root, the preview mount at /site/<slug>.
          const prefix = resolved.resolvedVia === "host" ? "" : `/site/${resolved.site.slug}`;
          permanentRedirect(`${prefix}${hit.target}`);
        }
      }
    }
    notFound();
  }
```

- [ ] **Step 7: Typecheck, test, and try it in the dev server**

Run: `cd app && npm run typecheck && npm test`
Expected: clean.

Run: `cd app && npm run dev` in one terminal, then in another:
`curl -sI "http://localhost:3000/site/inspire/about-healthwise" | head -3`
Expected: `HTTP/1.1 404` (Inspire has no map — nothing changes for existing sites). The Healthwise case is exercised in Task 11 once the site exists locally.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/cms/siteRedirects.ts app/src/lib/cms/siteRedirects.test.ts app/public/sites/healthwise/_redirects.json "app/src/app/site/[siteSlug]/[...slug]/page.tsx"
git commit -m "feat(cms): a bespoke site can carry its old URLs across in a redirect map

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Site scaffold — stylesheet, build script, home page

**Files:**
- Create: `sites/healthwise/_style.css`
- Create: `sites/healthwise/build.mjs`
- Create: `sites/healthwise/pages/home.html`
- Create: `sites/healthwise/assets/` (brand marks + the three real photos)
- Modify: `.gitignore` (add `sites/healthwise/assets/ai/`)

**Interfaces:**
- Produces: the page shell every later page uses; build-time substitutions inside partials: `{{PULSE}}` (the hero pulse line), `{{RULE}}` (a full-width pulse rule before a section title), `{{STRIP:<programme>}}` (the compact enquiry strip, programme preselected), `{{TOKEN}}` (the literal `__ADONIS_ENQUIRY_TOKEN__`), `{{MAPS}}` (the Google Maps link). Nav marks the current page with `aria-current="page"`. Emitted files: `index.html, livewell.html, vitality.html, heartwise.html, classes.html, about.html, contact.html, drivewise.html`.
- Photos referenced (produced by Task 8): `assets/hero-portrait.jpg, livewell.jpg, vitality.jpg, heartwise.jpg, livewell-hero.jpg, vitality-hero.jpg, heartwise-hero.jpg, classes-hero.jpg, detail-hands.jpg, detail-band.jpg, detail-chat.jpg, detail-floor.jpg`. Real photos placed here: `assets/shopfront.jpg, assets/class-real.jpg, assets/room-real.jpg`.

- [ ] **Step 1: Assets and gitignore**

```bash
mkdir -p sites/healthwise/assets sites/healthwise/pages
DJ="/Users/truep/Desktop/Clients/DJ"
curl -sSL -A "Mozilla/5.0" -o sites/healthwise/assets/logo.png "https://cdn.prod.website-files.com/682b572df0451042c1e7e452/682cbad577f5664ea45095b9_Healthwise%20logo%20transparent-02-02.png"
cp "$DJ/Healthwise Logo WHITE-02.png" sites/healthwise/assets/logo-white.png
cp "$DJ/Heartwise/Heartwise Logos-05.png" sites/healthwise/assets/heartwise-logo.png
cp "$DJ/Healthwise Drivewise Icon-09.png" sites/healthwise/assets/heart.png
sips -s format jpeg -Z 1600 "$DJ/Healthwise/PXL_20250704_163417277.PORTRAIT.jpg" --out sites/healthwise/assets/shopfront.jpg
sips -s format jpeg -Z 1600 "$DJ/Heartwise/Images/PXL_20251021_104017984.jpg" --out sites/healthwise/assets/class-real.jpg
sips -s format jpeg -Z 1600 "$DJ/Healthwise/PXL_20250730_163729618.jpg" --out sites/healthwise/assets/room-real.jpg
ls -la sites/healthwise/assets
printf '\n# Healthwise photography candidates (only the picks are committed)\nsites/healthwise/assets/ai/\n' >> .gitignore
```

Expected: seven files in `assets/`. Each JPEG must be under 300KB; for any that is over, re-encode it in place with ffmpeg: `ffmpeg -y -v error -i sites/healthwise/assets/<name>.jpg -q:v 5 sites/healthwise/assets/<name>.tmp.jpg && mv sites/healthwise/assets/<name>.tmp.jpg sites/healthwise/assets/<name>.jpg`.

- [ ] **Step 2: The stylesheet**

`sites/healthwise/_style.css`:

```css
/* ============================================================
   Healthwise, Clonmel — direction A, "the consultation".

   A good clinic, not a gym. White ground, big calm navy type, one
   photograph doing the emotional work per section, and the pulse
   line — the one painted across the studio's own glass — as the
   only decoration. The audience is over 60: body type is 18px and
   never lighter than 400, buttons are 52px, contrast is AA
   everywhere. Tokens are the brand's own; red is the pulse line and
   the primary button and nothing else; red is never a ground.

   See docs/superpowers/specs/2026-09-28-healthwise-website-design.md
   section 4 for the system this implements.
   ============================================================ */
:root{
  --navy:#28245C; --red:#EA1C28; --red-dark:#BB1620; --red-tint:#FCE8E9;
  --ink:#241A1B; --mid:#544D4D; --surf:#F2F2F2; --white:#FFFFFF;
  --pad:clamp(20px,5vw,64px); --max:1240px;
  --display:'Manrope',sans-serif; --text:'Open Sans',sans-serif;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--white);color:var(--ink);font-family:var(--text);font-size:18px;line-height:1.6;-webkit-font-smoothing:antialiased}
@media (max-width:640px){body{font-size:17px}}
img{max-width:100%;display:block;height:auto}
a{color:inherit}
h1,h2,h3,p,figure,blockquote,ul,ol{margin:0}
ul,ol{padding:0;list-style:none}
:focus-visible{outline:3px solid var(--red);outline-offset:3px}
[hidden]{display:none!important}
.skip{position:absolute;left:-999px;top:8px;background:var(--navy);color:#fff;padding:10px 14px;z-index:100;text-decoration:none}
.skip:focus{left:8px}
.wrap{max-width:var(--max);margin:0 auto;padding:0 var(--pad)}

/* ---- type ---- */
.d{font-family:var(--display);font-weight:800;letter-spacing:-.02em;line-height:1.02;color:var(--navy)}
.h1{font-size:clamp(40px,5.2vw,68px)}
.h2{font-size:clamp(30px,3.4vw,40px);line-height:1.08}
.h3{font-family:var(--display);font-weight:700;font-size:22px;line-height:1.25;color:var(--navy)}
.eyebrow{font-family:var(--text);font-weight:600;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--mid)}
.lead{font-size:clamp(18px,1.4vw,21px);color:var(--mid);max-width:44ch}
.body{max-width:60ch}
.body p+p{margin-top:1em}
.small{font-size:15px;color:var(--mid)}

/* ---- the pulse line: flat, one beat, flat ---- */
.pulse{display:block;width:140px;height:20px;margin:22px 0 0}
.pulse path{fill:none;stroke:var(--red);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
.pulse--rule{width:100%;height:20px;margin:0 0 18px}

/* ---- buttons and links ---- */
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:0 24px;border-radius:4px;background:var(--red);color:#fff;font:600 16px/1 var(--text);text-decoration:none;border:0;cursor:pointer;transition:background .18s,transform .18s}
.btn:hover{background:var(--red-dark)}
.btn:active{transform:translateY(1px)}
.btn[disabled]{opacity:.6;cursor:default}
.btn--ghost{background:transparent;color:var(--navy);border:1.5px solid var(--navy)}
.btn--ghost:hover{background:var(--navy);color:#fff}
.btn--light{background:#fff;color:var(--navy)}
.btn--light:hover{background:var(--surf)}
.link{font-weight:600;color:var(--navy);text-decoration:none;border-bottom:2px solid var(--red);padding-bottom:2px}
.link:hover{color:var(--red)}

/* ---- nav ---- */
.nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-bottom:1px solid var(--surf)}
.nav__in{max-width:var(--max);margin:0 auto;padding:14px var(--pad);display:flex;align-items:center;justify-content:space-between;gap:20px;position:relative}
.nav__logo img{height:36px;width:auto}
.nav__links{display:flex;gap:26px;align-items:center}
.nav__links a{font-weight:600;font-size:15px;color:var(--navy);text-decoration:none;padding:6px 0;border-bottom:2px solid transparent}
.nav__links a:hover,.nav__links a[aria-current="page"]{border-bottom-color:var(--red)}
.nav__cta{display:flex;gap:12px;align-items:center}
.nav__tel{display:none;font-weight:600;color:var(--navy);text-decoration:none}
.nav__menu{display:none;background:none;border:1.5px solid var(--navy);border-radius:4px;color:var(--navy);font:600 14px var(--text);padding:0 14px;min-height:44px;cursor:pointer}
@media (max-width:980px){
  .nav__links{display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border-bottom:1px solid var(--surf);flex-direction:column;align-items:stretch;gap:0;padding:8px var(--pad) 16px;box-shadow:0 20px 40px -30px rgba(0,0,0,.4)}
  .nav__links a{padding:14px 0;border-bottom:1px solid var(--surf);font-size:17px}
  .nav--open .nav__links,html:not(.js) .nav__links{display:flex}
  .nav__menu{display:inline-flex;align-items:center}
  .nav__tel{display:inline-flex;align-items:center;min-height:44px}
  .nav__cta .btn{display:none}
}

/* ---- home hero ---- */
.hero{padding:clamp(40px,6vw,88px) 0 clamp(40px,5vw,72px)}
.hero__in{display:grid;grid-template-columns:7fr 5fr;gap:clamp(28px,4vw,64px);align-items:start}
.hero__copy .h1{margin-top:18px;max-width:12ch}
.hero__copy .lead{margin:22px 0 30px}
.hero__ctas{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.hero__photo{border-top:3px solid var(--navy);padding-top:12px}
.hero__photo img{width:100%;aspect-ratio:4/5;object-fit:cover}
.hero__cap{margin-top:10px;font-size:13px;color:var(--mid)}
@media (max-width:820px){
  .hero__in{grid-template-columns:1fr}
  .hero__photo{order:-1;border-top:0;padding-top:0}
  .hero__photo img{aspect-ratio:4/3}
}

/* ---- inner page hero ---- */
.phero{padding:clamp(36px,5vw,72px) 0 0}
.phero .h1{margin-top:16px;max-width:14ch}
.phero .lead{margin-top:20px}
.phero__img{margin-top:clamp(28px,4vw,48px)}
.phero__img img{width:100%;aspect-ratio:3/2;object-fit:cover}
.phero__mark{height:44px;width:auto;margin-bottom:18px}

/* ---- proof strip ---- */
.proof{background:var(--surf);padding:22px 0}
.proof ul{display:flex;flex-wrap:wrap;gap:10px 26px;font-size:15px;color:var(--mid)}
.proof li{display:flex;align-items:center;gap:10px}
.proof li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--red);flex:none}
.proof b{color:var(--navy);font-weight:600}

/* ---- sections ---- */
.sec{padding:clamp(48px,7vw,96px) 0}
.sec--surf{background:var(--surf)}
.sec--tint{background:var(--red-tint)}
.sec--navy{background:var(--navy);color:#fff}
.sec--navy .d,.sec--navy .h3{color:#fff}
.sec--navy .eyebrow{color:#c9c6e6}
.sec--navy .lead,.sec--navy .body,.sec--navy .small{color:#d7d5ea}
.sec__head{max-width:60ch;margin-bottom:clamp(28px,4vw,48px)}
.sec__head .h2{margin-top:14px}
.sec__head .lead{margin-top:16px}

/* ---- programmes: three doors ---- */
.doors{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(24px,3vw,40px)}
.door{border-top:1.5px solid var(--navy);padding-top:18px;display:flex;flex-direction:column}
.door--red{border-top-color:var(--red)}
.door .d{font-size:40px;margin:10px 0 12px}
.door p{color:var(--mid);font-size:17px}
.door img{margin-top:20px;aspect-ratio:4/3;object-fit:cover;width:100%}
.door .link{margin-top:16px;align-self:flex-start}
@media (max-width:820px){.doors{grid-template-columns:1fr}}

/* ---- the method, numbered because it is a sequence ---- */
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:30px;border-top:1px solid rgba(255,255,255,.25);padding-top:28px}
.step__n{font-family:var(--display);font-weight:800;font-size:15px;letter-spacing:.06em;color:#F06068}
.step .h3{margin:8px 0}
.step p{font-size:16px;color:#d7d5ea}
@media (max-width:980px){.steps{grid-template-columns:1fr 1fr}}
@media (max-width:560px){.steps{grid-template-columns:1fr}}

/* ---- text beside a photograph ---- */
.split{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,5vw,72px);align-items:center}
.split img{width:100%;aspect-ratio:4/5;object-fit:cover}
.split--wide img{aspect-ratio:4/3}
.split .h2{margin-top:14px}
.split .body{margin-top:20px}
.split .link{display:inline-block;margin-top:22px}
@media (max-width:820px){.split{grid-template-columns:1fr}}

/* ---- rows: a name beside its description ---- */
.rows{border-top:1px solid var(--navy)}
.row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,2fr);gap:12px 40px;padding:24px 0;border-bottom:1px solid rgba(40,36,92,.18)}
.row p{color:var(--mid)}
.row__meta{font-size:15px;color:var(--mid);margin-top:6px}
@media (max-width:700px){.row{grid-template-columns:1fr}}

/* ---- timeline ---- */
.tl{border-left:2px solid var(--red);padding-left:28px;display:grid;gap:26px}
.tl__y{font-family:var(--display);font-weight:800;color:var(--red);font-size:15px;letter-spacing:.06em}
.tl p{color:var(--mid)}

/* ---- a quotation ---- */
.quote{font-family:var(--display);font-weight:700;font-size:clamp(24px,2.6vw,34px);line-height:1.2;color:var(--navy);max-width:24ch}
.quote__by{margin-top:16px;font-size:15px;color:var(--mid)}

/* ---- detail tiles ---- */
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.tiles img{aspect-ratio:1;object-fit:cover;width:100%}
@media (max-width:700px){.tiles{grid-template-columns:1fr 1fr}}

/* ---- closing band ---- */
.band{display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap}
.band .h2{max-width:18ch}

/* ---- blog links ---- */
.posts{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}
.post{border-top:1.5px solid var(--navy);padding-top:16px;text-decoration:none;display:block}
.post .h3{margin:8px 0}
.post p{color:var(--mid);font-size:16px}
.post:hover .h3{color:var(--red)}
@media (max-width:820px){.posts{grid-template-columns:1fr}}

/* ---- the timetable frame ---- */
.frame{background:var(--surf);padding:clamp(16px,3vw,32px);border-top:3px solid var(--navy)}
.frame iframe{display:block;width:100%;max-width:600px;height:800px;margin:0 auto;border:0;background:#fff}
.frame__note{text-align:center;margin-top:14px;font-size:15px;color:var(--mid)}

/* ---- forms ---- */
.form{display:grid;gap:18px;max-width:560px;position:relative}
.field{display:grid;gap:6px}
.field label{font-weight:600;font-size:15px;color:var(--navy)}
.field input,.field select,.field textarea{font:inherit;font-size:17px;padding:13px 14px;border:1.5px solid rgba(40,36,92,.35);border-radius:4px;background:#fff;color:var(--ink);min-height:52px;width:100%}
.field textarea{min-height:140px;resize:vertical}
.field input:focus,.field select:focus,.field textarea:focus{outline:3px solid var(--red);outline-offset:2px;border-color:var(--navy)}
.form__hp{position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden}
.form__ok,.form__err{padding:14px 16px;border-radius:4px;font-size:16px}
.form__ok{background:#E6F4EA;color:#1B5E20}
.form__err{background:var(--red-tint);color:var(--red-dark)}
.form__note{font-size:14px;color:var(--mid)}
.strip{background:var(--surf);border-top:3px solid var(--navy);padding:clamp(24px,4vw,40px)}
.strip .form{max-width:none;grid-template-columns:1fr 1fr auto;align-items:end;gap:14px}
.strip .h3{margin-bottom:16px}
.strip .form__ok,.strip .form__err,.strip .form__note{grid-column:1/-1}
@media (max-width:700px){.strip .form{grid-template-columns:1fr}}

/* ---- contact facts ---- */
.facts{display:grid;gap:22px}
.fact b{display:block;color:var(--navy);font-weight:600;margin-bottom:4px}
.fact a{color:var(--navy)}

/* ---- footer ---- */
.foot{background:var(--navy);color:#c9c6e6;padding:clamp(40px,6vw,72px) 0 28px}
.foot__grid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:32px;font-size:15px}
.foot b{display:block;color:#fff;font-weight:600;margin-bottom:8px}
.foot a{color:#fff;text-decoration:none}
.foot a:hover{text-decoration:underline}
.foot__links a{display:block;padding:3px 0}
.foot__logo{height:32px;width:auto;margin-bottom:14px}
.foot__bar{margin-top:40px;padding-top:18px;border-top:1px solid rgba(255,255,255,.18);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px}
@media (max-width:820px){.foot__grid{grid-template-columns:1fr 1fr}}
@media (max-width:520px){.foot__grid{grid-template-columns:1fr}}

/* ---- motion: pre-animation states exist only when the js flag is set,
        so a page with no JavaScript, or reduced motion, hides nothing ---- */
html.js [data-rise]{opacity:0;transform:translateY(18px)}
html.js .wipe img{clip-path:inset(100% 0 0 0);transform:scale(1.04)}
html.js .pulse--draw path{stroke-dasharray:220;stroke-dashoffset:220}
html.js [data-stagger]>*{opacity:0;transform:translateY(14px)}
```

- [ ] **Step 3: The build script**

`sites/healthwise/build.mjs`:

```js
// Build the Healthwise site.
//
// Each page ships as standalone HTML with one <style> in the head, because
// that is the shape the CMS importer files correctly: fonts + style become
// the page's head zone, the markup becomes the editable content zone, and
// the scripts at the end of the body become the tail zone the visual editor
// never runs. One stylesheet here means a change lands everywhere at once.
//
//   node build.mjs
//
// Partials in pages/ may use these substitutions:
//   {{PULSE}}            the hero pulse line (draws on with JS)
//   {{RULE}}             a full-width pulse rule before a section title
//   {{STRIP:vitality}}   the compact enquiry strip, programme preselected
//   {{TOKEN}}            the literal enquiry-token placeholder
//   {{MAPS}}             the Google Maps link for the studio
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "_style.css"), "utf8");

// The one literal the CMS's verbatim template replaces at render time with a
// token naming this tenant and site (app/src/lib/cms/enquiryToken.ts).
const TOKEN = "__ADONIS_ENQUIRY_TOKEN__";
const MAPS = "https://www.google.com/maps/search/?api=1&query=52.36408485468106%2C-7.711582681662141";
const PHONE_DISPLAY = "086 242 2388";
const PHONE_TEL = "+353862422388";
const EMAIL = "dj@healthwiseclonmel.ie";

const NAV_LINKS = [
  ["livewell.html", "Livewell 40–60", "livewell"],
  ["vitality.html", "Vitality 60+", "vitality"],
  ["heartwise.html", "Heartwise", "heartwise"],
  ["classes.html", "Classes", "classes"],
  ["about.html", "About DJ", "about"],
  ["blog.html", "Blog", "blog"],
];

const pulseSvg = (cls) =>
  `<svg class="pulse ${cls}" viewBox="0 0 140 20" aria-hidden="true"><path d="M0 10 H48 L56 3 L64 17 L72 10 H140"/></svg>`;
const ruleSvg = () =>
  `<svg class="pulse pulse--rule" viewBox="0 0 1200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M0 10 H140 L148 3 L156 17 L164 10 H1200"/></svg>`;

const nav = (key) => `<header class="nav">
  <a class="skip" href="#main">Skip to content</a>
  <div class="nav__in">
    <a class="nav__logo" href="index.html" aria-label="Healthwise, home"><img src="assets/logo.png" alt="Healthwise — Educate, Motivate, Activate" width="819" height="168" /></a>
    <nav class="nav__links" id="nav-links" aria-label="Primary">
${NAV_LINKS.map(([h, t, k]) => `      <a href="${h}"${k === key ? ' aria-current="page"' : ""}>${t}</a>`).join("\n")}
    </nav>
    <div class="nav__cta">
      <a class="nav__tel" href="tel:${PHONE_TEL}">${PHONE_DISPLAY}</a>
      <a class="btn" href="contact.html#book">Book a consultation</a>
      <button class="nav__menu" type="button" aria-expanded="false" aria-controls="nav-links">Menu</button>
    </div>
  </div>
</header>`;

const footer = () => `<footer class="foot">
  <div class="wrap">
    <div class="foot__grid">
      <div>
        <img class="foot__logo" src="assets/logo-white.png" alt="Healthwise" />
        <p>Unit 12E Ard Gaoithe Business Park,<br />Clonmel, Co. Tipperary, E91 A6F4</p>
        <p style="margin-top:10px"><a href="${MAPS}" rel="noopener">Directions</a></p>
      </div>
      <div class="foot__links">
        <b>Talk to DJ</b>
        <a href="tel:${PHONE_TEL}">${PHONE_DISPLAY}</a>
        <a href="mailto:${EMAIL}">${EMAIL}</a>
        <p style="margin-top:10px">Classes from 7am, mornings and evenings. See the <a href="classes.html">timetable</a>.</p>
      </div>
      <div class="foot__links">
        <b>Programmes</b>
        <a href="livewell.html">Livewell 40–60</a>
        <a href="vitality.html">Vitality 60+</a>
        <a href="heartwise.html">Heartwise</a>
        <a href="drivewise.html">Drivewise for companies</a>
        <a href="blog.html">Blog</a>
      </div>
      <div class="foot__links">
        <b>Also at Ard Gaoithe</b>
        <a href="https://inspirehealthandfitness.ie" rel="noopener">Inspire Health &amp; Fitness</a>
        <a href="https://bodegacafeatinspire.ie" rel="noopener">Bodega Cafe at Inspire</a>
        <b style="margin-top:16px">Follow</b>
        <a href="https://www.facebook.com/healthwiseclonmel/" rel="noopener">Facebook</a>
        <a href="https://www.instagram.com/healthwise_clonmel" rel="noopener">Instagram</a>
      </div>
    </div>
    <div class="foot__bar">
      <span>Healthwise Ltd. Educate, Motivate, Activate.</span>
      <span>Clonmel, since 2011</span>
    </div>
  </div>
</footer>`;

// The compact enquiry strip on programme pages: name and phone, programme
// preselected, same endpoint as the full form. No script inside (the tail
// zone owns behaviour); works as a plain POST without JavaScript.
const strip = (programme) => `<div class="strip" id="book">
  <h2 class="h3">Book a consultation</h2>
  <form class="form" method="post" action="/api/site/enquiry" data-enquiry>
    <div class="field"><label for="strip-name">Your name</label><input id="strip-name" name="name" type="text" autocomplete="name" required /></div>
    <div class="field"><label for="strip-phone">Phone number</label><input id="strip-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required /></div>
    <button class="btn" type="submit">Book a consultation</button>
    <input type="hidden" name="programme" value="${programme}" />
    <input type="hidden" name="token" value="${TOKEN}" />
    <input type="hidden" name="return" value="/contact" />
    <div class="form__hp" aria-hidden="true"><label>Company website<input name="company_website" type="text" tabindex="-1" autocomplete="off" /></label></div>
    <p class="form__ok" hidden>Thanks — we'll be in touch shortly.</p>
    <p class="form__err" hidden></p>
    <p class="form__note">We use your details only to reply to you.</p>
  </form>
</div>`;

// Scripts sit at the very end of the body so the importer files them in the
// tail zone. Every pre-animation state is gated on the `js` flag set in the
// head: no flag, no hiding, so the page reads fully without JavaScript and
// the visual editor (which never runs the tail) shows every section.
const scripts = () => `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/CustomEase.min.js"></script>
<script>
(function () {
  // Menu button (mobile).
  var nav = document.querySelector('.nav');
  var menu = document.querySelector('.nav__menu');
  if (nav && menu) {
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('nav--open');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.textContent = open ? 'Close' : 'Menu';
    });
  }

  // Enquiry forms: post as JSON and show the answer in place. Without this
  // the form still posts natively and the route redirects back with ?ok=1.
  var forms = document.querySelectorAll('form[data-enquiry]');
  Array.prototype.forEach.call(forms, function (form) {
    var ret = form.querySelector('input[name="return"]');
    if (ret) ret.value = location.pathname;
    var ok = form.querySelector('.form__ok');
    var err = form.querySelector('.form__err');
    var btn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (e) {
      if (!window.fetch) return;
      e.preventDefault();
      if (err) err.hidden = true;
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) {
          if (ok) ok.hidden = false;
          Array.prototype.forEach.call(form.querySelectorAll('.field, button[type="submit"]'), function (el) { el.hidden = true; });
        } else if (err) {
          err.textContent = (j && j.error) || 'Something went wrong. Please ring us instead.';
          err.hidden = false;
        }
      }).catch(function () {
        if (err) { err.textContent = 'Something went wrong. Please ring us instead.'; err.hidden = false; }
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
    });
  });
  // The no-JS path lands back here with a flag in the query string.
  var q = new URLSearchParams(location.search);
  if (q.get('ok') === '1' || q.get('err')) {
    var first = document.querySelector('form[data-enquiry]');
    if (first) {
      var fok = first.querySelector('.form__ok'), ferr = first.querySelector('.form__err');
      if (q.get('ok') === '1' && fok) fok.hidden = false;
      if (q.get('err') && ferr) { ferr.textContent = q.get('err'); ferr.hidden = false; }
      first.scrollIntoView();
    }
  }

  // Motion.
  var root = document.documentElement;
  if (!window.gsap) { root.className = root.className.replace(/\\bjs\\b/, ''); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.className = root.className.replace(/\\bjs\\b/, ''); return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (window.CustomEase) gsap.registerPlugin(CustomEase);
  var SNAP = window.CustomEase ? CustomEase.create('snap', '.16,1,.3,1') : 'expo.out';

  var hero = document.querySelector('.hero, .phero');
  if (hero) {
    var tl = gsap.timeline();
    tl.to(hero.querySelectorAll('[data-rise]'), { opacity: 1, y: 0, duration: .85, ease: SNAP, stagger: 0.09 }, 0.05);
    var draw = hero.querySelector('.pulse--draw path');
    if (draw) tl.to(draw, { strokeDashoffset: 0, duration: .9, ease: 'power2.out' }, 0.35);
  }
  gsap.utils.toArray('[data-rise]').forEach(function (el) {
    if (hero && hero.contains(el)) return;
    gsap.to(el, { opacity: 1, y: 0, duration: .8, ease: SNAP, scrollTrigger: { trigger: el, start: 'top 90%' } });
  });
  gsap.utils.toArray('.wipe img').forEach(function (img) {
    gsap.to(img, { clipPath: 'inset(0% 0 0 0)', scale: 1, duration: 1.1, ease: SNAP, scrollTrigger: { trigger: img, start: 'top 88%' } });
  });
  gsap.utils.toArray('[data-stagger]').forEach(function (group) {
    gsap.to(group.children, { opacity: 1, y: 0, duration: .8, ease: SNAP, stagger: 0.08, scrollTrigger: { trigger: group, start: 'top 85%' } });
  });
}());
</script>`;

const jsonLd = () => `<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HealthClub",
  name: "Healthwise",
  alternateName: "Healthwise Clonmel",
  url: "https://www.healthwiseclonmel.ie",
  telephone: "+353-86-242-2388",
  email: EMAIL,
  founder: { "@type": "Person", name: "DJ O'Dwyer" },
  foundingDate: "2011",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Unit 12E, Ard Gaoithe Business Park",
    addressLocality: "Clonmel",
    addressRegion: "Tipperary",
    postalCode: "E91 A6F4",
    addressCountry: "IE",
  },
  geo: { "@type": "GeoCoordinates", latitude: 52.36408485468106, longitude: -7.711582681662141 },
  sameAs: ["https://www.facebook.com/healthwiseclonmel/", "https://www.instagram.com/healthwise_clonmel"],
}, null, 1)}
</script>`;

// The `js` flag script and the JSON-LD open the BODY, not the head: the
// importer (tools/lib/siteHtml.cjs) keeps only the font <link>s and the
// <style> from the head and drops every other head token, so anything that
// must reach the CMS render has to be inside <body>. Placed first, they are
// leading <script> tokens and the zone splitter (lib/cms/pageBody.ts) files
// them in the head zone: rendered on the public page, stripped from the
// Studio canvas — which is exactly right, since without the flag the canvas
// hides nothing.
const shell = ({ key, title, description, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Open+Sans:wght@400;600&display=swap" rel="stylesheet" />
<style>
${css.trim()}
</style>
</head>
<body>
<script>document.documentElement.className+=' js';</script>
${jsonLd()}

${nav(key)}

<main id="main">
${body.trim()}
</main>

${footer()}

${scripts()}
</body>
</html>
`;

const META = {
  home: { file: "index.html", title: "Healthwise Clonmel | Coached exercise for over 40s, over 60s and after a cardiac event",
    description: "Small-group coached exercise in Clonmel for adults over 40, over 60, and after a cardiac event. Livewell, Vitality and Heartwise, led by DJ O'Dwyer since 2011." },
  livewell: { file: "livewell.html", title: "Livewell 40–60 | Strength, mobility and cardio classes in Clonmel | Healthwise",
    description: "Five coached classes a week for adults aged 40 to 60: Women's Cardio Tone, MoveWell Strength, Men's Gym, MoveWell Mobility and Women's Circuit, at Healthwise in Clonmel." },
  vitality: { file: "vitality.html", title: "Vitality 60+ | Gentle group exercise for over 60s in Clonmel | Healthwise",
    description: "Gentle, coached group exercise for men and women over 60 in Clonmel. For beginners, limited mobility, and anyone coming back after a health event. Morning and afternoon classes." },
  heartwise: { file: "heartwise.html", title: "Heartwise | Supervised exercise after a cardiac event | Healthwise Clonmel",
    description: "Supervised exercise and lifestyle coaching in Clonmel for people who have had a cardiac procedure, and for managing type 2 diabetes, blood pressure and weight. BACPR-certified, since 2013." },
  classes: { file: "classes.html", title: "Classes and timetable | Healthwise Clonmel",
    description: "Every Healthwise class described, who it is for, and the live timetable. Classes from 7am, mornings and evenings, at Ard Gaoithe Business Park, Clonmel." },
  about: { file: "about.html", title: "About DJ O'Dwyer | Healthwise Clonmel",
    description: "DJ O'Dwyer founded Healthwise in 2011: MSc Performance Coaching, BACPR cardiac rehabilitation, thirty years in An Garda Síochána, strength and conditioning coach to county and Munster champions." },
  contact: { file: "contact.html", title: "Book a consultation | Healthwise Clonmel",
    description: "Book a consultation with DJ at Healthwise, Unit 12E Ard Gaoithe Business Park, Clonmel. Ring 086 242 2388 or send your details and we'll be in touch." },
  drivewise: { file: "drivewise.html", title: "Drivewise | Driver safety and wellness for companies | Healthwise",
    description: "Drivewise by Healthwise: driver wellness screening, functional movement testing, classroom education and on-road evaluation for company drivers." },
};

const substitute = (html) =>
  html
    .replace(/\{\{PULSE\}\}/g, pulseSvg("pulse--draw"))
    .replace(/\{\{RULE\}\}/g, ruleSvg())
    .replace(/\{\{STRIP:([a-z]+)\}\}/g, (_m, p) => strip(p))
    .replace(/\{\{TOKEN\}\}/g, TOKEN)
    .replace(/\{\{MAPS\}\}/g, MAPS);

let built = 0;
for (const name of readdirSync(join(here, "pages"))) {
  if (!name.endsWith(".html")) continue;
  const key = name.replace(/\.html$/, "");
  const meta = META[key];
  if (!meta) {
    console.warn(`  no metadata for pages/${name} - skipped`);
    continue;
  }
  const body = substitute(readFileSync(join(here, "pages", name), "utf8"));
  writeFileSync(join(here, meta.file), shell({ key, ...meta, body }));
  console.log(`  ${meta.file.padEnd(16)} ${body.length} chars of content`);
  built++;
}
console.log(`${built} page(s) built`);
```

- [ ] **Step 4: The home page partial**

`sites/healthwise/pages/home.html`:

```html
<!-- HERO. Big navy statement, the pulse line under it, one portrait. -->
<section class="hero">
  <div class="wrap hero__in">
    <div class="hero__copy">
      <p class="eyebrow" data-rise>Exercise &amp; lifestyle management · Clonmel</p>
      <h1 class="d h1" data-rise>Getting older doesn't mean slowing down.</h1>
      {{PULSE}}
      <p class="lead" data-rise>Coached exercise for adults over 40, over 60, and after a cardiac event. Small groups, one studio in Ard Gaoithe Business Park, and fifteen years of doing this properly.</p>
      <div class="hero__ctas" data-rise>
        <a class="btn" href="contact.html#book">Book a consultation</a>
        <a class="link" href="#programmes">See the three programmes</a>
      </div>
    </div>
    <figure class="hero__photo wipe">
      <img src="assets/hero-portrait.jpg" alt="A woman in her sixties mid-set at the Healthwise studio, laughing with someone off camera" width="1152" height="1440" />
      <figcaption class="hero__cap">The studio, Ard Gaoithe Business Park.</figcaption>
    </figure>
  </div>
</section>

<!-- Proof strip: the credentials, in one line. -->
<section class="proof" aria-label="DJ O'Dwyer's credentials">
  <div class="wrap">
    <ul>
      <li><b>MSc</b> Performance Coaching</li>
      <li><b>BACPR</b> cardiac rehabilitation</li>
      <li><b>30 years</b> An Garda Síochána</li>
      <li>Lecturer, <b>Garda College</b></li>
      <li>S&amp;C, <b>Clonmel Commercials</b> &amp; <b>Munster Rugby</b></li>
    </ul>
  </div>
</section>

<!-- Three programmes, three doors. -->
<section class="sec" id="programmes">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">Three programmes</p>
      <h2 class="d h2">One studio. Three programmes, each for a different point in life.</h2>
    </div>
    <div class="doors" data-stagger>
      <article class="door">
        <p class="eyebrow">40 to 60</p>
        <h3 class="d">Livewell</h3>
        <p>Strength, mobility and cardio for people with a job and a family. Five coached classes a week, mornings and evenings.</p>
        <img src="assets/livewell.jpg" alt="A woman around fifty resting a kettlebell at her side between sets" width="1440" height="1088" />
        <a class="link" href="livewell.html">Livewell 40–60</a>
      </article>
      <article class="door door--red">
        <p class="eyebrow">60 and over</p>
        <h3 class="d">Vitality</h3>
        <p>Gentle group exercise to keep you strong, steady on your feet and independent. For beginners, and for people coming back.</p>
        <img src="assets/vitality.jpg" alt="Three people over sixty-five on the studio's resistance machines with the coach beside them" width="1440" height="1088" />
        <a class="link" href="vitality.html">Vitality 60+</a>
      </article>
      <article class="door">
        <p class="eyebrow">After a cardiac event</p>
        <h3 class="d">Heartwise</h3>
        <p>Supervised exercise and lifestyle coaching for when hospital rehab ends and you are on your own. Since 2013.</p>
        <img src="assets/heartwise.jpg" alt="A man around seventy walking on a treadmill, the coach beside him with a hand near the console" width="1440" height="1088" />
        <a class="link" href="heartwise.html">Heartwise</a>
      </article>
    </div>
  </div>
</section>

<!-- The method. Numbered because it is a sequence. -->
<section class="sec sec--navy">
  <div class="wrap">
    <div class="sec__head">
      <p class="eyebrow">How it works</p>
      <h2 class="d h2">Adding years to your life, and life to your years.</h2>
    </div>
    <ol class="steps" data-stagger>
      <li class="step"><p class="step__n">01</p><h3 class="h3">A conversation</h3><p>Your history, your medication, what you want back. An assessment, no commitment.</p></li>
      <li class="step"><p class="step__n">02</p><h3 class="h3">Your programme</h3><p>Written for you, not for the class, and progressed gradually.</p></li>
      <li class="step"><p class="step__n">03</p><h3 class="h3">Coached sessions</h3><p>Small groups, never more than the coach can watch.</p></li>
      <li class="step"><p class="step__n">04</p><h3 class="h3">Progress, measured</h3><p>We track it and tell you plainly how you are doing.</p></li>
    </ol>
  </div>
</section>

<!-- The coach. -->
<section class="sec">
  <div class="wrap split">
    <figure class="wipe"><img src="assets/shopfront.jpg" alt="The Healthwise sign over the studio door, with the red pulse line across the glass" width="1600" height="900" /></figure>
    <div>
      <p class="eyebrow">The coach</p>
      <h2 class="d h2">DJ O'Dwyer</h2>
      <div class="body">
        <p>DJ opened Healthwise in 2011 after thirty years in An Garda Síochána, five of them teaching physical studies at the Garda College. He holds an MSc in Performance Coaching and is certified in cardiac rehabilitation, and he has coached strength and conditioning for Munster Rugby's development squads, Tipperary minor football, and Clonmel Commercials.</p>
        <p>The programmes here are what that experience looks like when it is pointed at ordinary people: careful, specific, and honest about what takes time.</p>
      </div>
      <a class="link" href="about.html">About DJ</a>
    </div>
  </div>
</section>

<!-- Things DJ has written. Three hand-picked posts; the blog itself is CMS-rendered. -->
<section class="sec sec--surf">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">Things DJ has written</p>
      <h2 class="d h2">Plain answers to the questions people bring in the door.</h2>
    </div>
    <div class="posts" data-stagger>
      <a class="post" href="/site/healthwise/blog/strength-training-after-60-a-beginners-guide-to-building-muscle-safely"><p class="eyebrow">Over 60</p><h3 class="h3">Strength training after 60: a beginner's guide to building muscle safely</h3><p>Why it is never too late to start, and how to start without hurting yourself.</p></a>
      <a class="post" href="/site/healthwise/blog/heart-health-after-40-key-tips-for-a-stronger-heart"><p class="eyebrow">Heart health</p><h3 class="h3">Heart health after 40: key tips for a stronger heart</h3><p>What the evidence actually says about exercise, food and sleep.</p></a>
      <a class="post" href="/site/healthwise/blog/the-truth-about-midlife-weight-gain-and-how-to-beat-it"><p class="eyebrow">40 to 60</p><h3 class="h3">The truth about midlife weight gain, and how to beat it</h3><p>Muscle, metabolism and the habits that hold, without a crash diet.</p></a>
    </div>
    <p style="margin-top:32px"><a class="link" href="blog.html">Read the blog</a></p>
  </div>
</section>

<!-- Closing band. -->
<section class="sec">
  <div class="wrap band">
    <h2 class="d h2">Not sure which programme? Start with a conversation.</h2>
    <a class="btn" href="contact.html#book">Book a consultation</a>
  </div>
</section>
```

- [ ] **Step 5: Build**

Run: `cd sites/healthwise && node build.mjs`
Expected: `  index.html       ~6800 chars of content` and `1 page(s) built`. Open `sites/healthwise/index.html` in a browser (`open index.html`): the nav, the hero with the pulse line drawn on, three doors (images missing until Task 8 — broken image boxes are expected), the navy method section, the footer.

- [ ] **Step 6: Verify the page splits into zones and is Studio-editable**

Create `sites/healthwise/check.ts` — the same transform the importer and the bundle use, then the CMS's own zone split and editability rule, over every built page:

```ts
// Run from app/:  npx tsx ../sites/healthwise/check.ts
// Reads the built pages exactly as tools/import-site.cjs will, splits each
// into head/content/tail the way the CMS does, and applies the Studio's
// editability rule. Fails if any page is refused or has an empty head or tail.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitPageBody, studioEditability } from "../../app/src/lib/cms/pageBody";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { readSitePages } = require("../../tools/lib/siteHtml.cjs") as {
  readSitePages: (dir: string, slug: string) => Array<{ path: string; body: string }>;
};

let bad = 0;
for (const p of readSitePages(here, "healthwise")) {
  const z = splitPageBody(p.body);
  const e = studioEditability(z);
  const ok = e.ok && z.head.length > 0 && z.tail.length > 0;
  if (!ok) bad++;
  console.log(
    p.path.padEnd(12),
    e.ok ? "editable" : `REFUSED: ${e.reason}`,
    `| head ${z.head.length} content ${z.content.length} tail ${z.tail.length}`,
  );
}
if (bad) {
  console.error(`${bad} page(s) would not import cleanly`);
  process.exit(1);
}
console.log(`${join(here, "*.html")}: every page splits into three zones and is Studio-editable`);
```

Run: `cd app && npx tsx ../sites/healthwise/check.ts`
Expected: `/            editable | head <n> content <n> tail <n>` with all three non-zero, then the closing line, exit 0. (The head holds the font links, the style, the `js` flag script and the JSON-LD; the tail holds the four scripts.)

- [ ] **Step 7: Commit**

```bash
git add .gitignore sites/healthwise/_style.css sites/healthwise/build.mjs sites/healthwise/check.ts sites/healthwise/pages/home.html sites/healthwise/index.html sites/healthwise/assets
git commit -m "feat(healthwise): the site's stylesheet, build script and home page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The three programme pages

**Files:**
- Create: `sites/healthwise/pages/livewell.html`
- Create: `sites/healthwise/pages/vitality.html`
- Create: `sites/healthwise/pages/heartwise.html`

**Interfaces:**
- Consumes: the shell, `{{RULE}}`, `{{STRIP:<programme>}}` from Task 5; photos from Task 8.

- [ ] **Step 1: Livewell**

`sites/healthwise/pages/livewell.html`:

```html
<section class="phero">
  <div class="wrap">
    <p class="eyebrow" data-rise>Livewell · 40 to 60</p>
    <h1 class="d h1" data-rise>Strong, mobile and awake, in the years that decide the next thirty.</h1>
    {{PULSE}}
    <p class="lead" data-rise>For working adults and parents between 40 and 60: the decade where muscle quietly goes, sleep gets shorter, and the aches start being called "age". Five coached classes a week, mornings and evenings, so it fits around a job.</p>
    <p data-rise style="margin-top:26px"><a class="btn" href="#book">Book a consultation</a></p>
    <figure class="phero__img wipe"><img src="assets/livewell-hero.jpg" alt="A small group of adults between forty-five and sixty working through a circuit with resistance bands" width="1440" height="960" /></figure>
  </div>
</section>

<section class="sec">
  <div class="wrap split split--wide">
    <div>
      <p class="eyebrow">Who it is for</p>
      <h2 class="d h2">People who have noticed the change and want to get ahead of it.</h2>
      <div class="body">
        <p>Livewell is for anyone aged 40 to 60 who is starting to feel the early signs: stiffness in the morning, less energy in the afternoon, weight that is harder to shift than it used to be, a back that complains after a day at a desk or in a van.</p>
        <p>Nothing here is extreme. Every class is coached, the loads are set for you, and the point is to build the strength, mobility and cardiovascular fitness that keep you independent and sharp for the next thirty years, not to leave you flattened for the next three days.</p>
      </div>
    </div>
    <figure class="wipe"><img src="assets/livewell.jpg" alt="A woman around fifty resting a kettlebell at her side between sets" width="1440" height="1088" /></figure>
  </div>
</section>

<section class="sec sec--surf">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">The classes</p>
      <h2 class="d h2">Five coached classes a week.</h2>
      <p class="lead">Pick the ones that suit you. Times are on the <a class="link" href="classes.html">timetable</a>.</p>
    </div>
    <div class="rows" data-stagger>
      <div class="row"><h3 class="h3">Women's Cardio Tone</h3><div><p>Cardio on the rowers, ski ergs, bikes and steppers, with light weights and bands for lean tone. Fifty-five minutes.</p><p class="row__meta">Mornings from 7am and evenings from 6pm</p></div></div>
      <div class="row"><h3 class="h3">MoveWell Strength for Women</h3><div><p>Strength training designed around menopause: targeted work to hold on to muscle and bone density through the years that take them fastest.</p></div></div>
      <div class="row"><h3 class="h3">Men's Gym</h3><div><p>Structured resistance training for lean muscle, with a cardiovascular finish on the rowers, ski ergs and bikes. Fifty minutes.</p><p class="row__meta">Mornings from 7am</p></div></div>
      <div class="row"><h3 class="h3">Women's MoveWell Mobility</h3><div><p>Flexibility, range of movement around the joints, and the guided stretching that takes the edge off common aches and pains.</p></div></div>
      <div class="row"><h3 class="h3">Women's Circuit</h3><div><p>A circuit of strength and aerobic stations for lean muscle tone and a stronger heart, coached the whole way round.</p></div></div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec__head">
      <p class="eyebrow">What you get from it</p>
      <h2 class="d h2">Independence and mobility, kept. Stress and sleep, improved.</h2>
    </div>
    <div class="tiles" data-stagger>
      <img src="assets/detail-hands.jpg" alt="Hands adjusting a light dumbbell" width="1152" height="1152" />
      <img src="assets/detail-band.jpg" alt="A resistance band around two ankles on the studio floor" width="1152" height="1152" />
      <img src="assets/detail-chat.jpg" alt="Two women talking after a class" width="1152" height="1152" />
      <img src="assets/detail-floor.jpg" alt="Trainers on the rubber floor in window light" width="1152" height="1152" />
    </div>
  </div>
</section>

<section class="sec sec--surf" style="padding-top:0">
  <div class="wrap">{{STRIP:livewell}}</div>
</section>
```

- [ ] **Step 2: Vitality**

`sites/healthwise/pages/vitality.html`:

```html
<section class="phero">
  <div class="wrap">
    <p class="eyebrow" data-rise>Vitality · 60 and over</p>
    <h1 class="d h1" data-rise>Feel better. Move easier. Stay independent.</h1>
    {{PULSE}}
    <p class="lead" data-rise>Gentle, coached group exercise for men and women over 60. For beginners, for anyone with limited mobility, and for people coming back after a health or cardiac event. Morning and afternoon classes in Clonmel.</p>
    <p data-rise style="margin-top:26px"><a class="btn" href="#book">Book a consultation</a></p>
    <figure class="phero__img wipe"><img src="assets/vitality-hero.jpg" alt="A woman around seventy on a seated leg press, smiling at the coach" width="1440" height="960" /></figure>
  </div>
</section>

<section class="sec">
  <div class="wrap split split--wide">
    <div>
      <p class="eyebrow">What a session actually is</p>
      <h2 class="d h2">Light weights, bands, bikes and treadmills. A coach in the room the whole time.</h2>
      <div class="body">
        <p>A Vitality class is small and quiet. You work on the machines and with light dumbbells and resistance bands, at a pace set for you, with DJ or one of the team watching and adjusting. Nobody is left to guess. Nobody is pushed past what is sensible.</p>
        <p>Over the weeks the aim is simple: more lean muscle, so daily things get easier; better balance, so a slip is less likely to become a fall; and more confidence and energy than you walked in with.</p>
      </div>
    </div>
    <figure class="wipe"><img src="assets/vitality.jpg" alt="Three people over sixty-five on the studio's resistance machines with the coach beside them" width="1440" height="1088" /></figure>
  </div>
</section>

<section class="sec sec--surf">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">Who comes</p>
      <h2 class="d h2">This is for you if any of these sound familiar.</h2>
    </div>
    <div class="rows" data-stagger>
      <div class="row"><h3 class="h3">You have never exercised</h3><p>Most people in the room started here. The first weeks are about learning the movements and finding your level, nothing more.</p></div>
      <div class="row"><h3 class="h3">Your mobility is limited</h3><p>Seated work, supported movements and a room laid out so you can get to everything. Bring the walking stick; it is welcome.</p></div>
      <div class="row"><h3 class="h3">You are coming back after a health event</h3><p>A hip, a knee, a spell in hospital, a cardiac procedure. We start from where you are now, and if a cardiac event is part of your story, <a class="link" href="heartwise.html">Heartwise</a> may be the better door.</p></div>
      <div class="row"><h3 class="h3">You want company as much as fitness</h3><p>The classes are social by design. People stay for the chat, and the chat is half of why they keep coming.</p></div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec__head">
      <p class="eyebrow">Build</p>
      <h2 class="d h2">Strength and stamina. Balance and mobility. Confidence and energy.</h2>
    </div>
    <div class="tiles" data-stagger>
      <img src="assets/detail-band.jpg" alt="A resistance band around two ankles on the studio floor" width="1152" height="1152" />
      <img src="assets/detail-hands.jpg" alt="Hands adjusting a light dumbbell" width="1152" height="1152" />
      <img src="assets/class-real.jpg" alt="A Vitality class on the machines at the Healthwise studio" width="1600" height="900" />
      <img src="assets/detail-chat.jpg" alt="Two women talking after a class" width="1152" height="1152" />
    </div>
  </div>
</section>

<section class="sec sec--surf" style="padding-top:0">
  <div class="wrap">{{STRIP:vitality}}</div>
</section>
```

- [ ] **Step 3: Heartwise**

`sites/healthwise/pages/heartwise.html`:

```html
<section class="phero">
  <div class="wrap">
    <img class="phero__mark" src="assets/heartwise-logo.png" alt="Heartwise — Educate, Motivate, Activate" data-rise />
    <p class="eyebrow" data-rise>After a cardiac event</p>
    <h1 class="d h1" data-rise>When hospital rehab ends, this is what comes next.</h1>
    {{PULSE}}
    <p class="lead" data-rise>Supervised exercise and lifestyle coaching for people who have had a cardiac procedure and finished their rehabilitation programme, and for people managing type 2 diabetes, blood pressure or weight. Small groups, monitored, at a comfortable pace. Since 2013.</p>
    <p data-rise style="margin-top:26px"><a class="btn" href="#book">Book a consultation</a></p>
    <figure class="phero__img wipe"><img src="assets/heartwise-hero.jpg" alt="A man in his sixties on a recumbent bike checking a chest-strap monitor" width="1440" height="960" /></figure>
  </div>
</section>

<section class="sec">
  <div class="wrap split split--wide">
    <div>
      <p class="eyebrow">The gap this fills</p>
      <h2 class="d h2">Rehab is seven weeks. The rest of your life is longer.</h2>
      <div class="body">
        <p>After a stent, a bypass or a cardiac event, the hospital programme gets you moving again, and then it ends. Most people are told to keep exercising and sent home to work out how. Heartwise is the room to do it in: coached, monitored, with people who have been through the same thing.</p>
        <p>DJ is certified in cardiac rehabilitation with the British Association for Cardiovascular Prevention and Rehabilitation. Sessions start gently, progress carefully, and pay attention to how you are on the day.</p>
      </div>
    </div>
    <figure class="wipe"><img src="assets/heartwise.jpg" alt="A man around seventy walking on a treadmill, the coach beside him with a hand near the console" width="1440" height="1088" /></figure>
  </div>
</section>

<section class="sec sec--tint">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">What Heartwise includes</p>
      <h2 class="d h2">Exercise, food, and the habits around them.</h2>
    </div>
    <div class="rows" data-stagger>
      <div class="row"><h3 class="h3">Coached, small-group exercise</h3><p>Strength, balance and gentle cardio on the machines, tailored to your history and progressed as you are ready. Never more people than the coach can watch.</p></div>
      <div class="row"><h3 class="h3">Nutrition, kept simple</h3><p>A plan built around your life rather than a diet sheet, and a food diary we look at together so the changes hold.</p></div>
      <div class="row"><h3 class="h3">Diabetes and blood pressure</h3><p>Regular exercise supports insulin sensitivity and healthy blood pressure. We coach the movement and the habits around it, alongside your GP's care, never instead of it.</p></div>
      <div class="row"><h3 class="h3">Confidence back</h3><p>Trust in your body is rebuilt the same way strength is: gradually, with steady wins, and with someone paying attention.</p></div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap band">
    <h2 class="d h2">Bring your discharge letter and your questions. We'll take it from there.</h2>
    <a class="btn" href="#book">Book a consultation</a>
  </div>
</section>

<section class="sec sec--surf" style="padding-top:0">
  <div class="wrap">{{STRIP:heartwise}}</div>
</section>
```

- [ ] **Step 4: Build, verify zones, commit**

Run: `cd sites/healthwise && node build.mjs` — expected `4 page(s) built`.
Run: `cd app && npx tsx ../sites/healthwise/check.ts` — expected four `editable` lines, exit 0.

```bash
git add sites/healthwise/pages sites/healthwise/livewell.html sites/healthwise/vitality.html sites/healthwise/heartwise.html
git commit -m "feat(healthwise): the Livewell, Vitality and Heartwise pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Classes, About, Contact, Drivewise

**Files:**
- Create: `sites/healthwise/pages/classes.html`
- Create: `sites/healthwise/pages/about.html`
- Create: `sites/healthwise/pages/contact.html`
- Create: `sites/healthwise/pages/drivewise.html`

- [ ] **Step 1: Classes (LegitFit inside the design)**

`sites/healthwise/pages/classes.html`:

```html
<section class="phero">
  <div class="wrap">
    <p class="eyebrow" data-rise>Classes and times</p>
    <h1 class="d h1" data-rise>Classes from 7am, mornings and evenings.</h1>
    {{PULSE}}
    <p class="lead" data-rise>Every class is coached and small. Book a place through the live timetable below; if you are new, <a class="link" href="contact.html#book">book a consultation</a> first and we'll point you at the right one.</p>
    <figure class="phero__img wipe"><img src="assets/classes-hero.jpg" alt="The Healthwise studio mid-morning with four people moving between stations in window light" width="1440" height="960" /></figure>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">The classes</p>
      <h2 class="d h2">Which one is for you.</h2>
    </div>
    <div class="rows" data-stagger>
      <div class="row"><h3 class="h3">Women's Cardio Tone</h3><div><p>Cardio on the rowers, ski ergs, bikes and steppers with light weights and bands. Livewell, 40 to 60.</p><p class="row__meta">7:00am, 55 minutes · 6:00pm, 60 minutes</p></div></div>
      <div class="row"><h3 class="h3">Men's Gym</h3><div><p>Structured resistance training with a cardio finish. Livewell, 40 to 60.</p><p class="row__meta">7:00am, 50 minutes</p></div></div>
      <div class="row"><h3 class="h3">MoveWell Strength for Women</h3><div><p>Menopause-aware strength work for muscle and bone. Livewell, 40 to 60.</p></div></div>
      <div class="row"><h3 class="h3">Women's MoveWell Mobility</h3><div><p>Flexibility and range of movement, guided. Livewell, 40 to 60.</p></div></div>
      <div class="row"><h3 class="h3">Women's Circuit</h3><div><p>Strength and aerobic stations, coached the whole way round. Livewell, 40 to 60.</p></div></div>
      <div class="row"><h3 class="h3">Vitality</h3><div><p>Gentle group exercise on machines, light weights and bands. 60 and over.</p><p class="row__meta">Morning and afternoon classes</p></div></div>
      <div class="row"><h3 class="h3">Heartwise</h3><div><p>Supervised sessions after a cardiac event, and for diabetes, blood pressure and weight. By consultation.</p></div></div>
    </div>
  </div>
</section>

<section class="sec sec--surf">
  <div class="wrap">
    <div class="sec__head">
      <p class="eyebrow">Book a place</p>
      <h2 class="d h2">The live timetable.</h2>
      <p class="lead">Bookings, memberships and packages are handled by LegitFit, the booking system Healthwise members already use.</p>
    </div>
    <div class="frame">
      <iframe src="https://legitfit.com/p/timetable/healthwise?isIframe=true" title="Healthwise class timetable and booking" loading="lazy" width="100%" height="800"></iframe>
      <p class="frame__note">Timetable not showing? <a class="link" href="https://legitfit.com/p/timetable/healthwise" rel="noopener">Open it on LegitFit</a>.</p>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap band">
    <h2 class="d h2">New here? Start with a conversation, not a class.</h2>
    <a class="btn" href="contact.html#book">Book a consultation</a>
  </div>
</section>
```

- [ ] **Step 2: About DJ**

`sites/healthwise/pages/about.html`:

```html
<section class="phero">
  <div class="wrap">
    <p class="eyebrow" data-rise>About</p>
    <h1 class="d h1" data-rise>DJ O'Dwyer.</h1>
    {{PULSE}}
    <p class="lead" data-rise>Thirty years a Garda. Five years teaching physical studies at the Garda College. A master's in performance coaching, a cardiac rehabilitation certificate, and county, Munster and national champions on the strength and conditioning side. Healthwise is what he built to point all of that at ordinary people.</p>
    <figure class="phero__img wipe"><img src="assets/shopfront.jpg" alt="The Healthwise sign over the studio door at Ard Gaoithe Business Park" width="1600" height="900" /></figure>
  </div>
</section>

<section class="sec">
  <div class="wrap split">
    <div>
      <p class="eyebrow">The idea</p>
      <h2 class="d h2">"Our business is all about adding years to your life and life to your years."</h2>
      <div class="body">
        <p>DJ opened Healthwise in 2011 as an exercise and lifestyle management studio: medical exercise for people with chronic conditions, exercise and nutrition programmes, and corporate wellness. In 2013 he added Heartwise, cardiac care for people who have finished hospital rehabilitation and have nowhere to go next.</p>
        <p>The approach has not changed. Every programme starts with a conversation, is written for the person rather than the class, and is coached in a room small enough that nothing is missed.</p>
      </div>
    </div>
    <figure class="wipe"><img src="assets/room-real.jpg" alt="The studio floor at Healthwise with rowers, a ski erg and the rack of dumbbells" width="1600" height="900" /></figure>
  </div>
</section>

<section class="sec sec--surf">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">Credentials</p>
      <h2 class="d h2">What the coaching is built on.</h2>
    </div>
    <div class="rows" data-stagger>
      <div class="row"><h3 class="h3">MSc Performance Coaching</h3><p>Setanta College, 2018 to 2020.</p></div>
      <div class="row"><h3 class="h3">Cardiac rehabilitation</h3><p>British Association for Cardiovascular Prevention and Rehabilitation, 2014.</p></div>
      <div class="row"><h3 class="h3">Strength and conditioning for sport</h3><p>Setanta College certificate, 2009 to 2011. NCEF levels 1 and 2 (Dublin City University, University of Limerick).</p></div>
      <div class="row"><h3 class="h3">An Garda Síochána</h3><p>Thirty years, including the Emergency Response Unit, and five years as fitness instructor and lecturer in physical studies at the Garda College.</p></div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec__head">
      <p class="eyebrow">Career highlights</p>
      <h2 class="d h2">Athletes and teams DJ has coached.</h2>
    </div>
    <ol class="tl" data-stagger>
      <li><p class="tl__y">2011 to 2014</p><h3 class="h3">Munster Rugby</h3><p>Strength and conditioning coach with the development squads.</p></li>
      <li><p class="tl__y">2013 to 2015</p><h3 class="h3">Tipperary minor football</h3><p>Fitness, strength and conditioning coach to the team that reached the 2015 All-Ireland final.</p></li>
      <li><p class="tl__y">2015</p><h3 class="h3">Clonmel Commercials</h3><p>Strength and conditioning coach to the first Tipperary club to win the Munster club football championship. County champions again in 2017.</p></li>
      <li><p class="tl__y">2016 onwards</p><h3 class="h3">Dean Gardiner</h3><p>Athletic development coach to the seven-time Irish super-heavyweight boxing champion.</p></li>
      <li><p class="tl__y">2017</p><h3 class="h3">St Mary's, Clonmel</h3><p>Physical development coach to the county intermediate hurling champions.</p></li>
      <li><p class="tl__y">2019</p><h3 class="h3">Individual athletes</h3><p>International walker Sam O'Sullivan and Irish women's soccer international Maebh Russell.</p></li>
    </ol>
  </div>
</section>

<section class="sec sec--navy">
  <div class="wrap band">
    <h2 class="d h2">Come in and talk to him.</h2>
    <a class="btn btn--light" href="contact.html#book">Book a consultation</a>
  </div>
</section>
```

- [ ] **Step 3: Contact (the full enquiry form)**

`sites/healthwise/pages/contact.html`:

```html
<section class="phero">
  <div class="wrap">
    <p class="eyebrow" data-rise>Contact</p>
    <h1 class="d h1" data-rise>Book a consultation.</h1>
    {{PULSE}}
    <p class="lead" data-rise>A conversation and an assessment, no commitment. Send your details and we'll be in touch to arrange a time, or ring <a class="link" href="tel:+353862422388">086 242 2388</a>.</p>
  </div>
</section>

<section class="sec" id="book">
  <div class="wrap split" style="align-items:start">
    <form class="form" method="post" action="/api/site/enquiry" data-enquiry>
      <div class="field"><label for="c-name">Your name</label><input id="c-name" name="name" type="text" autocomplete="name" required /></div>
      <div class="field"><label for="c-phone">Phone number</label><input id="c-phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" /></div>
      <div class="field"><label for="c-email">Email address</label><input id="c-email" name="email" type="email" autocomplete="email" inputmode="email" /></div>
      <div class="field"><label for="c-programme">Which programme are you interested in?</label>
        <select id="c-programme" name="programme">
          <option value="unsure">Not sure yet</option>
          <option value="livewell">Livewell, 40 to 60</option>
          <option value="vitality">Vitality, 60 and over</option>
          <option value="heartwise">Heartwise, after a cardiac event</option>
        </select>
      </div>
      <div class="field"><label for="c-about">A little about you (optional)</label><textarea id="c-about" name="about" maxlength="1000" placeholder="Do you exercise already? Anything we should know?"></textarea></div>
      <input type="hidden" name="token" value="{{TOKEN}}" />
      <input type="hidden" name="return" value="/contact" />
      <div class="form__hp" aria-hidden="true"><label>Company website<input name="company_website" type="text" tabindex="-1" autocomplete="off" /></label></div>
      <p class="form__ok" hidden>Thanks — we'll be in touch shortly.</p>
      <p class="form__err" hidden></p>
      <button class="btn" type="submit">Book a consultation</button>
      <p class="form__note">Give us a phone number or an email address, whichever you prefer. We use your details only to reply to you.</p>
    </form>
    <div class="facts">
      <div class="fact"><b>Ring DJ</b><a href="tel:+353862422388">086 242 2388</a></div>
      <div class="fact"><b>Email</b><a href="mailto:dj@healthwiseclonmel.ie">dj@healthwiseclonmel.ie</a></div>
      <div class="fact"><b>The studio</b>Unit 12E Ard Gaoithe Business Park,<br />Cashel Road, Clonmel, Co. Tipperary, E91 A6F4<br /><a class="link" href="{{MAPS}}" rel="noopener">Directions</a></div>
      <div class="fact"><b>Finding the unit</b>Ard Gaoithe Business Park is on the Cashel Road side of Clonmel. Healthwise is Unit 12E, with the sign over the door and parking outside.</div>
      <div class="fact"><b>Classes</b>From 7am, mornings and evenings. See the <a class="link" href="classes.html">timetable</a>.</div>
      <div class="fact"><b>Follow</b><a href="https://www.facebook.com/healthwiseclonmel/" rel="noopener">Facebook</a> · <a href="https://www.instagram.com/healthwise_clonmel" rel="noopener">Instagram</a></div>
    </div>
  </div>
</section>

<section class="sec sec--surf">
  <div class="wrap split split--wide">
    <figure class="wipe"><img src="assets/shopfront.jpg" alt="The Healthwise sign over the studio door" width="1600" height="900" /></figure>
    <div>
      <p class="eyebrow">What happens next</p>
      <h2 class="d h2">A conversation first. Then a plan.</h2>
      <div class="body">
        <p>We'll ring or email to arrange a time. The consultation is a conversation about your history, your medication if any, and what you want back, followed by a short assessment. From that, DJ writes a programme and tells you which class to start in.</p>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 4: Drivewise**

`sites/healthwise/pages/drivewise.html`:

```html
<section class="phero">
  <div class="wrap">
    <p class="eyebrow" data-rise>Drivewise · for companies</p>
    <h1 class="d h1" data-rise>Safer drivers, healthier teams.</h1>
    {{PULSE}}
    <p class="lead" data-rise>Drivewise is Healthwise's driver safety and wellness programme for companies with people on the road: wellness screening, functional movement testing, classroom education and on-road roadcraft evaluation, with confidential personal reports and a corporate summary.</p>
    <p data-rise style="margin-top:26px"><a class="btn" href="https://drivewiseireland.ie" rel="noopener">Visit Drivewise Ireland</a></p>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <div class="sec__head">
      {{RULE}}
      <p class="eyebrow">The programme</p>
      <h2 class="d h2">Four parts, tailored to the company.</h2>
    </div>
    <div class="rows" data-stagger>
      <div class="row"><h3 class="h3">Wellness screening</h3><p>Body composition, hydration, sleep and cardiovascular checks for each driver.</p></div>
      <div class="row"><h3 class="h3">Functional movement testing</h3><p>Grip strength, posture and aerobic fitness, with the ergonomics of the driving seat in mind.</p></div>
      <div class="row"><h3 class="h3">Classroom education</h3><p>Legal compliance, fatigue management and defensive driving.</p></div>
      <div class="row"><h3 class="h3">On-road evaluation</h3><p>Road, classroom, road again: anticipation, hazard identification and reaction time, coached by an advanced Garda driving instructor.</p></div>
    </div>
    <p style="margin-top:32px"><a class="link" href="https://drivewiseireland.ie" rel="noopener">Drivewise Ireland</a></p>
  </div>
</section>
```

- [ ] **Step 5: Build, verify, commit**

Run: `cd sites/healthwise && node build.mjs` — expected `8 page(s) built`.
Run: `cd app && npx tsx ../sites/healthwise/check.ts` — expected eight `editable` lines, exit 0. The `/classes` page's iframe is inside the content zone, which is allowed.

```bash
git add sites/healthwise
git commit -m "feat(healthwise): classes, about, contact and Drivewise pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Photography

**Files:**
- Create: `sites/healthwise/photos.mjs`
- Produce: the twelve `assets/*.jpg` named in Task 5's interface; `assets/photos.json` (the picks and their prompts).

**Interfaces:**
- Consumes: `FAL_KEY` from the production service via `railway run` (never committed, never written to a file).
- Produces: `node photos.mjs list | generate [name ...] | pick name:n [name:n ...]`.

- [ ] **Step 1: The pipeline script**

`sites/healthwise/photos.mjs`:

```js
#!/usr/bin/env node
// The Healthwise photography: an art-directed set generated with FLUX 1.1 Pro
// (the platform's own image model, fal.ai), reviewed by eye, then graded so
// generated and real photographs sit together.
//
//   railway run node ../sites/healthwise/photos.mjs list         (from app/)
//   railway run node ../sites/healthwise/photos.mjs generate     all shots, 4 candidates each
//   railway run node ../sites/healthwise/photos.mjs generate hero-portrait vitality
//   node photos.mjs pick hero-portrait:2 livewell:1 ...          copy + grade the keepers
//
// `railway run` injects the linked service's variables, which is how FAL_KEY
// reaches this script without ever being written down. Candidates land in
// assets/ai/ (gitignored); only picks are committed, with their prompts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const AI = join(here, "assets", "ai");
const ASSETS = join(here, "assets");
const ENDPOINT = "https://fal.run/fal-ai/flux-pro/v1.1";
const CANDIDATES = 4;

const ROOM =
  "Setting: a small bright exercise studio in Ireland; pale blue-grey painted walls; white and maroon resistance machines; black treadmills and recumbent bikes; a thin blue LED strip along one wall; a drop ceiling; large front windows with soft daylight; grey rubber floor.";
const PEOPLE =
  "Realistic Irish adults, ordinary gym clothes (plain t-shirts, leggings, trainers), natural skin, grey and white hair where the age calls for it, no stock smile, caught mid-movement or mid-conversation.";
const STYLE =
  "Documentary photograph, 35mm lens, natural window light, shallow depth of field, muted colour, quiet composition. No text, no logos, no signage, no watermark.";

const SHOTS = [
  { name: "hero-portrait", w: 1152, h: 1440, brief: "A woman in her mid-sixties with grey hair, mid-set with light dumbbells, seated, laughing at someone off-frame to the left. Waist-up, three-quarter view." },
  { name: "livewell", w: 1440, h: 1088, brief: "A woman around fifty resting a kettlebell at her side between sets, breathing, focused, looking down. Three-quarter length." },
  { name: "vitality", w: 1440, h: 1088, brief: "Three people over sixty-five seated on white resistance machines, a coach in a plain navy t-shirt standing beside one of them, talking. Wide shot." },
  { name: "heartwise", w: 1440, h: 1088, brief: "A man around seventy walking steadily on a treadmill, a coach beside him with one hand near the console, both calm. Side view." },
  { name: "livewell-hero", w: 1440, h: 960, brief: "A small group of four adults between forty-five and sixty working through a circuit with resistance bands, spaced across the room. Wide shot." },
  { name: "vitality-hero", w: 1440, h: 960, brief: "A woman around seventy on a seated leg press, smiling at a coach who is crouched beside the machine. Medium shot." },
  { name: "heartwise-hero", w: 1440, h: 960, brief: "A man in his mid-sixties on a recumbent bike, glancing down at a chest-strap heart monitor display, composed and unhurried. Medium shot." },
  { name: "classes-hero", w: 1440, h: 960, brief: "The room mid-morning: four people moving between stations, one on a rower, one with light dumbbells, sunlight across the floor. Wide shot from the doorway." },
  { name: "detail-hands", w: 1152, h: 1152, brief: "Close-up of an older person's hands adjusting a light dumbbell on a rack. Square." },
  { name: "detail-band", w: 1152, h: 1152, brief: "Close-up of a resistance band around two ankles in trainers on the grey rubber floor. Square." },
  { name: "detail-chat", w: 1152, h: 1152, brief: "Two women in their sixties talking after a class, water bottles in hand, one laughing, machines soft in the background. Square, medium shot." },
  { name: "detail-floor", w: 1152, h: 1152, brief: "A pair of trainers on the grey rubber floor with a band of window light across it, nothing else in frame. Square." },
];

const prompt = (s) => `${s.brief} ${PEOPLE} ${ROOM} ${STYLE}`;

async function generateOne(shot, i) {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY is not set. Run this through `railway run` from app/.");
  // A seed per candidate, logged with the prompt, so a keeper can be re-run
  // at another size or with a one-word change to the brief.
  const seed = Math.floor(Math.random() * 2_000_000_000);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
    body: JSON.stringify({
      prompt: prompt(shot),
      image_size: { width: shot.w, height: shot.h },
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
      seed,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const url = json.images?.[0]?.url;
  if (!url) throw new Error("fal returned no image");
  const img = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  const out = join(AI, `${shot.name}-${i}.jpg`);
  writeFileSync(out, Buffer.from(await img.arrayBuffer()));
  return { out, seed };
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "list") {
  for (const s of SHOTS) console.log(`${s.name.padEnd(16)} ${s.w}x${s.h}\n  ${prompt(s)}\n`);
} else if (cmd === "generate") {
  mkdirSync(AI, { recursive: true });
  const wanted = args.length ? SHOTS.filter((s) => args.includes(s.name)) : SHOTS;
  const log = existsSync(join(AI, "prompts.json")) ? JSON.parse(readFileSync(join(AI, "prompts.json"), "utf8")) : {};
  for (const shot of wanted) {
    for (let i = 1; i <= CANDIDATES; i++) {
      const { out, seed } = await generateOne(shot, i);
      log[`${shot.name}-${i}`] = { prompt: prompt(shot), seed };
      console.log("wrote", out, "seed", seed);
    }
  }
  writeFileSync(join(AI, "prompts.json"), JSON.stringify(log, null, 2));
  console.log(`${wanted.length * CANDIDATES} candidates in assets/ai/ — now look at every one.`);
} else if (cmd === "pick") {
  const picks = existsSync(join(ASSETS, "photos.json")) ? JSON.parse(readFileSync(join(ASSETS, "photos.json"), "utf8")) : {};
  const log = JSON.parse(readFileSync(join(AI, "prompts.json"), "utf8"));
  for (const a of args) {
    const [name, n] = a.split(":");
    const shot = SHOTS.find((s) => s.name === name);
    if (!shot || !n) throw new Error(`bad pick "${a}" — use name:n`);
    const src = join(AI, `${name}-${n}.jpg`);
    const out = join(ASSETS, `${name}.jpg`);
    // Grade: saturation down a tenth, a touch warm, progressive JPEG around q4.
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", "eq=saturation=0.9,colorbalance=rs=0.02:bs=-0.02", "-q:v", "4", out]);
    picks[name] = { candidate: Number(n), ...log[`${name}-${n}`], width: shot.w, height: shot.h };
    console.log("picked", name, "<-", `${name}-${n}.jpg`);
  }
  writeFileSync(join(ASSETS, "photos.json"), JSON.stringify(picks, null, 2));
} else {
  console.error("usage: photos.mjs list | generate [name ...] | pick name:n [name:n ...]");
  process.exit(1);
}
```

- [ ] **Step 2: Dry run**

Run: `cd sites/healthwise && node photos.mjs list`
Expected: twelve entries, each with its size and full prompt; no network calls.

- [ ] **Step 3: Generate (spends roughly 48 × 4c = under €2)**

Run: `cd app && railway run node ../sites/healthwise/photos.mjs generate`
Expected: 48 lines of `wrote .../assets/ai/<name>-<n>.jpg` and the closing count. If a request fails (429 or safety checker), re-run `generate <name>` for that shot only — it overwrites that shot's four files.

- [ ] **Step 4: Look at every candidate and pick**

Open each candidate (`open sites/healthwise/assets/ai/hero-portrait-1.jpg` and so on, or view the folder in Finder at large icons). Reject any image with: wrong hands or fingers, a face that reads as stock or synthetic, the wrong room (no blue-grey walls or white machines), visible text, more or fewer people than the brief, a body that does not read as the age asked for. For each of the twelve shots choose the strongest survivor. If a shot has no survivor, re-run `generate <name>` once; if still none, tighten the brief in `SHOTS` (say what went wrong, e.g. "hands resting flat on the thighs") and re-run.

Then: `cd sites/healthwise && node photos.mjs pick hero-portrait:N livewell:N vitality:N heartwise:N livewell-hero:N vitality-hero:N heartwise-hero:N classes-hero:N detail-hands:N detail-band:N detail-chat:N detail-floor:N` with the chosen numbers.

Expected: twelve `picked` lines; `assets/photos.json` lists each with its prompt.

- [ ] **Step 5: Size check**

Run: `ls -la sites/healthwise/assets/*.jpg | awk '{print $5, $9}'`
Expected: every file under 300000 bytes. For any over, re-encode: `ffmpeg -y -i sites/healthwise/assets/<name>.jpg -q:v 6 sites/healthwise/assets/<name>.jpg`.

- [ ] **Step 6: Rebuild and commit the picks**

```bash
cd sites/healthwise && node build.mjs && cd ../..
git add sites/healthwise/photos.mjs sites/healthwise/assets/photos.json sites/healthwise/assets/*.jpg
git commit -m "feat(healthwise): the photography, art-directed and generated to the brief

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Screenshot pass and fixes

**Files:**
- Create: `sites/healthwise/shots.mjs`
- Modify: whatever the screenshots show needs fixing in `_style.css` or `pages/*.html`

**Interfaces:**
- Consumes: `playwright-core` from `app/node_modules` and the Playwright Chromium at `~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`.
- Produces: `sites/healthwise/_shots/<page>-<width>.png` for every built page at 1440 and 390 (folder gitignored).

- [ ] **Step 1: The screenshot script**

`sites/healthwise/shots.mjs`:

```js
#!/usr/bin/env node
// Screenshot every built page at desktop and phone width and LOOK at them.
// Designing against your own markup does not work; the picture catches what
// reasoning does not (a wrapping wordmark, an image cropping a face, a form
// field too narrow for a phone number).
//
//   node shots.mjs                      all pages, file:// URLs
//   node shots.mjs http://localhost:3000/site/healthwise   after import
//
// playwright-core is resolved from app/node_modules; the browser is the
// Playwright Chromium already on this machine.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "app", "package.json"));
const { chromium } = require("playwright-core");

const CHROME = join(process.env.HOME, "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const base = process.argv[2] || null;
const out = join(here, "_shots");
mkdirSync(out, { recursive: true });

const pages = readdirSync(here).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
const b = await chromium.launch({ executablePath: CHROME });
for (const width of [1440, 390]) {
  const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  for (const name of pages) {
    const url = base
      ? `${base.replace(/\/$/, "")}${name === "index" ? "" : "/" + name}`
      : `file://${join(here, name + ".html")}`;
    await p.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    // Walk the page so every scroll-triggered reveal has fired before the capture.
    await p.evaluate(async () => {
      await new Promise((res) => {
        let y = 0;
        const step = () => { y += 500; window.scrollTo(0, y); if (y < document.body.scrollHeight) setTimeout(step, 120); else res(); };
        step();
      });
    });
    await p.waitForTimeout(900);
    await p.evaluate(() => window.scrollTo(0, 0));
    const file = join(out, `${name}-${width}.png`);
    await p.screenshot({ path: file, fullPage: true });
    console.log("wrote", file);
  }
  await p.close();
}
await b.close();
```

Add to `.gitignore`: `sites/healthwise/_shots/`.

- [ ] **Step 2: Shoot the static pages**

Run: `cd sites/healthwise && node build.mjs && node shots.mjs`
Expected: sixteen `wrote` lines.

- [ ] **Step 3: Look at every image, fix, repeat**

Open each PNG (Finder, or the Read tool if you are an agent). Check against the spec's visual system, in this order, and fix in `_style.css` / the partial, rebuild, reshoot:

1. **Hero** — the headline wraps in at most three lines at 1440 and four at 390; the pulse line sits under it, not beside it; the portrait's face is not cropped (adjust `object-position` on `.hero__photo img` if it is).
2. **Doors** — the three columns align at the top rule; images all the same height; the link sits at the bottom of every column.
3. **Method** — four steps in a row at 1440, two-by-two at 980, one column at 390; no orphaned words in the step titles.
4. **Rows** — at 390 the class name sits above its description, not squeezed beside it.
5. **Timetable frame** — the iframe is centred, 600 wide at 1440, full width at 390, no horizontal scroll on the page.
6. **Contact form** — fields are full width at 390; the button is at least 52px tall; the note under the form is legible.
7. **Footer** — four columns at 1440, two at 820, one at 390; nothing overflows.
8. **Nav at 390** — the logo, the phone link and the Menu button fit on one line; tapping Menu (test in a real browser: `open contact.html`) opens the list; the list is visible with JavaScript disabled.
9. **Photographs** — every generated image reads as this studio and the right age; if one does not, go back to Task 8 step 4 for that shot.

Stop when a full pass finds nothing. Typical fixes are one-line CSS changes; keep them in the sections of `_style.css` they belong to.

- [ ] **Step 4: Commit**

```bash
git add .gitignore sites/healthwise
git commit -m "feat(healthwise): screenshot pass — the fixes the pictures asked for

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Blog migration

**Files:**
- Produce: `app/public/sites/healthwise/_posts.json`, `app/public/sites/healthwise/blog/*` (cover and inline images)

**Interfaces:**
- Consumes: `tools/scrape-webflow-blog.cjs` (unchanged); `_redirects.json` from Task 4.
- Produces: the bundle the boot sync (`lib/cms/syncBundledSite.ts`, `seedBundledPosts`) seeds from.

- [ ] **Step 1: Scrape**

```bash
node tools/scrape-webflow-blog.cjs \
  --index https://www.healthwiseclonmel.ie/blog \
  --prefix /post/ \
  --site-slug healthwise \
  --site-host www.healthwiseclonmel.ie \
  --assets app/public/sites/healthwise/blog \
  --drop-cover logo \
  --out app/public/sites/healthwise/_posts.json
```

Expected: the tool reports 21 posts read, images downloaded into `app/public/sites/healthwise/blog/`, and writes `_posts.json`.

- [ ] **Step 2: Report and read it**

Run: `node tools/scrape-webflow-blog.cjs --report app/public/sites/healthwise/_posts.json`
Expected: 21 rows, each with a title, a slug, a non-empty body length and a cover. For any post whose cover is missing or is the logo, note the slug — the boot seed blank-fills covers later, but a missing cover on the index is a visible gap; find the card image on `https://www.healthwiseclonmel.ie/blog` and set `coverImageUrl` for that entry in `_posts.json` by hand (a root-relative `/sites/healthwise/blog/<file>` path after downloading the file into that folder).

Also confirm the three slugs the home page links to are present in the report: `strength-training-after-60-a-beginners-guide-to-building-muscle-safely`, `heart-health-after-40-key-tips-for-a-stronger-heart`, `the-truth-about-midlife-weight-gain-and-how-to-beat-it`. If a slug differs, change the link in `sites/healthwise/pages/home.html` to match and rebuild.

- [ ] **Step 3: Commit**

```bash
git add app/public/sites/healthwise/_posts.json app/public/sites/healthwise/blog
git commit -m "feat(healthwise): carry the 21 blog posts across from the Webflow site

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Import locally, verify in the CMS and Studio, bundle

**Files:**
- Produce: `app/public/sites/healthwise/_pages.json`, `app/public/sites/healthwise/assets/*` (copied by the importer)

**Interfaces:**
- Consumes: `tools/create-account.cjs`, `tools/import-site.cjs`, `tools/build-site-bundle.cjs`; the dev server; `EMAIL_TOKEN_SECRET` in `app/.env.local`.

- [ ] **Step 1: A local `healthwise` tenant and the secret**

```bash
node tools/create-account.cjs --slug healthwise --name "Healthwise" --admin christopher.walshe1994@gmail.com
grep -c "EMAIL_TOKEN_SECRET" app/.env.local || echo "EMAIL_TOKEN_SECRET=local-dev-secret-change-me" >> app/.env.local
```

Expected: `created tenant 'healthwise' (#N)` (or `already exists`) and `membership granted`. If the admin email is not a local identity, sign in to the local app once first (`/login`) so it exists, then re-run.

- [ ] **Step 2: Import**

Run: `node tools/import-site.cjs --tenant healthwise --slug healthwise --name "Healthwise"`
Expected: `created site 'healthwise' (#N) in Healthwise (healthwise#N)`, `imported 8 pages into site 'healthwise'`, `assets → app/public/sites/healthwise/`.

If the dev server was already running, restart it now: the boot sync (`syncBundledSites()` in `lib/automations/scheduler.ts`) seeds the blog from `_posts.json` at start-up, and it can only do that once the site exists in the tenant.

- [ ] **Step 3: Preview every page and the Studio**

Run: `cd app && npm run dev`, then open:

- `http://localhost:3000/site/healthwise` — the home page, animations running, images present.
- Each of `/site/healthwise/livewell`, `/vitality`, `/heartwise`, `/classes` (the LegitFit timetable loads inside the frame), `/about`, `/contact`, `/drivewise`.
- `http://localhost:3000/site/healthwise/blog` — the index wearing the site's nav and footer, 21 posts with covers; open one.
- Sign in at `/login`, switch to Healthwise, open `/cms/healthwise`: eight pages listed. Open each with the Studio (`/cms/healthwise/studio` then the page) — every page opens on the canvas; none shows the "cannot edit safely" panel. Make a one-word edit on the About page, publish, reload `/site/healthwise/about` and see it.

Run: `cd sites/healthwise && node shots.mjs http://localhost:3000/site/healthwise` and look at the sixteen images the way Task 9 did — the imported render must match the static one.

- [ ] **Step 4: Redirects and the enquiry, end to end**

```bash
curl -sI http://localhost:3000/site/healthwise/about-healthwise | grep -iE "^HTTP|^location"
curl -sI http://localhost:3000/site/healthwise/sign-up | grep -iE "^HTTP|^location"
curl -sI "http://localhost:3000/site/healthwise/post/heart-health-after-40-key-tips-for-a-stronger-heart" | grep -iE "^HTTP|^location"
curl -sI http://localhost:3000/site/healthwise/post/no-such-post | grep -iE "^HTTP"
curl -sI http://localhost:3000/site/healthwise/inspire-health-fitness | grep -iE "^HTTP|^location"
```

Expected, in order: `308` + `location: /site/healthwise/about`; `308` + `/site/healthwise/contact`; `308` + `/site/healthwise/blog/heart-health-after-40-key-tips-for-a-stronger-heart`; `404`; `308` + `https://inspirehealthandfitness.ie`.

Then in the browser: `/site/healthwise/contact`, fill the form with a test name and phone, submit. Expected: the inline "Thanks — we'll be in touch shortly." Open `/leads` in the Healthwise tenant: the lead is on the board with source `website` and the programme in its notes. Submit the same phone again: no second card; the activity log shows "Repeat website enquiry". Then, with JavaScript disabled in the browser (DevTools → Settings → Debugger → Disable JavaScript), submit once more with a new phone: the page reloads at `/site/healthwise/contact?ok=1` and the enquiry strip's thank-you is visible. Delete the test leads from the board afterwards.

- [ ] **Step 5: Bundle and commit**

```bash
node tools/build-site-bundle.cjs --slug healthwise --tenant healthwise
git add app/public/sites/healthwise
git commit -m "feat(healthwise): the site bundle — pages, posts, redirects and assets ship with the build

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected from the bundle tool: `8 pages -> app/public/sites/healthwise/_pages.json` and `rev <hash> (new)`.

---

### Task 12: Deploy, tracking, go-live

**Interfaces:**
- Consumes: `railway up` from `app/`; the CMS site settings at `/cms/healthwise` (tracking ids); the Domains page at `/cms/healthwise/domains`; the `CMS_SITE_HOSTS` service variable.

- [ ] **Step 1: Pre-deploy gate**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: all three clean. Then `git push origin main`.

- [ ] **Step 2: Deploy and verify the preview host**

Run: `cd app && railway up`, wait for the build (`railway status` shows the service online with the new deployment), then:

```bash
curl -sI https://www.adonisagent.ie/site/healthwise | grep -i "^HTTP"
curl -sI https://www.adonisagent.ie/site/healthwise/about-healthwise | grep -iE "^HTTP|^location"
curl -s https://www.adonisagent.ie/site/healthwise/blog | grep -c "/site/healthwise/blog/"
```

Expected: `200`; `308` + `/site/healthwise/about`; a count of at least 21. Open `https://www.adonisagent.ie/site/healthwise/contact` and submit a test enquiry; confirm it lands on the production Healthwise leads board (sign in as admin, switch tenant, `/leads`); delete it.

- [ ] **Step 3: Tracking ids**

In the production CMS, `/cms/healthwise` (site settings): set Google tag id `G-F46FGCY1D3` and Meta pixel id `495090635138220`, save. Reload the public home page and confirm both tags are present: `curl -s https://www.adonisagent.ie/site/healthwise | grep -cE "G-F46FGCY1D3|495090635138220"` → `2` or more.

- [ ] **Step 4: Domain (needs the client's DNS access)**

1. `/cms/healthwise/domains`: add `healthwiseclonmel.ie` and `www.healthwiseclonmel.ie`. Each shows a TXT record `_adonisagent-verify.<host>` and a value.
2. At the registrar: publish both TXT records. Back in Domains, click verify on each → `verified`. Set `www.healthwiseclonmel.ie` as the primary host.
3. Railway → the `clientflow` service → Variables: append `,www.healthwiseclonmel.ie=healthwise,healthwiseclonmel.ie=healthwise` to `CMS_SITE_HOSTS` (keep the existing entries). Redeploy (`railway up` from `app/`).
4. Railway → the service → Settings → Domains: add both hostnames; Railway shows the CNAME/A targets.
5. At the registrar: point `www` (CNAME) and the apex (A/ALIAS as Railway instructs) at Railway. Wait for the certificate.
6. Check: `curl -sI https://www.healthwiseclonmel.ie | grep -i "^HTTP"` → `200`; `curl -sI https://www.healthwiseclonmel.ie/about-healthwise | grep -i location` → `location: /about` (no `/site/` prefix on the mapped host); `https://www.healthwiseclonmel.ie/sitemap.xml` lists the eight pages and the posts.
7. Webflow: unpublish the old site only after step 6 passes.

- [ ] **Step 5: Hand-over note to the client**

Send DJ the five items from the spec's section 12 (a portrait, the Eircode, class hours, which room is which, the three featured posts), and the fact that every page is now editable at `/cms/healthwise` in Studio.

- [ ] **Step 6: Commit anything the go-live changed**

If any file changed during go-live (a corrected slug, a tracking tweak), commit it:

```bash
git add -A sites/healthwise app/public/sites/healthwise
git commit -m "chore(healthwise): go-live adjustments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| 3 Site map (8 pages + blog) | 5, 6, 7, 10 |
| 4 Visual system | 5 (stylesheet), 9 (checked in pictures) |
| 5 Photography (12 generated, 3 real) | 5 step 1 (real), 8 (generated) |
| 6 Build shape | 5 |
| 7 Enquiries become leads | 1, 2, 3; exercised end to end in 11 step 4 |
| 8 LegitFit inside the design | 7 step 1 |
| 9 Blog migration + redirects | 4, 10; exercised in 11 step 4 |
| 10 Import, publish, go-live | 11, 12 |
| 11 Testing and acceptance | unit tests in 1, 3, 4; visual in 9, 11; acceptance in 11 and 12 |
| 12 Needs the client | 12 step 5 |
