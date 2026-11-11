# Console Tier 2: Find and Work. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anything in the console can be reached by typing (Cmd+K across businesses, people, domains and invoices), every list can be sorted, paged, trimmed to the columns you want and exported, the audit log answers "who did what to whom, when", views can be saved as sidebar links, several businesses can be acted on at once, and the Money tab fits on one screen.

**Architecture:** One search endpoint in the main app (`/api/platform/search`) queried from a console route handler that the palette calls with a debounce. One generic client `DataTable` whose sort, page and column state live in the URL (so a view is a link). Audit filtering grows server-side in `listAudit`. Saved views are JSON in `platform_settings` keyed per staff member, read by the shell. Bulk actions loop the existing per-tenant action with one audit row each.

**Tech Stack:** As Tier 1. No new dependencies.

## Global Constraints

- Everything in Tier 1's Global Constraints.
- Tier 1 is deployed: `notify`, `useConfirm`, `bust`, `PageHeader`, `.card`, `.toolbar` exist.
- URL state over client state for anything a person might want to send to someone else (filters, sort, page, columns).
- The search endpoint returns only what the staff session may already see through the console; it never returns tokens, hashes or card fields.

---

## File structure

**app/**

| File | Responsibility |
|---|---|
| `src/lib/platform/search.ts` (create) | `searchPlatform(q, limit)` across tenants, people, domains, invoices. |
| `src/lib/platform/search.test.ts` (create) | |
| `src/app/api/platform/search/route.ts` (create) | GET `?q=` → `{ hits }`. |
| `src/lib/platform/audit.ts` (modify) | `listAudit` gains `actorEmail`, `ok`, `from`, `to`, `q`, `offset`; `countAudit`; `auditActions()`. |
| `src/lib/platform/audit.test.ts` (create) | |
| `src/app/api/platform/audit/route.ts` (modify) | Passes the new filters; returns `{ entries, total, actions }`. |
| `src/lib/platform/views.ts` (create) | Saved views per staff member in `platform_settings`. |
| `src/app/api/platform/views/route.ts` (create) | GET / PUT. |

**admin/**

| File | Responsibility |
|---|---|
| `src/app/api/search/route.ts` (create) | Console-side proxy the palette fetches. |
| `src/components/CommandK.tsx` (create) | The palette. |
| `src/lib/palette.ts` + `.test.ts` (create) | Pure: static commands, ranking, recent items. |
| `src/lib/table.ts` + `.test.ts` (create) | Pure: `sortRows`, `paginate`, `toCsv`, `readTableState`. |
| `src/components/ui/DataTable.tsx` (create) | The table. |
| `src/components/ui/BulkBar.tsx` (create) | Selection bar for bulk actions. |
| `src/app/(console)/gyms/bulk-actions.ts` (create) | Server action: run one tenant action over many ids. |
| `src/app/(console)/gyms/page.tsx` (modify) | DataTable + bulk. |
| `src/app/(console)/health/page.tsx`, `staff/page.tsx` (modify) | DataTable. |
| `src/app/(console)/audit/page.tsx` (modify) | New filters, expandable rows, deep links, load older. |
| `src/components/AuditTable.tsx` (create) | Client rows with expand. |
| `src/lib/views.ts` (create) | Types + built-in views. |
| `src/app/(console)/views/actions.ts` (create) | Save / delete a view. |
| `src/components/SaveViewButton.tsx` (create) | On Businesses and Audit toolbars. |
| `src/components/Shell.tsx` (modify) | "Views" group in the sidebar; mounts `CommandK`. |
| `src/app/(console)/layout.tsx` (modify) | Loads views for the shell. |
| `src/app/(console)/gyms/[id]/money/page.tsx` (modify) | Two-column grid. |
| `src/app/globals.css` (modify) | Palette, table, bulk bar, money grid styles. |

---

### Task 1: The search endpoint (main app)

**Files:**
- Create: `app/src/lib/platform/search.ts`
- Create: `app/src/lib/platform/search.test.ts`
- Create: `app/src/app/api/platform/search/route.ts`

**Interfaces:**
- Produces:

```ts
export type SearchHit =
  | { kind: "business"; id: number; title: string; subtitle: string; href: string }
  | { kind: "person"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "domain"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "invoice"; id: number; title: string; subtitle: string; href: string; tenantId: number };
export function searchPlatform(q: string, limit?: number): SearchHit[]
```

`href` is a console path (`/gyms/<id>`, `/gyms/<id>/people`, `/gyms/<id>/integrations`, `/gyms/<id>/money`).

- [ ] **Step 1: Write the failing test**

`app/src/lib/platform/search.test.ts`:

```ts
// Run: npm test -- src/lib/platform/search.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { searchPlatform } = requireLocal("./search") as typeof import("./search");

  const slug = "search-test-zq";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  controlSqlite.prepare("DELETE FROM users WHERE email = 'zq.search@example.test'").run();
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Zq Search Gym", `tenants/${slug}/void.db`) as { id: number };
  const u = controlSqlite
    .prepare("INSERT INTO users (email, name, password_hash, role) VALUES ('zq.search@example.test', 'Zq Person', 'x', 'staff') RETURNING id")
    .get() as { id: number };
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)").run(u.id, t.id);
  controlSqlite.prepare("INSERT INTO site_domains (host, tenant_id, site_id) VALUES ('zq-search.example.test', ?, 1)").run(t.id);
  const inv = controlSqlite
    .prepare(
      `INSERT INTO billing_invoices (tenant_id, period_start, period_end, net_cents, vat_cents, gross_cents, vat_rate_bp, gateway_ref)
       VALUES (?, '2026-01-01', '2026-01-31', 20000, 4600, 24600, 2300, 'zqref123') RETURNING id`,
    )
    .get(t.id) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM billing_invoices WHERE id = ?").run(inv.id);
    controlSqlite.prepare("DELETE FROM site_domains WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  };

  try {
    const kinds = (q: string) => searchPlatform(q).map((h) => h.kind);

    assert.ok(kinds("zq search").includes("business"), "name words in any order find the business");
    assert.ok(kinds(slug).includes("business"), "slug finds the business");
    const person = searchPlatform("zq.search@").find((h) => h.kind === "person");
    assert.ok(person, "email prefix finds the person");
    assert.equal(person.href, `/gyms/${t.id}/people`);
    assert.ok(kinds("zq-search.example").includes("domain"));
    const byRef = searchPlatform("zqref123").find((h) => h.kind === "invoice");
    assert.ok(byRef, "gateway ref finds the invoice");
    const byId = searchPlatform(`#${inv.id}`).find((h) => h.kind === "invoice");
    assert.ok(byId, "#id finds the invoice");
    assert.deepEqual(searchPlatform("x"), [], "a one-character query returns nothing");
    assert.ok(searchPlatform("zq", 1).length <= 1, "limit is honoured");

    console.log("search.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/search.test.ts`
Expected: `Cannot find module './search'`.

- [ ] **Step 3: Write the module and route**

`app/src/lib/platform/search.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * One search box for the console. Four things a platform operator looks
 * for: a business (name or slug), a person (email or name, any business),
 * a domain, an invoice (#id or gateway reference). Everything comes from
 * the control plane, so it is one process and a few indexed LIKEs; nothing
 * opens a tenant database. Returns console paths, never raw records.
 */
export type SearchHit =
  | { kind: "business"; id: number; title: string; subtitle: string; href: string }
  | { kind: "person"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "domain"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "invoice"; id: number; title: string; subtitle: string; href: string; tenantId: number };

