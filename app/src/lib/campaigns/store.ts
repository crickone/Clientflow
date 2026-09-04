import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { addCampaignNote } from "@/lib/marketing/calendarNotes";
import type { Campaign, CampaignAsset } from "@/lib/db/schema";

import { listSites } from "@/lib/cms/sites";

import {
  ASSET_ORDER,
  DEFAULT_ASSET_PLAN,
  findApprovedLandingAsset,
  isTerminalStatus,
  nextPendingAsset,
  type AssetDef,
  type AssetKind,
  type AssetLike,
  type AssetStatus,
  type CampaignStatus,
  type LandingAssetLike,
} from "./plan";
import { buildCampaignLandingUrl } from "./landingUrl";

/**
 * Campaign store — drizzle CRUD for `campaigns` + `campaign_assets`
 * (Campaign Engine Slice 1). Reads/writes through the ambient, request-scoped
 * `db` proxy (see lib/db/index.ts), the same choice lib/marketing/campaigns.ts
 * and lib/image/carousels.ts make. Every write that touches an asset also
 * bumps the parent campaign's updated_at (mirrors carousels.ts's
 * addSlide/updateSlide/deleteSlide) so "last touched" stays accurate for the
 * campaign list view.
 *
 * The ordering + status-plan pure helpers (DEFAULT_ASSET_PLAN,
 * nextPendingAsset, ASSET_ORDER, isTerminalStatus, findApprovedLandingAsset)
 * live in ./plan — which has zero imports, so it (and by extension
 * store.test.ts, which only exercises the first two; plan.test.ts covers
 * findApprovedLandingAsset directly) loads under the DB-free tsx test runner
 * — and are just re-exported here for callers that only need `./store` as
 * their one import (e.g. the public landing route, Campaign Engine Slice 2
 * Task 3, which needs findApprovedLandingAsset alongside getCampaignBySlug/
 * listAssets below). buildCampaignLandingUrl (the representative-site pick +
 * URL-format rule for a campaign's landing page — Slice 2 Task 4) lives in
 * ./landingUrl for the same DB-free-testability reason and is re-exported the
 * same way; its DB-touching half, `getCampaignLandingUrl` below, reads the
 * tenant's sites via @/lib/cms/sites's listSites() so launch.ts and the
 * campaign hub detail page both get the SAME answer through one call.
 */
export {
  ASSET_ORDER,
  DEFAULT_ASSET_PLAN,
  findApprovedLandingAsset,
  isTerminalStatus,
  nextPendingAsset,
  buildCampaignLandingUrl,
};
export type { AssetDef, AssetKind, AssetLike, AssetStatus, CampaignStatus, LandingAssetLike };
export type { Campaign, CampaignAsset };

// ── campaigns ────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string;
  slug: string;
  season?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  offer?: string;
  /**
   * Skip writing the seasonal-calendar note. Only the demo seeder sets this —
   * a throwaway "Test Campaign" shouldn't leave a note behind that the demo
   * teardown can't remove.
   */
  skipCalendarNote?: boolean;
}

/**
 * Create a new campaign in status='building'. Does NOT seed assets — call
 * addAssets(campaign.id, DEFAULT_ASSET_PLAN) separately (kept as two steps so
 * a caller can build a custom asset plan instead of the default one).
 */
export function createCampaign(input: CreateCampaignInput): Campaign {
  const campaign = db
    .insert(schema.campaigns)
    .values({
      name: input.name.trim(),
      slug: input.slug.trim(),
      season: input.season ?? null,
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      offer: input.offer ?? "",
    })
    .returning()
    .get();

  // Record it on the seasonal calendar, so the month shows what's actually
  // running rather than only what the operator wrote down. Hooked HERE, at the
  // single creation choke point, rather than in the agent tool — an agent can
  // forget to call something, a choke point can't. Best-effort: a calendar
  // write must never fail a campaign creation.
  if (!input.skipCalendarNote) {
    try {
      logCampaignToCalendar(campaign);
    } catch (err) {
      console.error("[campaigns] calendar note failed:", err);
    }
  }
  return campaign;
}

