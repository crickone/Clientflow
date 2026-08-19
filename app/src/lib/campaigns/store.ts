import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Campaign, CampaignAsset } from "@/lib/db/schema";

import {
  ASSET_ORDER,
  DEFAULT_ASSET_PLAN,
  isTerminalStatus,
  nextPendingAsset,
  type AssetDef,
  type AssetKind,
  type AssetLike,
  type AssetStatus,
  type CampaignStatus,
} from "./plan";

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
 * nextPendingAsset, ASSET_ORDER, isTerminalStatus) live in ./plan — which has
 * zero imports, so it (and by extension store.test.ts, which only exercises
 * those two) loads under the DB-free tsx test runner — and are just
 * re-exported here for callers that only need `./store` as their one import.
 */
export {
  ASSET_ORDER,
  DEFAULT_ASSET_PLAN,
  isTerminalStatus,
  nextPendingAsset,
};
export type { AssetDef, AssetKind, AssetLike, AssetStatus, CampaignStatus };
export type { Campaign, CampaignAsset };

// ── campaigns ────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  name: string;
  slug: string;
  season?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  offer?: string;
}

/**
 * Create a new campaign in status='building'. Does NOT seed assets — call
 * addAssets(campaign.id, DEFAULT_ASSET_PLAN) separately (kept as two steps so
 * a caller can build a custom asset plan instead of the default one).
 */
export function createCampaign(input: CreateCampaignInput): Campaign {
  return db
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