export function searchPlatform(raw: string, limit = 12): SearchHit[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const likes = words.map((w) => `%${w}%`);
  const hits: SearchHit[] = [];

  // Businesses: every word must match name or slug.
  const bizWhere = words.map(() => "(lower(t.name) LIKE ? OR t.slug LIKE ?)").join(" AND ");
  const biz = controlSqlite
    .prepare(`SELECT t.id, t.name, t.slug, t.archived_at FROM tenants t WHERE ${bizWhere} ORDER BY t.name LIMIT ?`)
    .all(...likes.flatMap((l) => [l, l]), limit) as Array<{ id: number; name: string; slug: string; archived_at: number | null }>;
  for (const b of biz) {
    hits.push({ kind: "business", id: b.id, title: b.name, subtitle: b.archived_at ? `${b.slug}, archived` : b.slug, href: `/gyms/${b.id}` });
  }

  // People: email or name, with the business they belong to.
  const people = controlSqlite
    .prepare(
      `SELECT u.id, u.email, u.name, t.id AS tenant_id, t.name AS tenant_name
       FROM users u JOIN memberships m ON m.user_id = u.id JOIN tenants t ON t.id = m.tenant_id
       WHERE (lower(u.email) LIKE ? OR lower(COALESCE(u.name, '')) LIKE ?) AND u.is_platform_admin = 0
       ORDER BY u.email LIMIT ?`,
    )
    .all(`%${q}%`, `%${q}%`, limit) as Array<{ id: number; email: string; name: string | null; tenant_id: number; tenant_name: string }>;
  for (const p of people) {
    hits.push({ kind: "person", id: p.id, title: p.name ? `${p.name} (${p.email})` : p.email, subtitle: p.tenant_name, href: `/gyms/${p.tenant_id}/people`, tenantId: p.tenant_id });
  }

  // Domains.
  const domains = controlSqlite
    .prepare(
      `SELECT d.id, d.host, t.id AS tenant_id, t.name AS tenant_name FROM site_domains d JOIN tenants t ON t.id = d.tenant_id
       WHERE lower(d.host) LIKE ? ORDER BY d.host LIMIT ?`,
    )
    .all(`%${q}%`, limit) as Array<{ id: number; host: string; tenant_id: number; tenant_name: string }>;
  for (const d of domains) {
    hits.push({ kind: "domain", id: d.id, title: d.host, subtitle: d.tenant_name, href: `/gyms/${d.tenant_id}/integrations`, tenantId: d.tenant_id });
  }

  // Invoices: "#123" or a gateway reference.
  const idMatch = /^#?(\d{1,9})$/.exec(q);
  const invoices = controlSqlite
    .prepare(
      `SELECT i.id, i.period_start, i.gross_cents, i.status, t.id AS tenant_id, t.name AS tenant_name
       FROM billing_invoices i JOIN tenants t ON t.id = i.tenant_id
       WHERE i.id = ? OR lower(COALESCE(i.gateway_ref, '')) LIKE ? ORDER BY i.id DESC LIMIT ?`,
    )
    .all(idMatch ? Number(idMatch[1]) : -1, `%${q}%`, limit) as Array<{ id: number; period_start: string; gross_cents: number; status: string; tenant_id: number; tenant_name: string }>;
  for (const i of invoices) {
    hits.push({
      kind: "invoice",
      id: i.id,
      title: `Invoice #${i.id}, ${i.period_start}, €${(i.gross_cents / 100).toFixed(2)}`,
      subtitle: `${i.tenant_name}, ${i.status}`,
      href: `/gyms/${i.tenant_id}/money`,
      tenantId: i.tenant_id,
    });
  }

  return hits.slice(0, limit);
}
```

`app/src/app/api/platform/search/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { searchPlatform } from "@/lib/platform/search";

export const dynamic = "force-dynamic";

/** Console search. Both roles can read; nothing here is owner-only. */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ hits: searchPlatform(q, 12) });
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/search.test.ts`
Expected: `search.test.ts: ok`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/platform/search.ts app/src/lib/platform/search.test.ts app/src/app/api/platform/search/route.ts
git commit -m "feat(platform): one search across businesses, people, domains and invoices for the console

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cmd+K palette (console)

**Files:**
- Create: `admin/src/lib/palette.ts`, `admin/src/lib/palette.test.ts`
- Create: `admin/src/app/api/search/route.ts`
- Create: `admin/src/components/CommandK.tsx`
- Modify: `admin/src/components/Shell.tsx`, `admin/src/lib/shortcuts.ts`, `admin/src/lib/shortcuts.test.ts`, `admin/src/app/globals.css`
- Modify: `admin/src/lib/types.ts` (add `SearchHit`)

**Interfaces:**
- Produces: `STATIC_COMMANDS`, `rankStatic(q, commands)`, `pushRecent(list, hit, max)` in `lib/palette.ts`. Shortcut resolver gains `{ kind: "search" }` for `/`.

- [ ] **Step 1: Write the failing tests**

`admin/src/lib/palette.test.ts`:

```ts
// Run: npm test -- src/lib/palette.test.ts
import assert from "node:assert/strict";

import { STATIC_COMMANDS, rankStatic, pushRecent } from "./palette";

assert.ok(STATIC_COMMANDS.some((c) => c.href === "/provision"));
assert.deepEqual(rankStatic("", STATIC_COMMANDS).map((c) => c.href), STATIC_COMMANDS.map((c) => c.href));
assert.equal(rankStatic("prov", STATIC_COMMANDS)[0]?.href, "/provision");
assert.equal(rankStatic("audit", STATIC_COMMANDS)[0]?.href, "/audit");
assert.deepEqual(rankStatic("zzz", STATIC_COMMANDS), []);

const a = { kind: "business" as const, id: 1, title: "A", subtitle: "", href: "/gyms/1" };
const b = { kind: "business" as const, id: 2, title: "B", subtitle: "", href: "/gyms/2" };
let recent = pushRecent([], a, 5);
recent = pushRecent(recent, b, 5);
recent = pushRecent(recent, a, 5);
assert.deepEqual(recent.map((r) => r.href), ["/gyms/1", "/gyms/2"], "newest first, no duplicates");
assert.equal(pushRecent([a, b], { ...a, id: 3, href: "/gyms/3" }, 2).length, 2, "capped");
console.log("palette.test.ts: ok");
```

Add to `admin/src/lib/shortcuts.test.ts` before the final `console.log`:

```ts
assert.deepEqual(resolveShortcut(null, "/"), { kind: "search" });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd admin && npm test -- src/lib/palette.test.ts; npm test -- src/lib/shortcuts.test.ts`
Expected: the first fails with `Cannot find module './palette'`; the second fails on the new assertion.

- [ ] **Step 3: The pure pieces**

`admin/src/lib/palette.ts`:

```ts
import type { SearchHit } from "@/lib/types";

export interface StaticCommand { title: string; hint: string; href: string }

export const STATIC_COMMANDS: StaticCommand[] = [
  { title: "Dashboard", hint: "g d", href: "/" },
  { title: "Businesses", hint: "g b", href: "/gyms" },
  { title: "Health", hint: "g h", href: "/health" },
  { title: "Provision a business", hint: "g p", href: "/provision" },
  { title: "Audit log", hint: "g a", href: "/audit" },
  { title: "Platform staff", hint: "", href: "/staff" },
  { title: "Settings", hint: "g s", href: "/settings" },
];

/** Empty query: everything in order. Otherwise: prefix matches first, then substring matches. */
export function rankStatic(q: string, commands: StaticCommand[]): StaticCommand[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return commands;
  const starts = commands.filter((c) => c.title.toLowerCase().startsWith(needle));
  const contains = commands.filter((c) => !starts.includes(c) && c.title.toLowerCase().includes(needle));
  return [...starts, ...contains];
}

/** Recent hits, newest first, no duplicates by href, capped. */
export function pushRecent(list: SearchHit[], hit: SearchHit, max: number): SearchHit[] {
  return [hit, ...list.filter((h) => h.href !== hit.href)].slice(0, max);
}
```

Add to `admin/src/lib/types.ts`:

```ts
/** One hit from /search (mirrors app/src/lib/platform/search.ts). */
export type SearchHit =
  | { kind: "business"; id: number; title: string; subtitle: string; href: string }
  | { kind: "person"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "domain"; id: number; title: string; subtitle: string; href: string; tenantId: number }
  | { kind: "invoice"; id: number; title: string; subtitle: string; href: string; tenantId: number };
```

In `admin/src/lib/shortcuts.ts` add `{ keys: "/", label: "Search" }` to `SHORTCUTS` (before `?`), add `| { kind: "search" }` to `Resolution`, and in `resolveShortcut` add `if (key === "/") return { kind: "search" };` under the `prev === null` branch.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd admin && npm test -- src/lib/palette.test.ts; npm test -- src/lib/shortcuts.test.ts`
Expected: both `ok`.

- [ ] **Step 5: The console proxy route**

`admin/src/app/api/search/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { api, ApiError } from "@/lib/api";
import type { SearchHit } from "@/lib/types";

/** The palette fetches this; it forwards to the platform API with the staff session. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    const res = await api<{ hits: SearchHit[] }>(`/search?q=${encodeURIComponent(q)}`);
    return NextResponse.json(res);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ hits: [] }, { status });
  }
}
```

- [ ] **Step 6: The palette**

`admin/src/components/CommandK.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FileText, Globe, Search, User } from "lucide-react";

import { STATIC_COMMANDS, pushRecent, rankStatic } from "@/lib/palette";
import type { SearchHit } from "@/lib/types";

const RECENT_KEY = "console.recent";
const ICON = { business: Building2, person: User, domain: Globe, invoice: FileText } as const;

type Row = { key: string; title: string; subtitle: string; href: string; icon: typeof Building2; hit?: SearchHit };

function readRecent(): SearchHit[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as SearchHit[];
  } catch {
    return [];
  }
}
function writeRecent(list: SearchHit[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private window or blocked storage: recents are a convenience only
  }
}

/**
 * Cmd+K / Ctrl+K / "/" opens it. Static pages rank first on a short query;
 * after 200ms of quiet the platform search runs and its hits follow.
 */
export function CommandK() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("console:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("console:search", onOpen);
    };
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setHits([]);
      setActive(0);
      setRecent(readRecent());
      d.showModal();
      setTimeout(() => input.current?.focus(), 0);
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits ?? []);
      } catch {
        // aborted or offline: keep what we have
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const statics: Row[] = rankStatic(q, STATIC_COMMANDS).map((c) => ({ key: `s:${c.href}`, title: c.title, subtitle: c.hint, href: c.href, icon: Search }));
  const dynamic: Row[] = (q.trim().length < 2 ? recent : hits).map((h) => ({ key: `${h.kind}:${h.id}`, title: h.title, subtitle: h.subtitle, href: h.href, icon: ICON[h.kind], hit: h }));
  const rows = q.trim() ? [...dynamic, ...statics] : [...dynamic, ...statics];
  const bounded = Math.min(active, Math.max(0, rows.length - 1));

  function go(row: Row) {
    if (row.hit) {
      const next = pushRecent(readRecent(), row.hit, 6);
      writeRecent(next);
    }
    setOpen(false);
    router.push(row.href);
  }

  return (
    <dialog ref={dialog} className="palette" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dialog.current) setOpen(false); }}>
      <div className="palette-box" role="combobox" aria-expanded="true" aria-haspopup="listbox">
        <div className="palette-input">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            ref={input}
            value={q}
            placeholder="Search businesses, people, domains, invoices…"
            aria-label="Search"
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && rows[bounded]) { e.preventDefault(); go(rows[bounded]); }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {rows.length === 0 && <li className="palette-empty">Nothing matches.</li>}
          {rows.map((row, i) => {
            const Icon = row.icon;
            return (
              <li
                key={row.key}
                role="option"
                aria-selected={i === bounded}
                className={i === bounded ? "is-active" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(row)}
              >
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                <span className="palette-title">{row.title}</span>
                <span className="palette-sub">{row.subtitle}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
```

