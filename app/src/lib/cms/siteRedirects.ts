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

function classify(target: string): RedirectMatch | null {
  if (/^https?:\/\//i.test(target)) return { target, kind: "external" };
  // An internal target must be a single-slash root-relative path: not
  // protocol-relative ("//evil.example") and not missing its leading slash.
  if (!/^\/(?!\/)/.test(target)) return null;
  return { target, kind: "internal" };
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