/**
 * Write the "what's happening" line for a campaign onto the month it starts in
 * (falling back to today when it has no start date). Deliberately factual —
 * name, offer, dates — since the operator's own note is where opinion belongs.
 */
function logCampaignToCalendar(campaign: Campaign): void {
  const iso = campaign.startsOn ?? new Date().toISOString().slice(0, 10);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month)) return;
  const when = campaign.startsOn
    ? `from ${campaign.startsOn}${campaign.endsOn ? ` to ${campaign.endsOn}` : ""}`
    : "no dates set";
  const offer = campaign.offer?.trim();
  const line = `${campaign.name} — ${when}${offer ? `. Offer: ${offer}` : ""}`;
  addCampaignNote(year, month, line);
}

export function getCampaign(id: number): Campaign | null {
  return (
    db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get() ?? null
  );
}

/**
 * Look up a campaign by its slug. `slug` has no DB-unique constraint (see
 * tenant.ts's campaigns table + tools.campaign.ts's note that two campaigns
 * with the same name land on the same slug — "dedupe is not required for
 * v1"), so this returns *a* match, not guaranteed the only one.
 *
 * Reads through the ambient `db` proxy like every other function in this
 * file, so it's ALWAYS tenant-scoped by whatever bound the request's tenant
 * context — critically, the public signup route (Campaign Engine Slice 2,
 * Task 2) calls this inside `runWithTenant(site.tenantId, …)`, where
 * `site.tenantId` was resolved from the request HOST, never from client
 * input. That's what makes cross-tenant campaign attribution structurally
 * impossible: a slug from tenant B simply doesn't exist in tenant A's DB.
 */
export function getCampaignBySlug(slug: string): Campaign | null {
  return (
    db.select().from(schema.campaigns).where(eq(schema.campaigns.slug, slug)).get() ?? null
  );
}

/** All campaigns, newest first. */
export function listCampaigns(): Campaign[] {
  return db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).all();
}

export function setCampaignStatus(id: number, status: CampaignStatus): void {
  db.update(schema.campaigns)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.campaigns.id, id))
    .run();
}

/**
 * Record manual ad spend for a campaign (Campaign Engine Slice 5 — the CFA/
 * ROAS scoreboard's one manual input; later tasks derive CFA/CAC/ROAS from
 * this against the campaign's leads/conversions). `cents` is clamped to a
 * non-negative integer so a bad operator input can't store a negative spend
 * or drift the DB's INTEGER column off a whole cent. Deliberately does NOT
 * bump updatedAt — unlike setCampaignStatus, adjusting spend isn't a content
 * edit, so it shouldn't perturb "last touched" for the campaign list view.
 */
export function setCampaignAdSpend(campaignId: number, cents: number): void {
  const clamped = Math.max(0, Math.round(cents));
  db.update(schema.campaigns)
    .set({ adSpendCents: clamped })
    .where(eq(schema.campaigns.id, campaignId))
    .run();
}

/**
 * Bump a campaign's landing-page view counter by 1 (this task). Called ONLY
 * from the public landing route, and only once its own render gate has
 * already confirmed a real, live landing page is about to be served (see
 * site/[siteSlug]/c/[campaignSlug]/page.tsx) — this function itself does no
 * gating of its own, it just increments. A raw `sql` increment (not a
 * read-then-write) so concurrent visitors can never race-clobber each other's
 * count. Deliberately does NOT bump updatedAt, same reasoning as
 * setCampaignAdSpend above — a page view isn't a content edit, so it
 * shouldn't perturb "last touched" for the campaign list view.
 */
export function incrementCampaignViews(campaignId: number): void {
  db.update(schema.campaigns)
    .set({ landingViews: sql`landing_views + 1` })
    .where(eq(schema.campaigns.id, campaignId))
    .run();
}

