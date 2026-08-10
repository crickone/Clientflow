# ClientFlow — Improvement Plan (August 2026)

Source: 4 parallel deep audits (architecture/data, security, performance/ops, code quality/UX) run 2026-08-09 against the deployed branch (`feat/agentic-os-sales-agent`), plus this month's feature-discovery reports (marketing/operations/finance stubs). Effort: S = hours, M = a day or two, L = multi-day.

**Overall verdict:** the codebase is unusually careful for its stage — tenant isolation is structurally strong (per-tenant SQLite + fail-closed context binding), the agent platform's write-approval gate is solid and well-tested, route guards are complete, secrets are clean, and there IS a backup system, CI, and a durable run store. The risks are concentrated in: (1) unverified backups + zero prod observability, (2) two real XSS paths on the shared origin, (3) the €25 AI cap not actually capping ~6 call sites, (4) half-built features that look live, and (5) scale mechanics (migrations, media, deploy process) that work at 10 tenants and break at 100.

---

## Theme A — Don't lose data; know when things break (DO FIRST)

| # | Item | Why (simply) | Effort |
|---|---|---|---|
| A1 | **Verify off-box backups are ON in Railway** (`BACKUP_S3_*`/`BACKUP_R2_*` env groups; `lib/backup/runBackup.ts:64-93` silently no-ops without them, only console.logs failure) | The backup code exists but looks unconfigured. If the volume dies with backups off, every gym's data is gone — company-ending. Verify in the Railway dashboard TODAY. | S |
| A2 | **Back up media, not just .db files** (`runBackup.ts:22-44` snapshots only DBs; all logos/videos/site assets live on the same volume; the only .bak files are ON that volume) | Even with A1 on, a volume loss still destroys every client's images/videos/content permanently. | M |
| A3 | **Error tracking + health endpoint + alerting** (no Sentry, no /api/health, 105 raw console.* calls, `instrumentation.ts` is a no-op) | Today, when prod breaks, the only alarm is a customer complaining. Add Sentry via the existing instrumentation hook + a health route Railway can probe. | M |
| A4 | **Process crash guards** (no `unhandledRejection`/`uncaughtException` handlers; agent runs execute in detached async blocks) | One bad background run can crash the single Node process serving EVERY tenant. Two lines of defense, big blast-radius reduction. | S |
| A5 | **Scheduler hardening**: boot-time catch-up for missed backup/lapse runs + wire an external Railway cron to the existing `/api/cron/*` endpoints (backup/lapse fire once at 3/4am; a redeploy at that moment silently skips the night) | A deploy at 3am shouldn't silently mean "no backup last night". | S |

## Theme B — Security hardening (before onboarding more gyms)

