# ClientFlow — Project Context for Claude Code

## What this is

**ClientFlow** is a multi-tenant platform (Next.js 14, App Router) that the agency
uses to run client businesses and **build/manage their websites** under one roof.
It combines a CRM (clients, appointments, leads, packages, content studio) with a
**multi-site CMS** (pages, blog, SEO, media, a visual editor, and per-site domains).

The first managed website is **Renova Cellular Health** (a wellness clinic in
Clonmel, Co. Tipperary — optimalhealthatinspire.ie · ☎ 083 867 2844).

> Note: the root folder may be named `clientflow` (renamed from `Renova`). Nothing
> in the code depends on the folder name — all paths are relative.

## Folder layout

```
<root>/
  app/                      ← the ClientFlow platform (Next.js CMS + CRM)
    src/                    ← app code
    data/                   ← SQLite DBs (control.db, clinic.db, tenants/<slug>/…)
    public/sites/<slug>/    ← per-site static assets (namespaced)
  sites/
    renova/                 ← Renova bespoke website SOURCE (static HTML, assets, …)
    <client>/               ← future client site source folders
  tools/
    import-site.cjs         ← import a site folder's HTML into the CMS
  extract/                  ← legacy OHR ad-library extractor (referenced by app build)
```

## The CMS (in `app/src`)

- **Multi-site model:** a `sites` table (tenant DB), all CMS content scoped by
  `site_id`. Control-plane `site_domains` maps hostnames → tenant+site for public
  rendering. See `src/lib/db/{schema.ts,tenant.ts,control.ts}`.
- **Admin** under `src/app/cms/` — Sites list, per-site dashboard, Pages (block +
  SEO editor), Blog (AI draft + publish), Media, Domains, Requests, and the
  full-screen **Studio** visual editor (`/cms/<slug>/studio`).
- **Public rendering** under `src/app/site/[siteSlug]/…` — resolves the site by
  host (prod) or `?site=`/path (dev) via `src/lib/cms/resolveHost.ts`. NEVER uses
  the cookie `db` proxy. Per-host `sitemap.xml` + `robots.txt`.
- **Templates:** `src/lib/cms/templates.tsx` registry; bespoke imported pages use
  the `clientflow-live` template (renders first-party HTML verbatim incl. its own
  styles + scripts, so GSAP/Lenis animations run).
- **AI blog** reuses `src/lib/ai/draftBlog.ts` + `src/lib/blog/generator.ts`.

## Adding a new client website

1. **Create the site:** CMS → Sites → **Add site** (admin), or fulfil a **Request**.
2. **Build the design** (bespoke) in `sites/<slug>/` as static HTML/assets.
3. **Import it:** `node tools/import-site.cjs --slug <slug> --name "<Name>"`
   (defaults to `sites/<slug>/`; copies assets to `app/public/sites/<slug>/`,
   rewrites links/asset URLs, keeps scripts, maps title/meta → SEO, publishes).
4. **Manage** content/blog/SEO/media in the CMS + Studio (`/cms/<slug>`).
5. **Go live:** add the client's domain under the site's **Domains**, set
   `CMS_SITE_HOSTS="host=slug,…"` on deploy.

## Running

- `cd app && npm run dev` → http://localhost:3000 (Node at `/usr/local/bin`).
- Public site dev preview: `http://localhost:3000/site/<slug>`.
- Theme is **dark premium**, token-driven in `src/app/globals.css` (`--bg`,
  `--surface-*`, `--accent`, `color-scheme: dark`). The public Renova site keeps
  its own styles (independent of the admin theme).

## OHR business details (Renova ad copy)

```
Business:  Optimal Health & Recovery / Renova Cellular Health
Location:  Ard Gaoithe Business Park, Clonmel, Co. Tipperary
Website:   optimalhealthatinspire.ie   ☎ 083 867 2844
Therapies: HBOT · Infrared · PEMF   (no standalone Red Light Therapy)
```