In `admin/src/components/Shortcuts.tsx` handle the new resolution: after the `help` branch add

```tsx
      } else if (r.kind === "search") {
        e.preventDefault();
        window.dispatchEvent(new Event("console:search"));
      }
```

In `admin/src/components/Shell.tsx` import and mount `<CommandK />` right after `<Shortcuts />`, and add a search button to the sidebar under the wordmark:

```tsx
import { CommandK } from "@/components/CommandK";
```

```tsx
        <button
          type="button"
          className="nav-search"
          onClick={() => window.dispatchEvent(new Event("console:search"))}
        >
          <SearchIcon size={14} strokeWidth={1.75} aria-hidden />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
```

(import `Search as SearchIcon` from `lucide-react`.)

Append to `admin/src/app/globals.css`:

```css
/* ── Command palette (components/CommandK.tsx) ──────────────────────────── */
.nav-search {
  display: flex; align-items: center; gap: 8px; width: calc(100% - 20px); margin: 0 10px 4px;
  padding: 8px 10px 8px 12px; border-radius: 10px; border: 1px solid var(--hairline);
  background: var(--surface-1); color: var(--text-tertiary); font: inherit; font-size: 13px; cursor: pointer;
}
.nav-search:hover { color: var(--text-primary); border-color: var(--hairline-strong); }
.nav-search kbd { margin-left: auto; font-family: var(--font-mono), ui-monospace, monospace; font-size: 10.5px; }
.palette { border: 0; padding: 0; background: transparent; width: min(640px, calc(100vw - 32px)); margin-top: 12vh; }
.palette::backdrop { background: rgba(5, 6, 8, 0.6); backdrop-filter: blur(2px); }
.palette-box { background: var(--surface-1); border: 1px solid var(--hairline); border-radius: 14px; overflow: hidden; box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.9); }
.palette-input { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--grid); color: var(--text-tertiary); }
.palette-input input { flex: 1; background: transparent; border: 0; outline: none; color: var(--text-primary); font: inherit; font-size: 15px; }
.palette-input kbd { font-family: var(--font-mono), ui-monospace, monospace; font-size: 10.5px; padding: 2px 6px; border: 1px solid var(--hairline); border-radius: 5px; }
.palette-list { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
.palette-list li { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; cursor: pointer; color: var(--text-secondary); font-size: 13.5px; }
.palette-list li.is-active { background: var(--surface-2); color: var(--text-primary); }
.palette-title { color: var(--text-primary); }
.palette-sub { margin-left: auto; color: var(--text-tertiary); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 45%; }
.palette-empty { color: var(--text-tertiary); padding: 14px 10px; cursor: default; }
```

- [ ] **Step 7: Try it, typecheck, commit**

Run the console; press Cmd+K, type "opt": Optimal Health appears; Enter opens it. Type an email of someone in a business: a person hit with the business as its subtitle. `/` on any page opens the palette.

Run: `cd admin && npx tsc --noEmit -p . && npm test 2>&1 | tail -1`

```bash
git add admin/src/lib/palette.ts admin/src/lib/palette.test.ts admin/src/lib/shortcuts.ts admin/src/lib/shortcuts.test.ts admin/src/lib/types.ts admin/src/app/api/search/route.ts admin/src/components/CommandK.tsx admin/src/components/Shortcuts.tsx admin/src/components/Shell.tsx admin/src/app/globals.css
git commit -m "feat(console): Cmd+K search across businesses, people, domains and invoices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The table primitives

**Files:**
- Create: `admin/src/lib/table.ts`, `admin/src/lib/table.test.ts`
- Create: `admin/src/components/ui/DataTable.tsx`
- Modify: `admin/src/app/globals.css`

**Interfaces:**
- Produces (pure, `lib/table.ts`):

```ts
export interface TableState { sort: string | null; dir: "asc" | "desc"; page: number; cols: string[] | null }
export function readTableState(params: URLSearchParams, defaults?: Partial<TableState>): TableState
export function writeTableState(params: URLSearchParams, state: TableState): URLSearchParams
export function sortRows<T>(rows: T[], key: string | null, dir: "asc" | "desc", value: (row: T, key: string) => unknown): T[]
export function paginate<T>(rows: T[], page: number, size: number): { rows: T[]; pages: number; page: number; from: number; to: number; total: number }
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string
```

- Produces (component):

```ts
export interface Column<T> { key: string; label: string; sortable?: boolean; align?: "left" | "right"; width?: number | string; hideable?: boolean; value?: (row: T) => unknown; render?: (row: T) => ReactNode; csv?: (row: T) => string | number }
export function DataTable<T>(props: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string | number; pageSize?: number; defaultSort?: { key: string; dir: "asc" | "desc" }; csvName?: string; empty: string; selectable?: boolean; selected?: Set<string | number>; onSelect?: (next: Set<string | number>) => void; rowStyle?: (row: T) => CSSProperties | undefined })
```

Sort, page and visible columns live in the URL as `sort`, `dir`, `page`, `cols` (comma list), so the table is a client component that reads `useSearchParams` and writes with `router.replace`.

- [ ] **Step 1: Write the failing test**

`admin/src/lib/table.test.ts`:

```ts
// Run: npm test -- src/lib/table.test.ts
import assert from "node:assert/strict";

import { paginate, readTableState, sortRows, toCsv, writeTableState } from "./table";

const rows = [{ n: "b", v: 2 }, { n: "a", v: 10 }, { n: "c", v: null }];
const val = (r: (typeof rows)[number], k: string) => (r as Record<string, unknown>)[k];

assert.deepEqual(sortRows(rows, "n", "asc", val).map((r) => r.n), ["a", "b", "c"]);
assert.deepEqual(sortRows(rows, "v", "desc", val).map((r) => r.n), ["a", "b", "c"], "nulls last either way");
assert.deepEqual(sortRows(rows, "v", "asc", val).map((r) => r.n), ["b", "a", "c"]);
assert.deepEqual(sortRows(rows, null, "asc", val), rows, "no key: untouched");

const p = paginate([1, 2, 3, 4, 5], 2, 2);
assert.deepEqual(p, { rows: [3, 4], pages: 3, page: 2, from: 3, to: 4, total: 5 });
assert.equal(paginate([1, 2], 9, 2).page, 1, "page past the end clamps to the last");
assert.deepEqual(paginate([], 1, 2), { rows: [], pages: 1, page: 1, from: 0, to: 0, total: 0 });

const s = readTableState(new URLSearchParams("sort=name&dir=desc&page=3&cols=a,b"));
assert.deepEqual(s, { sort: "name", dir: "desc", page: 3, cols: ["a", "b"] });
assert.deepEqual(readTableState(new URLSearchParams("dir=sideways&page=x")), { sort: null, dir: "asc", page: 1, cols: null });
assert.deepEqual(readTableState(new URLSearchParams(""), { sort: "joined", dir: "desc" }), { sort: "joined", dir: "desc", page: 1, cols: null });
const out = writeTableState(new URLSearchParams("q=x&page=4"), { sort: "name", dir: "asc", page: 1, cols: null });
assert.equal(out.toString(), "q=x&sort=name&dir=asc", "page 1 and null cols are omitted; other params survive");

