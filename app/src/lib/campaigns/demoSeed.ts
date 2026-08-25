import "server-only";
import { eq, like } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { upsertLead } from "@/lib/leads";
import { resolveStageIdByRole } from "@/lib/pipeline/stageRepo";
import { createCampaign, setCampaignStatus, setCampaignAdSpend, addAssets, DEFAULT_ASSET_PLAN } from "./store";

/**
 * Demo/test data for the Campaigns hub — a self-contained, fully-populated
 * "Test Campaign" so an operator can preview how a live campaign renders
 * (leads · converts · ROAS · CFA) WITHOUT waiting for real ad traffic. It
 * seeds: an active campaign with a set ad-spend + the full approved asset kit,
 * 6 leads attributed to it, and 2 of those tied to demo clients who each hold
 * an active membership — which is exactly what the scoreboard
 * (@/lib/campaigns/scoreboardData) counts as a "convert" with revenue.
 *
 * EVERYTHING is tagged so `removeTestCampaign` pulls it ALL back out — this is
 * throwaway preview data, never real business records:
 *   - campaign.name          = TEST_CAMPAIGN_NAME
 *   - leads.campaign         = TEST_CAMPAIGN_NAME  (leads.source = DEMO_SOURCE)
 *   - clients.email          LIKE %DEMO_EMAIL_DOMAIN  (their client_memberships
 *                            cascade-delete with the client)
 *   - client_memberships.membershipName = DEMO_MEMBERSHIP_NAME (belt-and-braces)
 *
 * Runs through the ambient tenant `db` proxy (a server action's scope), so it
 * seeds/removes the CURRENT tenant only — never cross-tenant. Nothing here
 * sends: assets are drafts, the campaign is just a DB row.
 */
export const TEST_CAMPAIGN_NAME = "Test Campaign";
const TEST_CAMPAIGN_SLUG = "test-campaign";
const DEMO_SOURCE = "demo-seed";
const DEMO_EMAIL_DOMAIN = "@test-campaign.demo";
const DEMO_MEMBERSHIP_NAME = "Test Campaign — Demo Membership";

function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10); // bare YYYY-MM-DD (matches every other date write path)
}

/**
 * Delete the entire demo footprint for the current tenant. Ordered so foreign
 * keys never block: leads reference clients (drop them first), then the demo
 * clients (their memberships cascade), then any stray demo membership by name,
 * then the campaign's assets and the campaign row(s). Idempotent — a no-op if
 * nothing was seeded.
 */
export function removeTestCampaign(): void {
  // Leads first — a demo lead's clientId points at a demo client we're about
  // to delete.
  db.delete(schema.leads).where(eq(schema.leads.campaign, TEST_CAMPAIGN_NAME)).run();
  // Demo clients — client_memberships cascade-delete via their FK.
  db.delete(schema.clients).where(like(schema.clients.email, `%${DEMO_EMAIL_DOMAIN}`)).run();
  // Belt-and-braces: any demo membership whose client somehow didn't match.
  db.delete(schema.clientMemberships).where(eq(schema.clientMemberships.membershipName, DEMO_MEMBERSHIP_NAME)).run();
  // Campaign(s) named "Test Campaign" + their assets.
  const rows = db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.name, TEST_CAMPAIGN_NAME)).all();
  for (const c of rows) {
    db.delete(schema.campaignAssets).where(eq(schema.campaignAssets.campaignId, c.id)).run();
    db.delete(schema.campaigns).where(eq(schema.campaigns.id, c.id)).run();
  }
}

/**
 * Seed the demo campaign for the current tenant. Idempotent: clears any prior
 * demo footprint first, so clicking "Seed" twice never duplicates.
 *
 * The numbers are chosen to show a healthy, self-funded campaign:
 *   6 leads · 2 converts · €150 ad spend · €198 upfront (2 × €99 first month)
 *   → 1.3× ROAS · CFA "✓ Self-funded" (upfront €198 ≥ spend €150).
 */
export function seedTestCampaign(): void {
  removeTestCampaign();

  const startsOn = isoDaysFromNow(-14);
  const endsOn = isoDaysFromNow(30);

  // 1. Campaign — active, with ad spend recorded.
  const campaign = createCampaign({
    name: TEST_CAMPAIGN_NAME,
    slug: TEST_CAMPAIGN_SLUG,
    season: "Autumn",
    startsOn,
    endsOn,
    offer: "8 weeks for the price of 6 — includes an InBody scan and a personalised plan.",
  });
  setCampaignStatus(campaign.id, "active");
  setCampaignAdSpend(campaign.id, 15000); // €150

  // 2. Assets — the default kit, all marked approved so "Assets" shows N/N.
  addAssets(campaign.id, DEFAULT_ASSET_PLAN);
  db.update(schema.campaignAssets)
    .set({ status: "approved" })
    .where(eq(schema.campaignAssets.campaignId, campaign.id))
    .run();

  // 3. Six leads attributed to the campaign.
  const leadNames: readonly [string, string][] = [
    ["Aoife", "Byrne"], ["Cian", "Murphy"], ["Saoirse", "Kelly"],
    ["Darragh", "O'Neill"], ["Niamh", "Walsh"], ["Eoin", "Doyle"],
  ];
  const leadIds = leadNames.map(([firstName, lastName], i) => {
    const { lead } = upsertLead({
      source: DEMO_SOURCE,
      sourceLeadId: `demo-lead-${i + 1}`,
      campaign: TEST_CAMPAIGN_NAME,
      firstName,
      lastName,
      email: `lead${i + 1}${DEMO_EMAIL_DOMAIN}`,
      phone: `+3538900001${String(i + 1).padStart(2, "0")}`,
    });
    return lead.id;
  });

  // 4. The last two leads become converts: create a matching demo client with
  //    an active €99/mo membership (started on the campaign's launch date so
  //    the scoreboard's date-window counts it) and move the lead to a WON-role
  //    stage tied to that client. `resolveClientId` (scoreboardData) uses the
  //    lead's clientId directly, so this is what makes them count as converts.
  const wonStageId = resolveStageIdByRole("won") ?? undefined;
  const convertIdx = [leadNames.length - 2, leadNames.length - 1];
  convertIdx.forEach((idx, n) => {
    const [firstName, lastName] = leadNames[idx];
    const [client] = db
      .insert(schema.clients)
      .values({ firstName, lastName, email: `won${n + 1}${DEMO_EMAIL_DOMAIN}`, phone: `+3538900002${String(n + 1).padStart(2, "0")}` })
      .returning()
      .all();
    db.insert(schema.clientMemberships)
      .values({
        membershipId: null,
        clientId: client.id,
        membershipName: DEMO_MEMBERSHIP_NAME,
        priceCents: 9900, // €99/mo
        status: "active",
        startDate: startsOn,
        nextBillingDate: isoDaysFromNow(16),
      })
      .run();
    db.update(schema.leads)
      .set({ stageId: wonStageId, clientId: client.id })
      .where(eq(schema.leads.id, leadIds[idx]))
      .run();
  });
}