| # | Item | Why | Effort |
|---|---|---|---|
| B1 | **Fix stored XSS on the shared origin (HIGH)**: CMS `clientflow-live` renders tenant HTML verbatim (`cms/sites/renova/templates.tsx:41`, save path re-injects scripts `studio/actions.ts:28-30`); SVG uploads served inline same-origin (`library-media/[id]/route.ts:27`); the regex sanitizer (`lib/cms/html.ts:12-35`) is bypassable | A malicious tenant admin can plant a script that runs in ANOTHER tenant's logged-in session (same origin = their cookie works) → cross-tenant takeover. Fix: real sanitizer (sanitize-html/DOMPurify), block or attachment-serve SVG, add CSP + HSTS (`next.config.mjs` has neither). | M |
| B2 | **Tenant-scope the CMS media library** (`cms_library_assets` has no tenant_id — `control.ts:163-173`; any tenant lists everyone's assets; `/library-media/<id>` is public + sequential-id enumerable) | Cross-tenant data exposure + anyone on the internet can scrape the whole image pool by counting up ids. | M |
| B3 | **Rate-limit client-app login** (`api/client-auth/login` has none; coach/platform logins do; sessions last 60 days) | Unlimited password-guessing against gym members' accounts. Copy the existing rateLimit pattern. | S |
| B4 | **Dedicated `EMAIL_TOKEN_SECRET`** (`google/tokenCrypto.ts:11-16` falls back to GOOGLE_CLIENT_SECRET, then a hardcoded dev string) | If the Google secret is ever rotated (routine!), every tenant's Gmail silently breaks forever. Fail closed on a dedicated key. | S |
| B5 | Small fixes: revoke sessions on password change; timing-safe whapi webhook compare (`whatsapp/whapi.ts:141`); CSV formula-injection guard (`api/export/route.ts:9`); add `.dockerignore` (docs claim it exists; it doesn't — a `docker build` would bake clinic.db PII into the image) | Cheap, standard hygiene. | S each |

## Theme C — Make the €25 AI cap TRUE (cost integrity)

| # | Item | Why | Effort |
|---|---|---|---|
| C1 | **Meter the ~6 bypassing AI call sites** (`draftFollowup`, `/api/assistant/brief` (runs per dashboard load!), `triageMessage` (auto-runs on inbound mail), `refreshSlides`, `planCut`, `altText` — all `new Anthropic()` with no `assertUnderCap`/`recordUsage`) | The "€25/month cap" doesn't actually cap these, and the shiny per-model spend breakdown under-reports real cost. Route everything through the shared metered client. | M |
| C2 | Centralize model ids on `MODELS` (13 hardcoded `claude-opus-4-7` literals) | One place to change models/prices, not a hunt. | S |
| C3 | OpenRouter retry/backoff (`providers/openrouter.ts:337` fails a whole turn on one 429/5xx; Anthropic SDK retries, OpenRouter path doesn't) | Users on Kimi/DeepSeek/GPT-5 see worse reliability for no reason. | S |
| C4 | Make the cap a per-tenant setting (UI copy already says "raise it in Settings"; it's a hardcoded 2500) + light per-user throttle on chat routes | Honest UI + upsell lever + burst protection. | S |

## Theme D — Ship honestly: finish or clearly label the half-built features

| # | Feature | Reality today | Move |
|---|---|---|---|
| D1 | **Automations** (12-trigger catalog UI) | Only birthday email + 3 immediate email events actually fire; delays/channels ignored | Short-term: label unwired triggers "coming soon" (S). Real: build the dispatcher (L) |
| D2 | **Blog scheduling** | `scheduledFor` column exists; nothing publishes it | Tiny worker in the daily scheduler → makes Marketing agent scheduling real (S–M) |
| D3 | **Social posting** | Complete Meta lib, zero wiring (no OAuth connect, no server-side image render) | Wire it (L) or keep the current honest "can't post socials" stance |
| D4 | **Member billing** | Payments = records only; `nextBillingDate` dead; platform billing on a dev stub awaiting CreatePay/Cardstream creds | The big unlock (Finance agent + real dunning + revenue features). Gated on creds — chase CreatePay (L) |
| D5 | **Forms public page** (`/f/<slug>`) | Slugs generated + stored; no public route exists | Build render + submissions (M) |
| D6 | **Client app assignment** | Per-client nutrition/workout assignment deferred; `clientApp.ts:213-231` has tenant-wide plan reads (dead but dangerous if naively wired) | Scope per-client before wiring (M) |
| D7 | **`/api/assistant/chat`** | Likely orphaned as an endpoint (dashboard now uses the orchestrator; no mounted UI caller found), but it duplicates the agent loop and would die on disconnect | Verify, then either retire or fold onto `runAgentTurn` — kills the most dangerous duplication (M) |

## Theme E — Scale readiness (before ~50–100 tenants)

| # | Item | Why | Effort |
|---|---|---|---|
| E1 | **Real migration system** (idempotent `CREATE IF NOT EXISTS` + ADD COLUMN can never CHANGE a column; failures are per-tenant and silent; schema is defined twice — Drizzle + raw DDL — with nothing keeping them in sync) | The first time you need to change (not add) a column, you're hand-migrating N tenant files with no record of which succeeded. Adopt drizzle-kit versioned migrations + schema_version per DB; generate DDL from one source. | L |
| E2 | **Deploys through git + CI** (deploys are `railway up` from the local working dir on a feature branch; CI only watches main; `ignoreBuildErrors: true` means even the Docker build won't catch type errors) | You can ship uncommitted, untested code to every tenant with one command. Merge to main, deploy from green CI. | M |
| E3 | **Media → R2/CDN** (all media served via `fs.readFileSync` through the Node process; `cms/storage.ts` is already "R2-ready"; per-site assets are 16MB committed to git/image) | Solves 3 problems at once: media backup (A2), event-loop bottleneck, redeploy-coupling. | M–L |
| E4 | Multi-instance safety: DB claims/locks for the in-process schedulers (only billing has one) — or explicitly enforce single-replica | The day someone sets replicas=2, birthdays double-send. | S–M |
| E5 | Smalls: boot-time (not request-path) schema bootstrap; conn-cache LRU eviction; WAL checkpoint tuning; Node 20→22 Dockerfile alignment; startup env validation | Each small; together they harden the data layer. | S each |

## Theme F — Speed & polish (what users feel)

| # | Item | Why | Effort |
|---|---|---|---|
| F1 | **Gmail sync N+1 off the critical path** (`gmail.ts:314` fetches up to 15 messages SERIALLY inside the brief request) | The dashboard brief can hang for seconds on Google round-trips. Parallelize + background it. | S–M |
| F2 | **Indexes on core tables** (`email_messages` has none on client_id/thread/date; appointments/payments/leads/messages all unindexed) | Inbox/communication pages get slower every week as mail accumulates. | S |
| F3 | Bundle diet: `chart.js` has ZERO imports (recharts is the real one) yet ships; tiptap/recharts not lazy-loaded; `motion` imported by Card/Sidebar = every page | Faster first loads, especially mobile. | M |
| F4 | Image resizing on upload (no sharp anywhere; full-size originals served) | Media-heavy pages + bandwidth + backup size. | M |
| F5 | Interactive styling off inline `style={{}}` (3,110 occurrences; inline styles can't express hover/focus → weak affordances + a11y gap; start with the 5 heaviest files: MembershipsView 90, ImageDesigner 82, PackagesView 80, TimetableView 78) + focus-visible coverage + aria-pressed on the model picker | Direct feel/quality improvement; unblocks keyboard users. | L (incremental) |
| F6 | Gmail read-state reconcile (unread count is app-local; reading in Gmail doesn't lower it) | Makes "69 unread" honest. Already offered. | S–M |

## Theme G — Codebase hygiene (makes every future change faster)

| # | Item | Why | Effort |
|---|---|---|---|
| G1 | **ESLint config + type-gate the real deploy path** (no eslint config exists; `next lint` has never run; `ignoreBuildErrors: true`) | Right now nothing automated catches quality regressions on what actually ships. | S |
| G2 | **Rewrite README + CLAUDE.md, rename package** (README is 100% the old OHR ad-library doc; CLAUDE.md predates the agent platform entirely; package name is still `renova-cellular-health`) | The first files any dev/agent reads actively mislead them. | S |
| G3 | **Dedupe the security-critical copies**: `fenceUntrusted` + the `<untrusted_external_content>` tag + ToolContext/ToolResult/tdb exist in 4 files → one shared toolKit module; MANDATE map duplicated client-side; AssistantChat's 3 copies of SSE/patch logic | A future injection-defense fix that misses 3 of 4 copies is a real vulnerability. | S–M |
| G4 | **Delete dead weight**: unused deps (`chart.js`, `react-hook-form`, `@hookform/resolvers`, `date-fns`, `geist`, `class-variance-authority`, 8 of 12 Radix packages), the OHR extract island (`extract/` + `npm run extract` in the default build! + `/marketing/[therapy]` orphan route), the 8MB `seed/clinic.db` binaries in git | Faster installs/builds/clones; less confusion. | S |
| G5 | Unify the two blog systems (`lib/blog/posts.ts` legacy vs `lib/cms/blog.ts` canonical — both write `blog_posts`; the marketing agent imports BOTH) | One mental model; the agent stops straddling two APIs. | M |
| G6 | Split the monoliths: `schema.ts` (1907 lines, 76 tables), `assistant/tools.ts` (1941), `image/templates.ts` (3379), `AssistantChat.tsx` (996) | Merge-conflict magnets touched by every feature. | M |
| G7 | Tests for the money paths: payments capture, timetable booking conflicts, CMS publish, Gmail sync dedup (whole subsystems have zero tests; agents/AI are well-covered) | The highest-consequence flows can currently regress silently. | L ongoing |

---

## Suggested sequence

**Week 1 — "Sleep at night" (mostly S, one M):** A1 verify backups → A4 crash guards → A3 Sentry+health → B3 client-login rate limit → B1 XSS/sanitizer/CSP → G1 ESLint+CI gate → E2 merge to main + deploy-from-green.

**Weeks 2–3 — "Truth & trust":** C1 meter everything (+C2/C3/C4) → A2 media backup → B2 media-library tenant scoping → B4/B5 security smalls → F1 Gmail speed → F2 indexes → G2 docs rewrite → G4 dead-weight deletion → D1 label automations honestly → D2 blog-schedule worker → D7 assistant-route consolidation.

**Month 2 — "Scale & sell":** E1 migrations → E3 media to R2/CDN → D4 member billing when CreatePay creds land (→ activate the Finance agent) → D5 forms public → F3/F4 bundle+images → F5 styling sweep (incremental) → G5/G6 refactors.

**Ongoing:** G7 tests on money paths; F5 continues; D3 social when it earns priority.

**Your side (not code):** confirm the Railway backup env vars (A1 pairs with this); rotate the whapi token (unblocks WhatsApp sends + live agent E2E); chase CreatePay/Cardstream creds (unblocks D4/Finance); test an OpenRouter model live; CASA verification only when approaching ~100 Gmail-connected gyms.

**Explicitly NOT broken (verified clean):** tenant isolation architecture, route guards (all 71 API routes guarded), secrets handling (env files never committed, API keys hashed, scrypt passwords), SQL injection surface (fully parameterized), the agent write-approval gate, the `var(--surface)` bug (fixed), TypeScript health (only ~18 `any`s in 617 files), login rate-limiting on coach/platform paths.
