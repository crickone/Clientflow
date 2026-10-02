import "server-only";

import { and, desc, eq, gte, inArray, like, lte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { dayRange } from "./marketingQueries";
import { bucketIndex, seriesBuckets } from "./stats";

export { formSubmissionsIn, trafficRows, visitorsSeries, visitorsTotal } from "./marketingQueries";

const PV = schema.sitePageViewsDaily;

/** Page views summed across the tenant's sites, per series bucket. */
export function pageViewsSeries(fromMs: number, toMs: number): { labels: string[]; values: number[]; total: number } {
  const buckets = seriesBuckets(fromMs, toMs);
  const values = buckets.map(() => 0);
  const { from, to } = dayRange(fromMs, toMs);
  const rows = db
    .select({ day: PV.day, n: sql<number>`sum(${PV.views})` })
    .from(PV)
    .where(and(gte(PV.day, from), lte(PV.day, to)))
    .groupBy(PV.day)
    .all();
  for (const r of rows) {
    const i = bucketIndex(buckets, Date.parse(`${r.day}T00:00:00Z`));
    if (i >= 0) values[i] += Number(r.n);
  }
  return { labels: buckets.map((b) => b.label), values, total: values.reduce((a, b) => a + b, 0) };
}

export function pageViewsTotal(fromMs: number, toMs: number): number {
  return pageViewsSeries(fromMs, toMs).total;
}

/** Views per raw path in range (callers normalise and group). */
export function pathViews(fromMs: number, toMs: number, pathLike?: string): { path: string; views: number }[] {
  const { from, to } = dayRange(fromMs, toMs);
  return db
    .select({ path: PV.path, views: sql<number>`sum(${PV.views})` })
    .from(PV)
    .where(and(gte(PV.day, from), lte(PV.day, to), pathLike ? like(PV.path, pathLike) : undefined))
    .groupBy(PV.path)
    .all()
    .map((r) => ({ path: r.path, views: Number(r.views) }));
}

/** Slug to title for the given blog slugs. */
export function blogTitlesBySlug(slugs: string[]): Map<string, string> {
  if (slugs.length === 0) return new Map();
  return new Map(
    db
      .select({ slug: schema.blogPosts.slug, title: schema.blogPosts.title })
      .from(schema.blogPosts)
      .where(inArray(schema.blogPosts.slug, slugs))
      .all()
      .flatMap((r) => (r.slug ? [[r.slug, r.title] as const] : [])),
  );
}

/** Form submissions in [fromMs, toMs) per form title, largest first. */
export function submissionsByForm(fromMs: number, toMs: number, limit: number): { label: string; value: number }[] {
  const S = schema.formSubmissions;
  return db
    .select({ title: schema.forms.title, type: schema.forms.type, n: sql<number>`count(*)` })
    .from(S)
    .innerJoin(schema.forms, eq(schema.forms.id, S.formId))
    .where(and(gte(S.createdAt, new Date(fromMs)), sql`${S.createdAt} < ${toMs}`))
    .groupBy(S.formId)
    .orderBy(desc(sql`count(*)`))
    .limit(limit)
    .all()
    .map((r) => ({ label: r.title.trim() || r.type, value: Number(r.n) }));
}

export type PageEdit = { id: number; page: string; source: string; atMs: number };

/** Latest page revisions with their page title. */
export function recentEdits(limit: number): PageEdit[] {
  const R = schema.pageRevisions;
  return db
    .select({ id: R.id, title: schema.pages.title, path: schema.pages.path, source: R.source, at: R.createdAt })
    .from(R)
    .innerJoin(schema.pages, eq(schema.pages.id, R.pageId))
    .orderBy(desc(R.createdAt), desc(R.id))
    .limit(limit)
    .all()
    .map((r) => ({ id: r.id, page: r.title?.trim() || r.path, source: r.source, atMs: r.at.getTime() }));
}

export function openRequestCount(): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.siteRequests)
    .where(eq(schema.siteRequests.status, "new"))
    .get();
  return Number(row?.n ?? 0);
}