/**
 * The live public URL for a campaign's landing page, or `null` if the tenant
 * has no CMS site to host it on (Campaign Engine Slice 2, Task 4). Thin DB
 * wrapper around the pure `buildCampaignLandingUrl` (./landingUrl): reads the
 * tenant's sites via the ambient `db` proxy (@/lib/cms/sites's listSites)
 * and lets the pure function do the representative-site pick + URL
 * formatting. This is the ONLY thing launch.ts (the launch summary's
 * "landing page live at …" line) and the campaign hub detail page (the
 * landing URL's copy/view affordance) call — neither re-implements the
 * site-picking rule itself, so they can't diverge on it.
 */
export async function getCampaignLandingUrl(campaignSlug: string): Promise<string | null> {
  const sites = await listSites();
  return buildCampaignLandingUrl(sites, campaignSlug);
}

// ── campaign assets ─────────────────────────────────────────────────────

function touchCampaign(campaignId: number): void {
  db.update(schema.campaigns)
    .set({ updatedAt: new Date() })
    .where(eq(schema.campaigns.id, campaignId))
    .run();
}

/** Bulk-insert a set of asset rows (typically DEFAULT_ASSET_PLAN) under a campaign. */
export function addAssets(campaignId: number, defs: AssetDef[]): CampaignAsset[] {
  if (defs.length === 0) return [];
  const rows = db
    .insert(schema.campaignAssets)
    .values(
      defs.map((d) => ({
        campaignId,
        kind: d.kind,
        title: d.title,
        sortOrder: d.sortOrder,
      })),
    )
    .returning()
    .all();
  touchCampaign(campaignId);
  return rows;
}

export function getAsset(id: number): CampaignAsset | null {
  return (
    db
      .select()
      .from(schema.campaignAssets)
      .where(eq(schema.campaignAssets.id, id))
      .get() ?? null
  );
}

/** Every asset for a campaign, ordered by sort_order. */
export function listAssets(campaignId: number): CampaignAsset[] {
  return db
    .select()
    .from(schema.campaignAssets)
    .where(eq(schema.campaignAssets.campaignId, campaignId))
    .orderBy(asc(schema.campaignAssets.sortOrder))
    .all();
}

/** Save a generated draft: sets title/body and moves the asset to status='drafted'. No-ops if the id doesn't exist. */
export function setAssetDraft(id: number, patch: { title: string; body: string }): void {
  const before = db
    .select({ campaignId: schema.campaignAssets.campaignId })
    .from(schema.campaignAssets)
    .where(eq(schema.campaignAssets.id, id))
    .get();
  if (!before) return;
  db.update(schema.campaignAssets)
    .set({ title: patch.title, body: patch.body, status: "drafted", updatedAt: new Date() })
    .where(eq(schema.campaignAssets.id, id))
    .run();
  touchCampaign(before.campaignId);
}

/**
 * Operator approval for a campaign asset — the write-approval gate's
 * terminal step. `externalKind`/`externalId` optionally record where the
 * asset was materialised to (a blog_posts/carousel_sets/email_campaigns row,
 * set by the later materialise task); omit them to approve in place without
 * a materialised target yet. No-ops if the id doesn't exist.
 */
export function approveAsset(
  id: number,
  opts?: { externalKind?: CampaignAsset["externalKind"]; externalId?: number },
): void {
  const before = db
    .select({ campaignId: schema.campaignAssets.campaignId })
    .from(schema.campaignAssets)
    .where(eq(schema.campaignAssets.id, id))
    .get();
  if (!before) return;
  db.update(schema.campaignAssets)
    .set({
      status: "approved",
      ...(opts?.externalKind !== undefined ? { externalKind: opts.externalKind } : {}),
      ...(opts?.externalId !== undefined ? { externalId: opts.externalId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.campaignAssets.id, id))
    .run();
  touchCampaign(before.campaignId);
}
