# Social Connect + Publish — Slice 1 of the AI Action Center

**Date:** 2026-05-24
**App:** ClientFlow / Renova (Next.js 14, SQLite + Drizzle, deployed on Railway at app.clientflow.ie)

## Background & vision

The end goal is an **AI "Things to do" action center** on the dashboard: it reads the clinic's business metrics, recommends actions (content to post, clients to re-engage, etc.), and a **"Do it"** button executes them. The model is self-serve SaaS — each clinic logs in, **connects their own Facebook/Instagram**, generates content, and the app posts to *their* accounts.

That vision rests on a foundation: **the app must be able to connect a clinic's social accounts and publish to them.** This spec covers that foundation — **Slice 1** — and nothing more. The action center, scheduling, and ads are later slices (sketched at the end) that this design must leave room for.

## Slice 1 scope

A clinic connects their Facebook Page + linked Instagram, generates an **image** in Content Studio, clicks **"Post to social,"** picks targets (FB / IG) and a caption, and it **publishes to their own accounts**. Direct **Meta Graph API**, organic **image + caption only**, running in Meta **development mode** (works for the app owner + added test users; App Review gates go-live for other clinics).

**Explicitly out of scope for Slice 1:** blog/video/Reels posting, scheduling, the AI recommendation engine + "Do it", ad campaigns, multi-tenant token isolation (built single-tenant but shaped for later).

## Architecture

### 1. Connect flow (OAuth)
- New page **Settings → Integrations → Social** (mirrors the existing `settings/integrations/whatsapp` pattern).
- **"Connect Facebook"** → Facebook Login OAuth requesting scopes: `pages_show_list`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `business_management`.
- Callback route `GET /api/social/callback`: exchange `code` → short-lived user token → exchange for **long-lived** token → `GET /me/accounts` to list Pages. The clinic picks one Page; we fetch its **page access token** and its linked **IG business account id** (`GET /{page-id}?fields=instagram_business_account`).
- Connection panel shows status: connected Page name, IG handle, "Disconnect", and a re-connect prompt if the token is invalid.

### 2. Token storage (`lib/social/config.ts`)
- A `social_connections` settings record: `{ pageId, pageName, pageAccessToken, igUserId, igUsername, connectedAt, status }`.
- Stored via the existing settings/secrets mechanism (same approach as the Whapi token). **Single-tenant (Renova) now**, but the record is shaped so the in-progress tenancy refactor can scope it per-clinic without redesign. Token is a secret — never logged; note encryption-at-rest as a follow-up hardening item.

### 3. Publish engine (`lib/social/publish.ts`)
- Pure-ish module, provider calls isolated here. `publishImagePost({ targets, imageUrl, caption })` → returns `{ facebook?: Result, instagram?: Result }` where each Result is `{ ok, postId?, error? }`.
- **Facebook Page:** `POST /{page-id}/photos` with `url` (or `source`) + `caption` + page token.
- **Instagram (two-step):** `POST /{ig-user-id}/media` `{ image_url, caption }` → `creation_id`; then `POST /{ig-user-id}/media_publish` `{ creation_id }`.
- A target that fails does not abort the other; each result is reported independently (partial success is normal).

### 4. Public image URL
- IG (and FB by URL) fetch the image **server-side from a public `https` URL**, so a Content Studio image must be reachable without auth. Prod is public at app.clientflow.ie.
- **Requirement to verify during build:** confirm image-library assets are servable without authentication. If they're auth-gated, Slice 1 adds a minimal **public media route** (e.g. `/api/social/media/[id]` serving the asset, ideally via an unguessable token) so Meta can fetch it.

### 5. Content Studio hook
- On a generated **image** (Content Studio → Images), add a **"Post to social"** button → modal:
  - **Targets:** Facebook / Instagram checkboxes, shown only for connected networks.
  - **Caption:** textarea **pre-filled with an AI-suggested caption** (from the image's prompt/context), fully editable. (Suggested-not-silent — captions are public and brand-voiced.)
  - **Publish** → server action → publish engine → shows per-target result (success with a link, or error). Writes an `activity_log` entry (`social.posted` / `social.post_failed`).

### Error handling
- Expired/revoked/invalid token → surface "reconnect" prompt on the modal and the integration page.
- Page has no linked IG business account → clear message, disable the IG target.
- Image URL not public/reachable → guard before calling Meta, with a fixable error.
- Partial success (FB ✓ / IG ✗ or vice-versa) → report each target's outcome; do not claim full success.

## Decisions (resolved)
- **Sync publish** for images (fast, simple); move to a queue when video/scheduling arrive.
- **Single-tenant storage now**, shaped for per-tenant later — does not block on the tenancy refactor.
- **AI-suggested + editable caption**, never silent-auto for public content.
- **Direct Meta Graph API**, app owned by us — no per-account aggregator fees; we own App Review.

## Meta setup (parallel, user-driven; I guide)
- Create a **Meta app**; add Facebook Login + the Pages/Instagram products.
- Start **Business Verification.** A **sole trader does NOT need a limited company** — verify as an individual/sole proprietor with government ID + business details (an Irish CRO Business Name registration + tax-registration proof of address smooth this; details must match the Page + Business portfolio exactly).
- Request **Advanced Access** (App Review) for the publishing permissions to go live for clinics beyond test users.
- **Build proceeds in dev mode meanwhile** — fully testable by the owner + added test accounts before approval.

## Testing / acceptance
- Connect a real test Page + IG; verify status panel reflects it.
- Generate an image in Content Studio → Post to social → confirm it appears on **both** the FB Page and IG with the caption.
- Error cases: revoked token → reconnect prompt; Page with no IG → IG disabled; non-public image → guarded; FB-ok/IG-fail → per-target reporting.
- Typecheck + `build:prod` green; visual check via the existing local-screenshot recipe.

## Roadmap (designed-for, not built here)
- **Slice 2 — More content types:** blog (FB link/text post), video/Reels (heavier media flow).
- **Slice 3 — AI action center:** dashboard "Things to do" card; AI reads metrics (lapsed clients, empty slots, expiring packages, lead backlog, posting cadence) → ranked recommendations → **"Do it"**. *This is where the autonomy decision lands* — risk-tiered (auto-run safe generative work, confirm anything outward-facing) is the working assumption.
- **Slice 4 — Scheduling / content calendar.**
- **Slice 5 — Ad campaigns:** Meta **Marketing API** (`ads_management`, separate App Review), each clinic connects an ad account with billing; **AI drafts campaign → human approves → launch**, with **hard budget caps** — never fire-and-forget (real money).
