/**
 * Website preset pure helpers (no DB, no server imports; tested in
 * website.test.ts). The loaders live in websiteQueries.ts.
 */

/** A tracked path without the dev mount prefix ("/site/<slug>/blog/x" -> "/blog/x"), "/" for the home page. */
export function normalizePath(path: string): string {
  const stripped = path.replace(/^\/site\/[^/]+/, "");
  const clean = stripped.split("?")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
}

/** "Home" for the root, otherwise the normalised path. */
export function pathLabel(path: string): string {
  const p = normalizePath(path);
  return p === "/" ? "Home" : p;
}

/** The blog post slug a path points at, or null when it is not a blog post page. */
export function blogSlugFromPath(path: string): string | null {
  const m = /^\/blog\/([^/]+)$/.exec(normalizePath(path));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Views per label with equal labels summed (dev and prod paths for one page merge), largest first. */
export function groupViews(rows: { path: string; views: number }[], limit: number): { label: string; value: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const k = pathLabel(r.path);
    by.set(k, (by.get(k) ?? 0) + r.views);
  }
  return [...by]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Views per blog post title; slugs without a known post are dropped. */
export function blogViewRows(
  rows: { path: string; views: number }[],
  titles: Map<string, string>,
  limit: number,
): { label: string; value: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const slug = blogSlugFromPath(r.path);
    const title = slug === null ? undefined : titles.get(slug);
    if (title === undefined) continue;
    by.set(title, (by.get(title) ?? 0) + r.views);
  }
  return [...by]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, limit);
}

const SOURCE_LABELS: Record<string, string> = { studio: "Studio", agent: "Adonis", deploy: "Deploy", restore: "Restored", baseline: "Baseline" };

export function revisionSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