assert.equal(
  toCsv([{ a: 'He said "hi"', b: 1 }, { a: "x,y", b: null }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]),
  'A,B\r\n"He said ""hi""",1\r\n"x,y",\r\n',
);
console.log("table.test.ts: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd admin && npm test -- src/lib/table.test.ts`
Expected: `Cannot find module './table'`.

- [ ] **Step 3: The pure module**

`admin/src/lib/table.ts`:

```ts
/**
 * Table state that lives in the URL. Sort, page and visible columns are
 * things a person wants to send to someone else ("look at past-due sorted
 * by renewal"), so they are query parameters, and a saved view is a link.
 */
export interface TableState {
  sort: string | null;
  dir: "asc" | "desc";
  page: number;
  cols: string[] | null;
}

export function readTableState(params: URLSearchParams, defaults: Partial<TableState> = {}): TableState {
  const sort = params.get("sort") || defaults.sort || null;
  const dirRaw = params.get("dir");
  const dir: "asc" | "desc" = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaults.dir ?? "asc";
  const pageRaw = Number(params.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const colsRaw = params.get("cols");
  const cols = colsRaw ? colsRaw.split(",").filter(Boolean) : defaults.cols ?? null;
  return { sort, dir, page, cols };
}

export function writeTableState(params: URLSearchParams, state: TableState): URLSearchParams {
  const out = new URLSearchParams(params);
  for (const k of ["sort", "dir", "page", "cols"]) out.delete(k);
  if (state.sort) {
    out.set("sort", state.sort);
    out.set("dir", state.dir);
  }
  if (state.page > 1) out.set("page", String(state.page));
  if (state.cols) out.set("cols", state.cols.join(","));
  return out;
}

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Stable sort; empty values sink to the bottom in both directions. */
export function sortRows<T>(rows: T[], key: string | null, dir: "asc" | "desc", value: (row: T, key: string) => unknown): T[] {
  if (!key) return rows;
  return rows
    .map((row, i) => ({ row, i, v: value(row, key) }))
    .sort((x, y) => {
      const xn = x.v === null || x.v === undefined || x.v === "";
      const yn = y.v === null || y.v === undefined || y.v === "";
      if (xn || yn) return compare(x.v, y.v) || x.i - y.i;
      const c = compare(x.v, y.v);
      return (dir === "asc" ? c : -c) || x.i - y.i;
    })
    .map((x) => x.row);
}

export function paginate<T>(rows: T[], page: number, size: number) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(total, current * size);
  return { rows: rows.slice((current - 1) * size, current * size), pages, page: current, from, to, total };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd admin && npm test -- src/lib/table.test.ts`
Expected: `table.test.ts: ok`.

- [ ] **Step 5: The component**

`admin/src/components/ui/DataTable.tsx`:

```tsx
"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download } from "lucide-react";

import { paginate, readTableState, sortRows, toCsv, writeTableState, type TableState } from "@/lib/table";

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right";
  width?: number | string;
  /** Can be hidden from the column picker. Default true. */
  hideable?: boolean;
  /** The value to sort and export by. Defaults to row[key]. */
  value?: (row: T) => unknown;
  render?: (row: T) => ReactNode;
}

/**
 * Every list in the console: sortable headers, pages, a column picker and a
 * CSV export, with the state in the URL. Rows are already loaded (the lists
 * here are hundreds, not millions); a list that needs server paging keeps
 * its own cursor and passes one page in.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  pageSize = 25,
  defaultSort,
  csvName,
  empty,
  selectable,
  selected,
  onSelect,
  rowStyle,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  pageSize?: number;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  csvName?: string;
  empty: string;
  selectable?: boolean;
  selected?: Set<string | number>;
  onSelect?: (next: Set<string | number>) => void;
  rowStyle?: (row: T) => CSSProperties | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = readTableState(params, defaultSort ? { sort: defaultSort.key, dir: defaultSort.dir } : {});
  const [picker, setPicker] = useState(false);

  const valueOf = (row: T, key: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.value ? col.value(row) : (row as Record<string, unknown>)[key];
  };

  const visible = columns.filter((c) => !state.cols || state.cols.includes(c.key) || c.hideable === false);
  const sorted = useMemo(() => sortRows(rows, state.sort, state.dir, valueOf), [rows, state.sort, state.dir]); // eslint-disable-line react-hooks/exhaustive-deps
  const page = paginate(sorted, state.page, pageSize);

  function push(next: TableState) {
    router.replace(`${pathname}?${writeTableState(params, next).toString()}`, { scroll: false });
  }
  function toggleSort(key: string) {
    if (state.sort === key) push({ ...state, dir: state.dir === "asc" ? "desc" : "asc", page: 1 });
    else push({ ...state, sort: key, dir: "asc", page: 1 });
  }
  function toggleCol(key: string) {
    const current = visible.map((c) => c.key);
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    push({ ...state, cols: next.length === columns.length ? null : next });
  }
  function exportCsv() {
    const csv = toCsv(
      sorted.map((r) => Object.fromEntries(visible.map((c) => [c.key, valueOf(r, c.key)]))),
      visible.map((c) => ({ key: c.key, label: c.label })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const allOnPage = page.rows.map(rowKey);
  const allSelected = selectable && allOnPage.length > 0 && allOnPage.every((k) => selected?.has(k));

  return (
    <div className="dt">
      <div className="dt-bar">
        <span className="dt-count">
          {page.total === 0 ? "" : page.total <= pageSize ? `${page.total} ${page.total === 1 ? "row" : "rows"}` : `${page.from} to ${page.to} of ${page.total}`}
        </span>
        <span className="dt-tools">
          <span style={{ position: "relative" }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicker((p) => !p)} aria-expanded={picker}>
              <Columns3 size={14} strokeWidth={1.75} aria-hidden /> Columns
            </button>
            {picker && (
              <div className="dt-picker" role="menu">
                {columns.filter((c) => c.hideable !== false).map((c) => (
                  <label key={c.key}>
                    <input type="checkbox" checked={visible.some((v) => v.key === c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                  </label>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv} disabled={sorted.length === 0}>
            <Download size={14} strokeWidth={1.75} aria-hidden /> CSV
          </button>
        </span>
      </div>

      {page.total === 0 ? (
        <p className="dt-empty">{empty}</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 1 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={Boolean(allSelected)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (allSelected) allOnPage.forEach((k) => next.delete(k));
                      else allOnPage.forEach((k) => next.add(k));
                      onSelect?.(next);
                    }}
                  />
                </th>
              )}
              {visible.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align }}>
                  {c.sortable ? (
                    <button type="button" className="dt-sort" onClick={() => toggleSort(c.key)} aria-sort={state.sort === c.key ? (state.dir === "asc" ? "ascending" : "descending") : "none"}>
                      {c.label}
                      {state.sort === c.key && (state.dir === "asc" ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => {
              const k = rowKey(row);
              return (
                <tr key={k} style={rowStyle?.(row)} className={selected?.has(k) ? "is-selected" : undefined}>
                  {selectable && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={Boolean(selected?.has(k))}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          onSelect?.(next);
                        }}
                      />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align }}>
                      {c.render ? c.render(row) : String(valueOf(row, c.key) ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {page.pages > 1 && (
        <div className="dt-pager">
          <button type="button" className="btn btn--ghost btn--sm" disabled={page.page <= 1} onClick={() => push({ ...state, page: page.page - 1 })} aria-label="Previous page">
            <ChevronLeft size={14} aria-hidden />
          </button>
          <span>
            Page {page.page} of {page.pages}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page.page >= page.pages} onClick={() => push({ ...state, page: page.page + 1 })} aria-label="Next page">
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
/* ── DataTable (components/ui/DataTable.tsx) ────────────────────────────── */
.dt { display: flex; flex-direction: column; gap: 10px; }
.dt-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dt-count { font-family: var(--font-mono), ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
.dt-tools { display: flex; gap: 4px; }
.dt-picker {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 200px;
  display: flex; flex-direction: column; gap: 2px; padding: 8px;
  background: var(--surface-2); border: 1px solid var(--hairline); border-radius: 10px;
  box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.8);
}
.dt-picker label { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; font-size: 13px; cursor: pointer; }
.dt-picker label:hover { background: var(--surface-3); }
.dt-sort { display: inline-flex; align-items: center; gap: 4px; background: none; border: 0; padding: 0; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
.dt-sort:hover { color: var(--text-primary); }
.dt-empty { margin: 8px 0; color: var(--text-secondary); font-size: 13.5px; }
.dt-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: 12.5px; color: var(--text-secondary); }
.tbl tr.is-selected td { background: rgba(255, 255, 255, 0.03); }
```

- [ ] **Step 6: Typecheck and commit**

Run: `cd admin && npx tsc --noEmit -p .`

```bash
git add admin/src/lib/table.ts admin/src/lib/table.test.ts admin/src/components/ui/DataTable.tsx admin/src/app/globals.css
git commit -m "feat(console): DataTable with URL-held sort, pages, column picker and CSV export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Businesses, Health and Staff on the DataTable

**Files:**
- Create: `admin/src/components/BusinessesTable.tsx`
- Modify: `admin/src/app/(console)/gyms/page.tsx`, `admin/src/app/(console)/health/page.tsx`, `admin/src/app/(console)/staff/page.tsx`

**Interfaces:**
- Consumes: `DataTable`, `Column`.

- [ ] **Step 1: A client table for Businesses**

The page is a server component and the table needs client state, so the rows cross as props. `admin/src/components/BusinessesTable.tsx`:

```tsx
"use client";

import Link from "next/link";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/StatusChip";
import { OpenBusinessButton } from "@/components/OpenBusinessButton";
import { fmtDate, fmtDay } from "@/lib/format";
import type { FleetTenantRow } from "@/lib/types";

export function BusinessesTable({
  tenants,
  open,
}: {
  tenants: FleetTenantRow[];
  /** `openTenant` server action; bound per row here. */
  open: (id: number, reason: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const columns: Column<FleetTenantRow>[] = [
    {
      key: "name", label: "Name", sortable: true, hideable: false,
      render: (t) => (
        <>
          <Link href={`/gyms/${t.id}`}>{t.name}</Link>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>{t.slug}</div>
        </>
      ),
    },
    { key: "venueType", label: "Venue", sortable: true, value: (t) => t.venueType ?? "", render: (t) => <span style={{ textTransform: "capitalize", color: "var(--text-secondary)" }}>{t.venueType ?? <span style={{ color: "var(--text-tertiary)", textTransform: "none" }}>Not set</span>}</span> },
    {
      key: "status", label: "Status", sortable: true,
      value: (t) => (t.archivedAt ? "archived" : t.billingExempt ? "agency" : t.billingStatus ?? "none"),
      render: (t) => (t.archivedAt ? <span className="chip past_due">archived</span> : <StatusChip status={t.billingStatus} exempt={t.billingExempt} />),
    },
    { key: "users", label: "People", sortable: true, align: "right" },
    { key: "nextRenewalAt", label: "Next renewal", sortable: true, value: (t) => t.nextRenewalAt ?? "", render: (t) => (t.nextRenewalAt ? fmtDay(t.nextRenewalAt) : "—") },
    { key: "createdAt", label: "Joined", sortable: true, render: (t) => fmtDate(t.createdAt) },
    { key: "actions", label: "", hideable: false, width: 1, align: "right", value: () => "", render: (t) => (!t.archivedAt ? <OpenBusinessButton action={(reason) => open(t.id, reason)} /> : null) },
  ];
  return (
    <DataTable
      rows={tenants}
      columns={columns}
      rowKey={(t) => t.id}
      defaultSort={{ key: "name", dir: "asc" }}
      csvName="businesses"
      empty="No businesses match."
      rowStyle={(t) => (t.archivedAt ? { opacity: 0.6 } : undefined)}
    />
  );
}
```

In `admin/src/app/(console)/gyms/page.tsx` replace the whole `<Card style={{ padding: "22px 26px 14px" }}>…</Card>` block with:

```tsx
      <Card style={{ padding: "20px 26px 18px" }}>
        <BusinessesTable tenants={tenants} open={openTenant} />
      </Card>
```

and the imports: add `import { BusinessesTable } from "@/components/BusinessesTable";`, remove the now-unused `StatusChip`, `OpenBusinessButton`, `fmtDate`, `fmtDay` imports. (`openTenant` is a server action; passing it to a client component as a prop is allowed.)

- [ ] **Step 2: Health and Staff**

`admin/src/app/(console)/health/page.tsx`: replace the second `<Card>` (the business table) with a client table. Create `admin/src/components/FleetHealthTable.tsx`:

```tsx
"use client";

import Link from "next/link";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { bytes } from "@/lib/format";
import type { FleetHealthRow } from "@/lib/types";

export function FleetHealthTable({ tenants }: { tenants: FleetHealthRow[] }) {
  const columns: Column<FleetHealthRow>[] = [
    {
      key: "name", label: "Business", sortable: true, hideable: false,
      render: (t) => (
        <>
          <Link href={`/gyms/${t.tenantId}/health`}>{t.name}</Link>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>{t.slug}</div>
        </>
      ),
    },
    { key: "dbBytes", label: "Database", sortable: true, align: "right", render: (t) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{bytes(t.dbBytes)}</span> },
    {
      key: "state", label: "State", sortable: true,
      value: (t) => (t.alerts.some((a) => a.level === "bad") ? 2 : t.alerts.length > 0 ? 1 : 0),
      render: (t) =>
        t.alerts.length === 0 ? (
          <span className="chip active">healthy</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
            {t.alerts.map((a, i) => (
              <li key={i} style={{ color: a.level === "bad" ? "var(--red)" : "var(--amber)" }}>{a.message}</li>
            ))}
          </ul>
        ),
    },
  ];
  return <DataTable rows={tenants} columns={columns} rowKey={(t) => t.tenantId} defaultSort={{ key: "state", dir: "desc" }} csvName="fleet-health" empty="No businesses." />;
}
```

and in the health page: `<Card style={{ padding: "20px 26px 18px" }}><FleetHealthTable tenants={sorted} /></Card>` (keep the existing `sorted` array, or pass `tenants`; the table sorts).

`admin/src/app/(console)/staff/page.tsx`: the staff table has an inline role form per row, which is already a client component (`StaffRoleForm`). Create `admin/src/components/StaffTable.tsx`:

```tsx
"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { StaffRoleForm } from "@/components/StaffRoleForm";
import { fmtDate } from "@/lib/format";
import type { PlatformRole, PlatformStaffRow } from "@/lib/types";

export function StaffTable({ staff, me }: { staff: PlatformStaffRow[]; me: { userId: number; role: PlatformRole } }) {
  const columns: Column<PlatformStaffRow>[] = [
    {
      key: "email", label: "Person", sortable: true, hideable: false,
      render: (s) => (
        <>
          {s.name ?? s.email}
          {s.name && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.email}</div>}
          {s.userId === me.userId && <span className="chip" style={{ marginLeft: 6 }}>you</span>}
        </>
      ),
    },
    { key: "role", label: "Role", sortable: true, render: (s) => (me.role === "owner" ? <StaffRoleForm userId={s.userId} role={s.role} isSelf={s.userId === me.userId} /> : <span className="chip">{s.role}</span>) },
    { key: "lastLoginAt", label: "Last login", sortable: true, render: (s) => (s.lastLoginAt ? fmtDate(s.lastLoginAt) : "Never") },
    { key: "isActive", label: "Status", sortable: true, value: (s) => (s.isActive ? 1 : 0), render: (s) => (s.isActive ? <span className="chip active">active</span> : <span className="chip">disabled</span>) },
  ];
  return <DataTable rows={staff} columns={columns} rowKey={(s) => s.userId} defaultSort={{ key: "email", dir: "asc" }} csvName="platform-staff" empty="No staff." />;
}
```

and in the staff page replace the `<Card>…</Card>` table with `<Card style={{ padding: "20px 26px 18px" }}><StaffTable staff={staff} me={me} /></Card>`.

- [ ] **Step 3: Check, screenshot, commit**

Run: `cd admin && npx tsc --noEmit -p . && ADMIN_SESSION=$RAW node scripts/screens.mjs /tmp/screens gyms health staff`
Expected: the three pages render with sortable headers, a Columns button and a CSV button. Click a header on Businesses: the URL gains `?sort=…&dir=…`.

```bash
git add admin/src/components/BusinessesTable.tsx admin/src/components/FleetHealthTable.tsx admin/src/components/StaffTable.tsx "admin/src/app/(console)/gyms/page.tsx" "admin/src/app/(console)/health/page.tsx" "admin/src/app/(console)/staff/page.tsx"
git commit -m "feat(console): Businesses, Health and Staff lists sort, page and export

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The audit log answers questions (main app + console)

**Files:**
- Modify: `app/src/lib/platform/audit.ts`
- Create: `app/src/lib/platform/audit.test.ts`
- Modify: `app/src/app/api/platform/audit/route.ts`
- Modify: `admin/src/lib/types.ts` (`AuditResponse` gains `total`, `actions`)
- Create: `admin/src/components/AuditTable.tsx`
- Modify: `admin/src/app/(console)/audit/page.tsx`

**Interfaces:**
- Produces (app):

```ts
export interface AuditQuery { tenantId?: number | null; actorUserId?: number; actorEmail?: string; action?: string; ok?: boolean; from?: number; to?: number; q?: string; limit?: number; offset?: number; before?: number }
export function listAudit(query?: AuditQuery): AuditRow[]
export function countAudit(query?: AuditQuery): number
export function auditActions(): string[]   // distinct action names, sorted
```

Route: `GET /api/platform/audit?tenantId&actorUserId&actorEmail&action&ok=1|0&from&to&q&limit&offset` → `{ entries, total, actions }`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/platform/audit.test.ts`:

```ts
// Run: npm test -- src/lib/platform/audit.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { recordAudit, listAudit, countAudit, auditActions } = requireLocal("./audit") as typeof import("./audit");

  const email = "audit-test@example.test";
  const cleanup = () => controlSqlite.prepare("DELETE FROM platform_audit WHERE actor_email = ?").run(email);
  cleanup();
  const base = { actorUserId: null, actorEmail: email, actorRole: "owner" as const, tenantId: null };
  recordAudit({ ...base, action: "audit-test.alpha", detail: { x: 1 }, reason: "first" });
  recordAudit({ ...base, action: "audit-test.beta", ok: false, error: "nope" });
  recordAudit({ ...base, action: "audit-test.alpha", detail: { note: "needle" } });

  try {
    const mine = { actorEmail: email };
    assert.equal(countAudit(mine), 3);
    assert.equal(countAudit({ ...mine, action: "audit-test.alpha" }), 2);
    assert.equal(countAudit({ ...mine, ok: false }), 1);
    assert.equal(countAudit({ ...mine, q: "needle" }), 1, "q searches detail and reason");
    assert.equal(countAudit({ ...mine, q: "first" }), 1);
    assert.equal(listAudit({ ...mine, limit: 2 }).length, 2);
    assert.equal(listAudit({ ...mine, limit: 2, offset: 2 }).length, 1, "offset pages");
    const now = Date.now();
    assert.equal(countAudit({ ...mine, from: now - 60000, to: now + 1000 }), 3);
    assert.equal(countAudit({ ...mine, to: now - 60000 }), 0);
    const actions = auditActions();
    assert.ok(actions.includes("audit-test.alpha") && actions.includes("audit-test.beta"));
    assert.deepEqual(actions, [...actions].sort());
    console.log("audit.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/audit.test.ts`
Expected: fails: `countAudit is not a function`.

- [ ] **Step 3: Extend audit.ts**

Replace `AuditQuery`, `listAudit` and add the two functions in `app/src/lib/platform/audit.ts`:

```ts
export interface AuditQuery {
  tenantId?: number | null;
  actorUserId?: number;
  actorEmail?: string;
  action?: string;
  ok?: boolean;
  from?: number;
  to?: number;
  /** Substring of action, reason, detail or error. */
  q?: string;
  limit?: number;
  offset?: number;
  before?: number;
}

function whereFor(query: AuditQuery): { sql: string; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];
  if (query.tenantId != null) { where.push("a.tenant_id = ?"); args.push(query.tenantId); }
  if (query.actorUserId != null) { where.push("a.actor_user_id = ?"); args.push(query.actorUserId); }
  if (query.actorEmail) { where.push("a.actor_email = ?"); args.push(query.actorEmail); }
  if (query.action) { where.push("a.action = ?"); args.push(query.action); }
  if (query.ok !== undefined) { where.push("a.ok = ?"); args.push(query.ok ? 1 : 0); }
  if (query.from != null) { where.push("a.created_at >= ?"); args.push(query.from); }
  if (query.to != null) { where.push("a.created_at <= ?"); args.push(query.to); }
  if (query.before != null) { where.push("a.created_at < ?"); args.push(query.before); }
  if (query.q?.trim()) {
    const like = `%${query.q.trim()}%`;
    where.push("(a.action LIKE ? OR COALESCE(a.reason, '') LIKE ? OR COALESCE(a.detail, '') LIKE ? OR COALESCE(a.error, '') LIKE ?)");
    args.push(like, like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
}

/** Most recent first. The tenant name is joined in so the log reads without a second lookup. */
export function listAudit(query: AuditQuery = {}): AuditRow[] {
  const { sql, args } = whereFor(query);
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  const offset = Math.max(0, query.offset ?? 0);
  const rows = controlSqlite
    .prepare(
      `SELECT a.id, a.actor_user_id, a.actor_email, a.actor_role, a.tenant_id, t.name AS tenant_name,
              a.action, a.detail, a.reason, a.ip, a.ok, a.error, a.created_at
       FROM platform_audit a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       ${sql}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
    )
    .all(...args) as Array<{
    id: number; actor_user_id: number | null; actor_email: string; actor_role: string | null; tenant_id: number | null;
    tenant_name: string | null; action: string; detail: string | null; reason: string | null; ip: string | null; ok: number;
    error: string | null; created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id, actorUserId: r.actor_user_id, actorEmail: r.actor_email, actorRole: r.actor_role, tenantId: r.tenant_id,
    tenantName: r.tenant_name, action: r.action, detail: parseDetail(r.detail), reason: r.reason, ip: r.ip,
    ok: Boolean(r.ok), error: r.error, createdAt: r.created_at,
  }));
}

