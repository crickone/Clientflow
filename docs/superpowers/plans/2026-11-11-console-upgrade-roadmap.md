# Platform Console Upgrade: Roadmap

Four plans, one per tier. Each tier ships on its own and the next one builds
on it. Run them in order.

| Tier | Plan | What it delivers | Build time |
|---|---|---|---|
| 1 | [Feel](2026-11-11-console-tier1-feel.md) | Nothing waits: streaming pages, skeletons, error pages, toasts, real confirm dialogs, undo, a 30-second cache, keyboard shortcuts. Plus the three storage tables (`health_snapshots`, `job_runs`, `platform_alerts`) start filling so Tier 3 has history. | 3 to 4 days |
| 2 | [Find and work](2026-11-11-console-tier2-find-and-work.md) | Cmd+K search across businesses, people, domains and invoices; sortable, pageable, exportable tables; an audit log that answers questions; saved views; bulk actions; the Money tab in two columns. | 4 to 5 days |
| 3 | [Watch](2026-11-11-console-tier3-watch.md) | An alerts inbox that drives the day; email notifications and a daily digest; health history as 30-day graphs; real charts; MRR movements; a job-runs page. | 5 to 7 days |
| 4 | [Know the customer](2026-11-11-console-tier4-know-the-customer.md) | Business 360: stage, owner, tags, notes, tasks, onboarding progress, usage per module, churn risk; feature flags with percentage and allowlist rollout. | 5 to 7 days |

## Conventions every plan assumes

- Two apps, two deploys. The console is `admin/` (deploy with `cd admin && railway up --detach`). The platform API it calls is `app/` (deploy with `cd app && railway up --detach`). A task says which one it touches.
- `main` is the source of truth. Commit after every task, push, and deploy at the end of each tier (and whenever a tier's task adds an API the console needs before the console task can be tested in production).
- Before any deploy of `app/`: `npx tsc --noEmit -p .`, `npm test`, `rm -rf .next && npx next build`. Before any deploy of `admin/`: `npx tsc --noEmit -p .`, `npm test` (Tier 1 adds the runner), `npx next build`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- House rules: no emojis anywhere; `lucide-react` icons; sentence case; short factual copy; every new console surface uses the Tier 0 classes already shipped (`PageHeader`, `.card`, `.card-title`, `.chip`, `.toolbar`, `.btn btn--*`).
- The console never reads the database. Everything goes through `admin/src/lib/api.ts` to `app/src/app/api/platform/*`, guarded by `guardPlatform(req)` (service key + staff session). Every write is audited with `recordAudit`.
- Local screenshots: Tier 1 adds `admin/scripts/screens.mjs`. It needs the app on :3000, the console on :3100 and `ADMIN_SESSION=<raw token>` (see that task for how to mint one into the local dev `control.db`). Delete the row afterwards.
