# Implementation Plan — Social Connect + Publish (Slice 1)

**Spec:** `docs/superpowers/specs/2026-05-24-social-connect-publish-design.md`
**Scope:** Connect a clinic's FB Page + IG via direct Meta Graph API; publish an image + caption from Content Studio. Meta **dev mode**. Single-tenant (Renova), shaped for per-tenant later.

**Conventions:** Graph API `v22.0` (use the current stable at build time). Each phase ends with `npx tsc --noEmit` clean; UI phases verified via the local Playwright screenshot recipe; nothing deployed until the slice is whole and `build:prod` is green. Phases 1, 5, and the non-OAuth parts of 6 can be built before Meta credentials exist; OAuth (2–3) and live publish (end of 5/6) need the Meta app from Phase 0.

---

## Phase 0 — Meta app scaffolding *(user-driven; I guide + wire env)*
- **User:** create a Meta app (Business type), add **Facebook Login**; note **App ID** + **App Secret**; set Valid OAuth Redirect URIs: `https://app.clientflow.ie/api/social/callback` and `http://localhost:3000/api/social/callback`. Add yourself + a test Page/IG as test users.
- **Me:** add `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION=v22.0` to `.env.local` (local) and Railway vars (prod). Add a `lib/social/graph.ts` constant for the base URL + version.
- **Verify:** env vars load; the OAuth dialog URL opens the Facebook permission screen for a test user.

## Phase 1 — Connection model + config module
- `lib/social/config.ts`: `SocialConnection` type (`pageId, pageName, pageAccessToken, igUserId, igUsername, connectedAt, status`); `getSocialConnection()` / `setSocialConnection()` / `clearSocialConnection()` / `isSocialConnected()` over a `social_connection` settings key (reuse `lib/settings` `readKey`/`setKey`, like `lib/whatsapp/config.ts`). Token treated as a secret — never logged.
- **Verify:** `tsc` clean; round-trip read/write in a throwaway node check.

## Phase 2 — OAuth connect flow
- `lib/social/oauth.ts`: build the dialog URL (scopes `pages_show_list, pages_manage_posts, instagram_basic, instagram_content_publish, pages_read_engagement, business_management`) with a signed `state` (CSRF); token exchanges (`code`→short-lived→**long-lived** via `fb_exchange_token`); `GET /me/accounts` for Pages; per-Page fetch of page access token + `instagram_business_account{id,username}`.
- `GET /api/social/callback`: validate `state`, run the exchanges, resolve the Page (auto-select if one; otherwise stash candidates for a pick step), save the connection, redirect to the settings page with a status flag. Public in middleware (like the whatsapp webhook), but state-validated.
- **Verify:** complete OAuth with a dev-mode test account; connection persists; invalid/denied paths handled.

## Phase 3 — Settings → Integrations → Social page
- `app/settings/integrations/social/page.tsx` + `components/settings/SocialConnectPanel.tsx` (mirror the WhatsApp integration page): "Connect Facebook" button (→ dialog URL) or connected state (Page name, IG handle, connected date), **Disconnect** action, reconnect prompt when `status==="invalid"`. If multiple Pages, a one-time Page picker.
- `disconnectSocialAction` (clears connection; best-effort `DELETE /{page}/permissions`). Link from the settings index (an icon entry like the WhatsApp one).
- **Verify:** connect → status shows; disconnect → back to empty; screenshot via local recipe.

## Phase 4 — Public image URL
- Confirm whether image-library assets are anonymously fetchable. **If not:** add `GET /api/social/media/[token]` that streams the asset for a short-lived unguessable token, excluded from the auth middleware. A helper `publicImageUrl(asset)` returns the absolute `https` URL.
- **Verify:** fetch the URL with no cookie (curl) returns the image bytes; confirm a Meta IG container call accepts it.

## Phase 5 — Publish engine
- `lib/social/publish.ts`: `publishImagePost({ targets: ("facebook"|"instagram")[], imageUrl, caption })` → `{ facebook?: {ok,postId?,error?}, instagram?: {...} }`. FB: `POST /{pageId}/photos` (`url`,`caption`,page token). IG: `POST /{igUserId}/media` (`image_url`,`caption`) → `creation_id` → `POST /{igUserId}/media_publish`. A failing target never aborts the other; map common Meta error codes (190 token expired → mark connection `invalid`) to friendly messages.
- `postToSocialAction(...)` server action wrapping it + writing `activity_log` (`social.posted` / `social.post_failed`).
- **Verify:** unit check of result shaping with mocked fetch; a real publish to the test Page + IG appears on both.

## Phase 6 — Content Studio "Post to social"
- Add a **"Post to social"** button on generated images in the Content Studio Images tab → `PostToSocialModal`: target checkboxes (only connected networks; link to Settings if none), caption textarea **pre-filled by an AI suggestion**, Publish → `postToSocialAction` → per-target result (link or error).
- `suggestCaptionAction`: small Anthropic call (reuse `lib/ai` patterns + business context) from the image's prompt/context; falls back to a generic on-brand caption if no context.
- **Verify:** end-to-end — generate image → Post to social → live on FB + IG; caption editable; activity logged.

## Phase 7 — Error handling + polish
- Token-invalid → reconnect prompts on modal + settings; no linked IG → IG target disabled with a note; non-public image → guarded pre-call; partial success → honest per-target reporting. Confirm `build:prod` green; deploy.
- **Verify:** exercise each error path; deploy and smoke-check the settings + Content Studio routes.

## Phase 8 — App Review prep *(user-driven, parallel; does not block dev-mode build)*
- Business Verification (sole trader OK — gov ID + business details; CRO Business Name + tax-reg address smooth it). Request **Advanced Access** for the publishing permissions; record a screencast of the connect→post flow for submission. Flip the app to Live once approved → real clinics can connect.

---

## Out of scope (later slices, per spec)
Blog/video/Reels posting · scheduling/calendar · the **AI action center** ("Things to do" + "Do it", incl. the autonomy decision) · **ad campaigns** (Marketing API, `ads_management`, approve-before-spend + budget caps) · per-tenant token isolation (built single-tenant, shaped for the tenancy refactor).