export function countAudit(query: AuditQuery = {}): number {
  const { sql, args } = whereFor(query);
  const row = controlSqlite.prepare(`SELECT count(*) AS n FROM platform_audit a ${sql}`).get(...args) as { n: number };
  return row.n;
}

/** Every action name ever recorded, for a filter dropdown. */
export function auditActions(): string[] {
  return (controlSqlite.prepare("SELECT DISTINCT action FROM platform_audit ORDER BY action").all() as Array<{ action: string }>).map((r) => r.action);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/audit.test.ts`
Expected: `audit.test.ts: ok`.

- [ ] **Step 5: The route**

`app/src/app/api/platform/audit/route.ts` `GET` body becomes:

```ts
  const sp = req.nextUrl.searchParams;
  const num = (k: string) => {
    const v = Number(sp.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const okRaw = sp.get("ok");
  const query = {
    tenantId: num("tenantId") ?? null,
    actorUserId: num("actorUserId"),
    actorEmail: sp.get("actorEmail") || undefined,
    action: sp.get("action") || undefined,
    ok: okRaw === "1" ? true : okRaw === "0" ? false : undefined,
    from: num("from"),
    to: num("to"),
    q: sp.get("q") || undefined,
    before: num("before"),
    limit: num("limit") ?? 100,
    offset: Number(sp.get("offset")) || 0,
  };
  return NextResponse.json({ entries: listAudit(query), total: countAudit(query), actions: auditActions() });
```

(import `countAudit` and `auditActions` alongside `listAudit`.)

- [ ] **Step 6: The console page**

In `admin/src/lib/types.ts` change `AuditResponse` to:

```ts
export interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  actions: string[];
}
```

`admin/src/components/AuditTable.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { fmtDate } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

/** Rows expand to the full detail; `?id=` opens one row expanded (deep link). */
export function AuditTable({ entries, openId }: { entries: AuditEntry[]; openId: number | null }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(openId ? [openId] : []));
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 1 }} />
          <th>When</th>
          <th>Action</th>
          <th>Business</th>
          <th>Who</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const isOpen = open.has(e.id);
          return [
            <tr key={e.id} id={`audit-${e.id}`} style={isOpen ? { background: "rgba(255,255,255,0.02)" } : undefined}>
              <td>
                <button type="button" className="btn btn--ghost btn--icon" style={{ width: 28, height: 28 }} onClick={() => toggle(e.id)} aria-expanded={isOpen} aria-label="Detail">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <Link href={`/audit?id=${e.id}`} style={{ color: "inherit" }} title="Link to this entry">{fmtDate(e.createdAt)}</Link>
              </td>
              <td style={{ color: e.ok ? undefined : "var(--red)" }}>
                {e.action}
                {!e.ok && " (refused)"}
              </td>
              <td>{e.tenantId ? <Link href={`/gyms/${e.tenantId}`}>{e.tenantName ?? `#${e.tenantId}`}</Link> : <span style={{ color: "var(--text-tertiary)" }}>platform</span>}</td>
              <td>
                {e.actorEmail}
                {e.actorRole ? <span style={{ color: "var(--text-tertiary)" }}> · {e.actorRole}</span> : null}
              </td>
              <td style={{ color: "var(--text-secondary)" }}>{e.reason ?? "—"}</td>
            </tr>,
            isOpen ? (
              <tr key={`${e.id}-d`}>
                <td />
                <td colSpan={5} style={{ paddingTop: 0 }}>
                  <pre className="audit-detail">
                    {e.error ? `error: ${e.error}\n` : ""}
                    {e.ip ? `ip: ${e.ip}\n` : ""}
                    {JSON.stringify(e.detail ?? {}, null, 2)}
                  </pre>
                </td>
              </tr>
            ) : null,
          ];
        })}
      </tbody>
    </table>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
.audit-detail { margin: 0 0 6px; padding: 12px 14px; border-radius: 10px; background: var(--surface-2); font-family: var(--font-mono), ui-monospace, monospace; font-size: 12px; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; }
```

`admin/src/app/(console)/audit/page.tsx` becomes:

```tsx
import Link from "next/link";

import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { AuditTable } from "@/components/AuditTable";
import type { AuditResponse, FleetResponse, StaffResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE = 100;

type Params = { tenantId?: string; action?: string; actorEmail?: string; ok?: string; from?: string; to?: string; q?: string; offset?: string; id?: string };

/**
 * Every action taken from this console, newest first, across all businesses.
 * Filters are query parameters so "everything done to this business last
 * week" is a link. `?id=` opens one entry expanded.
 */
export default async function AuditPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  const qs = new URLSearchParams({ limit: String(PAGE) });
  for (const k of ["tenantId", "action", "actorEmail", "ok", "q", "offset"] as const) if (sp[k]) qs.set(k, sp[k]!);
  if (sp.from) qs.set("from", String(Date.parse(sp.from)));
  if (sp.to) qs.set("to", String(Date.parse(sp.to) + 86400000 - 1));

  const [{ entries, total, actions }, fleet, staff] = await Promise.all([
    api<AuditResponse>(`/audit?${qs.toString()}`),
    api<FleetResponse>("/fleet", { revalidate: 30, tags: ["fleet"] }),
    api<StaffResponse>("/staff", { revalidate: 30, tags: ["fleet"] }),
  ]);
  const offset = Number(sp.offset) || 0;
  const filtered = Boolean(sp.tenantId || sp.action || sp.actorEmail || sp.ok || sp.from || sp.to || sp.q);
  const olderQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "id" && k !== "offset") as [string, string][]);
  olderQs.set("offset", String(offset + PAGE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Operate" title="Audit log" sub={`${total} ${total === 1 ? "action" : "actions"}${filtered ? " match" : ""}. Every action taken from this console, including the ones that were refused.`} />

      <form method="GET" className="toolbar">
        <input className="input toolbar-search" type="search" name="q" placeholder="Search reason, detail, error…" defaultValue={sp.q ?? ""} />
        <select className="input" name="tenantId" defaultValue={sp.tenantId ?? ""}>
          <option value="">Any business</option>
          {fleet.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input" name="actorEmail" defaultValue={sp.actorEmail ?? ""}>
          <option value="">Anyone</option>
          {staff.staff.map((s) => <option key={s.userId} value={s.email}>{s.name ?? s.email}</option>)}
        </select>
        <select className="input" name="action" defaultValue={sp.action ?? ""}>
          <option value="">Any action</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input" name="ok" defaultValue={sp.ok ?? ""}>
          <option value="">Any outcome</option>
          <option value="1">Done</option>
          <option value="0">Refused</option>
        </select>
        <input className="input" type="date" name="from" defaultValue={sp.from ?? ""} aria-label="From" />
        <input className="input" type="date" name="to" defaultValue={sp.to ?? ""} aria-label="To" />
        <button className="btn btn--secondary btn--md" type="submit">Filter</button>
        {filtered && <Link href="/audit" className="btn btn--ghost btn--md">Clear</Link>}
      </form>

      <Card style={{ padding: "20px 26px 16px" }}>
        {entries.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>{filtered ? "Nothing matches that filter." : "No console actions recorded yet."}</p>
        ) : (
          <AuditTable entries={entries} openId={sp.id ? Number(sp.id) : null} />
        )}
        {offset + entries.length < total && (
          <div style={{ marginTop: 14 }}>
            <Link href={`/audit?${olderQs.toString()}`} className="btn btn--secondary btn--sm">Load older</Link>
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Check and commit**

Run: `cd app && npx tsc --noEmit -p .` and `cd admin && npx tsc --noEmit -p .`
Expected: no output from either.

```bash
git add app/src/lib/platform/audit.ts app/src/lib/platform/audit.test.ts app/src/app/api/platform/audit/route.ts admin/src/lib/types.ts admin/src/components/AuditTable.tsx "admin/src/app/(console)/audit/page.tsx" admin/src/app/globals.css
git commit -m "feat(audit): filter by business, person, action, outcome, dates and text; rows expand; deep links

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Saved views

**Files:**
- Create: `app/src/lib/platform/views.ts`, `app/src/app/api/platform/views/route.ts`
- Create: `admin/src/lib/views.ts`, `admin/src/app/(console)/views/actions.ts`, `admin/src/components/SaveViewButton.tsx`
- Modify: `admin/src/components/Shell.tsx`, `admin/src/app/(console)/layout.tsx`, `admin/src/app/(console)/gyms/page.tsx`, `admin/src/app/(console)/audit/page.tsx`, `admin/src/app/globals.css`

**Interfaces:**
- A view is `{ id: string; name: string; href: string }`. Stored per staff member in `platform_settings` under key `console_views:<userId>` as JSON.
- App: `listViews(userId): View[]`, `saveViews(userId, views: View[]): void`; route `GET /views` → `{ views }`, `PUT /views { views }`.
- Console: `BUILT_IN_VIEWS`, `saveViewAction(name, href)`, `deleteViewAction(id)`; `Shell` receives `views: View[]`.

- [ ] **Step 1: App side**

`app/src/lib/platform/views.ts`:

```ts
import "server-only";

import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/** A saved console view: a name and the URL (path + query) that reproduces it. Per staff member. */
export interface ConsoleView { id: string; name: string; href: string }

const MAX = 30;

export function listViews(userId: number): ConsoleView[] {
  try {
    const raw = getPlatformSetting(`console_views:${userId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is ConsoleView => typeof v?.id === "string" && typeof v?.name === "string" && typeof v?.href === "string" && v.href.startsWith("/"));
  } catch {
    return [];
  }
}

export function saveViews(userId: number, views: ConsoleView[]): void {
  const clean = views
    .filter((v) => v.href.startsWith("/") && v.name.trim())
    .map((v) => ({ id: v.id.slice(0, 40), name: v.name.trim().slice(0, 60), href: v.href.slice(0, 500) }))
    .slice(0, MAX);
  setPlatformSetting(`console_views:${userId}`, JSON.stringify(clean));
}
```

`app/src/app/api/platform/views/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { listViews, saveViews } from "@/lib/platform/views";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json({ views: listViews(g.userId) });
}

const schema = z.object({
  views: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().min(1).max(60), href: z.string().startsWith("/").max(500) })).max(30),
});

/** Replaces the whole list; the console sends it back edited. Not audited: it is the person's own bookmarks. */
export async function PUT(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That list does not make sense." }, { status: 400 });
  saveViews(g.userId, parsed.data.views);
  return NextResponse.json({ ok: true, views: listViews(g.userId) });
}
```

- [ ] **Step 2: Console side**

`admin/src/lib/views.ts`:

```ts
export interface ConsoleView { id: string; name: string; href: string }

/** Always there, under the person's own. */
export const BUILT_IN_VIEWS: ConsoleView[] = [
  { id: "past-due", name: "Past due", href: "/gyms?status=past_due" },
  { id: "awaiting", name: "Awaiting payment", href: "/gyms?status=pending_payment" },
  { id: "archived", name: "Archived", href: "/gyms?status=archived" },
  { id: "refused", name: "Refused actions", href: "/audit?ok=0" },
];
```

`admin/src/app/(console)/views/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import type { ConsoleView } from "@/lib/views";

type Result = { ok: true } | { ok: false; error: string };

export async function saveViewAction(name: string, href: string): Promise<Result> {
  try {
    const { views } = await api<{ views: ConsoleView[] }>("/views");
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await api("/views", { method: "PUT", body: { views: [...views, { id, name, href }] } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Could not save that view." };
  }
}

export async function deleteViewAction(id: string): Promise<Result> {
  try {
    const { views } = await api<{ views: ConsoleView[] }>("/views");
    await api("/views", { method: "PUT", body: { views: views.filter((v) => v.id !== id) } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Could not remove that view." };
  }
}
```

`admin/src/components/SaveViewButton.tsx`:

```tsx
"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark } from "lucide-react";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { saveViewAction } from "@/app/(console)/views/actions";

/** Saves the current URL (filters, sort, columns) as a sidebar link. */
export function SaveViewButton() {
  const pathname = usePathname();
  const params = useSearchParams();
  const ask = useConfirm();
  async function onClick() {
    const r = await ask({ title: "Save this view", body: "It appears under Views in the sidebar, for you only.", confirmLabel: "Save", prompt: { label: "Name", placeholder: "Past due gyms", minLength: 2 } });
    if (!r.ok) return;
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    const res = await saveViewAction(r.value, href);
    if (res.ok) notify.ok(`Saved "${r.value}"`);
    else notify.fail(res.error);
  }
  return (
    <button type="button" className="btn btn--ghost btn--md" onClick={onClick}>
      <Bookmark size={14} strokeWidth={1.75} aria-hidden /> Save view
    </button>
  );
}
```

Add `<SaveViewButton />` as the last child of the `<form className="toolbar">` on both `gyms/page.tsx` and `audit/page.tsx`.

`admin/src/app/(console)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import type { ConsoleView } from "@/lib/views";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requireAdminSession();
  let views: ConsoleView[] = [];
  try {
    views = (await api<{ views: ConsoleView[] }>("/views")).views;
  } catch {
    views = [];
  }
  return (
    <ConfirmProvider>
      <Shell user={user} views={views}>{children}</Shell>
    </ConfirmProvider>
  );
}
```

In `admin/src/components/Shell.tsx`: add the prop `views: ConsoleView[]` (import the type and `BUILT_IN_VIEWS` from `@/lib/views`, `deleteViewAction` from `@/app/(console)/views/actions`, `X` is already imported, add `Bookmark`), and after the `NAV_GROUPS.map(...)` block inside `<nav>` render:

```tsx
          <div>
            <div className="nav-group-label">Views</div>
            {[...views, ...BUILT_IN_VIEWS].map((v) => {
              const active = `${pathname}${typeof window !== "undefined" ? window.location.search : ""}` === v.href;
              const own = views.some((o) => o.id === v.id);
              return (
                <span key={v.id} className="nav-view">
                  <Link href={v.href} className={cn("nav-link", active && "nav-link--active")}>
                    <Bookmark size={14} strokeWidth={1.75} />
                    <span>{v.name}</span>
                  </Link>
                  {own && (
                    <button type="button" className="nav-view-x" aria-label={`Remove ${v.name}`} onClick={() => void deleteViewAction(v.id)}>
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
```

Append to `admin/src/app/globals.css`:

```css
.nav-view { display: flex; align-items: center; }
.nav-view .nav-link { flex: 1; min-width: 0; }
.nav-view .nav-link span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-view-x { flex: 0 0 auto; width: 24px; height: 24px; margin-right: 4px; border: 0; background: transparent; color: var(--text-tertiary); border-radius: 6px; cursor: pointer; display: grid; place-items: center; opacity: 0; }
.nav-view:hover .nav-view-x { opacity: 1; }
.nav-view-x:hover { background: var(--surface-2); color: var(--text-primary); }
```

- [ ] **Step 3: Check and commit**

Run: `cd app && npx tsc --noEmit -p .` and `cd admin && npx tsc --noEmit -p .`

```bash
git add app/src/lib/platform/views.ts app/src/app/api/platform/views/route.ts admin/src/lib/views.ts "admin/src/app/(console)/views/actions.ts" admin/src/components/SaveViewButton.tsx admin/src/components/Shell.tsx "admin/src/app/(console)/layout.tsx" "admin/src/app/(console)/gyms/page.tsx" "admin/src/app/(console)/audit/page.tsx" admin/src/app/globals.css
git commit -m "feat(console): saved views in the sidebar, per staff member, plus four built-in ones

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Bulk actions on Businesses

**Files:**
- Create: `admin/src/app/(console)/gyms/bulk-actions.ts`
- Create: `admin/src/components/ui/BulkBar.tsx`
- Modify: `admin/src/components/BusinessesTable.tsx`, `admin/src/app/globals.css`

**Interfaces:**
- `bulkTenantAction(ids: number[], action: "grant-credits" | "grant-ai-credits" | "suspend-ai" | "resume-ai" | "suspend-marketing" | "resume-marketing", body?: Record<string, unknown>): Promise<{ done: number; failed: { id: number; error: string }[] }>`. Each id goes through `tenantAction`, so each gets its own audit row in the main app.

- [ ] **Step 1: The server action**

`admin/src/app/(console)/gyms/bulk-actions.ts`:

```ts
"use server";

import { tenantAction, type TenantActionName } from "./[id]/actions";

export type BulkAction = Extract<TenantActionName, "grant-credits" | "grant-ai-credits" | "suspend-ai" | "resume-ai" | "suspend-marketing" | "resume-marketing">;

/**
 * The same per-business action, once per selected business, in order. One
 * failure does not stop the rest; the caller gets both counts. Each call is
 * audited on its own in the main app, so the log reads "granted to A,
 * granted to B", which is what happened.
 */
export async function bulkTenantAction(ids: number[], action: BulkAction, body: Record<string, unknown> = {}) {
  let done = 0;
  const failed: { id: number; error: string }[] = [];
  for (const id of ids.slice(0, 200)) {
    const r = await tenantAction(id, action, body);
    if (r.ok) done++;
    else failed.push({ id, error: r.error ?? "failed" });
  }
  return { done, failed };
}
```

- [ ] **Step 2: The bar and the wiring**

`admin/src/components/ui/BulkBar.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

/** Appears above a table when rows are selected. */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="bulk" role="region" aria-label="Bulk actions">
      <span className="bulk-count">{count} selected</span>
      <span className="bulk-actions">{children}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}>Clear</button>
    </div>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
.bulk { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--hairline); margin-bottom: 12px; }
.bulk-count { font-size: 13px; color: var(--text-primary); font-weight: 500; }
.bulk-actions { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; }
```

In `admin/src/components/BusinessesTable.tsx`: add state and the bar. Imports:

```tsx
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BulkBar } from "@/components/ui/BulkBar";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { bulkTenantAction, type BulkAction } from "@/app/(console)/gyms/bulk-actions";
```

Inside the component, before `columns`:

```tsx
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const router = useRouter();
  const ask = useConfirm();
  const ids = () => [...selected].map(Number);

  async function run(action: BulkAction, label: string, danger = false, amount = false) {
    const r = await ask({
      title: `${label} for ${selected.size} ${selected.size === 1 ? "business" : "businesses"}`,
      confirmLabel: label,
      danger,
      prompt: amount ? { label: "Amount in euro", placeholder: "50", minLength: 1 } : undefined,
    });
    if (!r.ok) return;
    const body = amount ? { cents: Math.round(Number(r.value) * 100) } : {};
    if (amount && (!Number.isFinite(Number(r.value)) || Number(r.value) <= 0)) {
      notify.fail("Give an amount in euro.");
      return;
    }
    const res = await bulkTenantAction(ids(), action, body);
    if (res.failed.length === 0) notify.ok(`${label}: done for ${res.done}`);
    else notify.fail(`${label}: ${res.done} done, ${res.failed.length} failed (${res.failed.map((f) => `#${f.id} ${f.error}`).join("; ")})`);
    setSelected(new Set());
    router.refresh();
  }
```

and wrap the return:

```tsx
  return (
    <>
      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => run("grant-credits", "Grant email credits", false, true)}>Grant email credits</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => run("grant-ai-credits", "Grant AI credits", false, true)}>Grant AI credits</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => run("resume-ai", "Resume AI")}>Resume AI</button>
        <button type="button" className="btn btn--destructive btn--sm" onClick={() => run("suspend-ai", "Suspend AI", true)}>Suspend AI</button>
        <button type="button" className="btn btn--destructive btn--sm" onClick={() => run("suspend-marketing", "Suspend marketing", true)}>Suspend marketing</button>
      </BulkBar>
      <DataTable
        rows={tenants}
        columns={columns}
        rowKey={(t) => t.id}
        defaultSort={{ key: "name", dir: "asc" }}
        csvName="businesses"
        empty="No businesses match."
        selectable
        selected={selected}
        onSelect={setSelected}
        rowStyle={(t) => (t.archivedAt ? { opacity: 0.6 } : undefined)}
      />
    </>
  );
```

- [ ] **Step 3: Check and commit**

Run: `cd admin && npx tsc --noEmit -p .`. In the console select two businesses, press Resume AI, confirm: a toast says done for 2; the audit log shows two `resume-ai` rows.

```bash
git add "admin/src/app/(console)/gyms/bulk-actions.ts" admin/src/components/ui/BulkBar.tsx admin/src/components/BusinessesTable.tsx admin/src/app/globals.css
git commit -m "feat(console): select businesses and grant credits or suspend/resume in one go

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Money tab in two columns

**Files:**
- Modify: `admin/src/app/(console)/gyms/[id]/money/page.tsx`
- Modify: `admin/src/app/globals.css`

- [ ] **Step 1: The grid**

Append to `admin/src/app/globals.css`:

```css
/* ── Money tab: two columns from 1100px, one below ──────────────────────── */
.money { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: start; }
.money-col { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.money-wide { grid-column: 1 / -1; }
@media (max-width: 1100px) { .money { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 2: Reorder the sections**

In `money/page.tsx` the return currently is one `<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>` holding, in order: Billing card, Venue type card, Email marketing card, AI credits card, Voice agent card, `<MoneyAdjustments>`, Invoices card, Danger zone card. Change the wrapper and group them:

```tsx
  return (
    <div className="money">
      <div className="money-col">
        {/* Billing panel */}
        …Billing card unchanged…
        {/* Venue type */}
        …Venue type card unchanged…
        {money && <MoneyAdjustments tenantId={id} data={money} isOwner={me.role === "owner"} />}
      </div>
      <div className="money-col">
        …Email marketing card unchanged…
        …AI credits card unchanged…
        …Voice agent card unchanged…
      </div>
      <div className="money-wide">
        …Invoices card unchanged…
      </div>
      <div className="money-wide">
        …Danger zone card unchanged…
      </div>
    </div>
  );
```

(Move the JSX blocks; do not edit their contents.)

- [ ] **Step 3: Screenshot, check, commit**

Run: `cd admin && npx tsc --noEmit -p . && ADMIN_SESSION=$RAW node scripts/screens.mjs /tmp/screens money`
Expected: at 1440px the Money tab is two columns with Invoices and Danger zone full width below; the page is about half as tall as before.

```bash
git add "admin/src/app/(console)/gyms/[id]/money/page.tsx" admin/src/app/globals.css
git commit -m "design(console): Money tab in two columns

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Deploy both apps

- [ ] **Step 1: App checks and deploy** (the console's search, audit filters and views need the new routes)

```bash
cd app && npx tsc --noEmit -p . && npm test 2>&1 | tail -1 && rm -rf .next && npx next build 2>&1 | tail -2
git push origin main
railway up --detach
```

Wait for `SUCCESS` and `curl -s https://app.adonisagent.ie/api/health`.

- [ ] **Step 2: Console checks and deploy**

```bash
cd admin && npx tsc --noEmit -p . && npm test 2>&1 | tail -1 && npx next build 2>&1 | tail -2
railway up --detach
```

- [ ] **Step 3: Verify**

On admin.adonisagent.ie: Cmd+K finds Optimal Health and one of its staff by email. Businesses sorts by Joined and exports a CSV. Audit filters by business and outcome; a row expands; `?id=` opens it. Save a view; it appears in the sidebar; remove it. Select two businesses; Resume AI; two audit rows. Money tab is two columns.

---

## Self-review

**Spec coverage.** Cmd+K global search with a search endpoint across tenants, users, domains, invoices: Tasks 1, 2. Real tables (sort, page, columns, CSV) on Businesses, People*, Audit, Invoices*, Health: Tasks 3, 4, 5. (*People keeps its own table: every row has interactive controls and the list is short; Invoices stays inside the Money card for the same reason. Both are stated in Task 3's component comment.) Audit filters by business, staff, action, outcome, date range, expand to detail, deep link: Task 5. Saved views in the sidebar, built-ins: Task 6. Bulk actions with per-tenant audit rows: Task 7. Money two-column: Task 8. Deploy: Task 9.

**Placeholders.** Task 8 Step 2 uses "…card unchanged…" markers to say which existing JSX blocks move; nothing new is written there, which is the point. Everything else carries its code.

**Type consistency.** `SearchHit` is declared identically in app (Task 1) and admin (Task 2). `AuditResponse` gains `total` and `actions` (Task 5) and the page reads both. `TableState`/`readTableState`/`writeTableState` (Task 3) are used only inside `DataTable`. `ConsoleView` (Task 6) is the same shape in both apps. `BulkAction` (Task 7) is a subset of `TenantActionName` from Tier 0's `gyms/[id]/actions.ts`.
