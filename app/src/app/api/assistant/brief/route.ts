import { requireUser, getCurrentMembership } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getGymDashboard, getNeedsAttention } from "@/lib/dashboard";
import { getSchedulingMode } from "@/lib/settings";
import {
  getGmailConnection,
  GMAIL_SYNC_MIN_GAP_MS,
  isGmailConnected,
  shouldSyncNow,
  syncGmailInbox,
} from "@/lib/gmail";
import { runWithTenant } from "@/lib/db/tenant";
import { getCampaignRadar } from "@/lib/marketing/campaignRadar";
import { MODELS } from "@/lib/ai/client";
import { assertAiAllowed, AiCapError } from "@/lib/ai/usage";
import { meteredCreate } from "@/lib/ai/metered";
import { parseBriefItems } from "@/lib/dashboard/briefItems";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Today's priorities for the dashboard: up to three action items chosen and
 * worded by the model from live data. Returns { items } (lib/dashboard/
 * briefItems decides each item's link) and, when AI is unavailable, { message }.
 */
export async function GET() {
  await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return Response.json({ items: [] });
  const tenantId = membership.tenant.id;
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ items: [] });
  }

  // Checked before doing any of the (best-effort) Gmail sync / dashboard
  // aggregation work below — this route runs on every dashboard load, so a
  // blocked tenant (free tranche used up + no AI credits) must fail fast and
  // cleanly rather than paying for all that work only to then also fail the
  // model call. DailyBrief.tsx shows `data.message` in place of the cards
  // whatever the HTTP status, so AiCapError's own message is the clean surface.
  try {
    assertAiAllowed(tenantId);
  } catch (e) {
    if (e instanceof AiCapError) {
      return Response.json({ items: [], message: e.message }, { status: 429 });
    }
    throw e;
  }

  // Pull in any new mail so getNeedsAttention() eventually reflects a fresh
  // inbox — but NEVER make the brief wait on Google. This used to `await
  // syncGmailInbox` inline, so the brief could block for seconds on ~15
  // serial Gmail round-trips every load (see lib/gmail.ts). Now the sync is
  // fired best-effort and NOT awaited: the brief renders immediately from
  // whatever's already in the DB, and the (now-parallelized) sync just
  // refreshes it for the next load. Gated by shouldSyncNow so rapid
  // dashboard reloads don't re-hit the Gmail API every time — manual "sync
  // now" actions elsewhere (Communication refresh, Settings connect) call
  // syncGmailInbox directly and intentionally bypass this gate. Detached from
  // the request this way, it must bind its own tenant via runWithTenant: a
  // fire-and-forget job loses the request's cookie context by the time its
  // async work actually runs, so the request-scoped `db` proxy would
  // otherwise silently fall back to the DEFAULT tenant (see runWithTenant's
  // doc in lib/db/tenant.ts).
  if (isGmailConnected(tenantId)) {
    const lastSyncMs = getGmailConnection(tenantId)?.lastSyncAt ?? null;
    if (shouldSyncNow(lastSyncMs, Date.now(), GMAIL_SYNC_MIN_GAP_MS)) {
      runWithTenant(tenantId, () => syncGmailInbox(tenantId, { days: 7, max: 15 })).catch(
        (err) => {
          console.error("[assistant/brief] gmail sync failed:", err);
        },
      );
    }
  }

  const business = getBusinessProfile().businessName;
  const mode = getSchedulingMode();
  const gym = getGymDashboard();
  const attention = getNeedsAttention();

  // Campaign Engine Slice 3 (Task 4): fold the same AI campaign radar
  // /marketing/calendar reads into the brief's own context, so the operator
  // sees "what's coming up" proactively on the dashboard too. `tenantId`
  // here is this route's own already-resolved session tenant (line 25
  // above) — the SAME id already used for assertAiAllowed/meteredCreate
  // below, never a second/foreign lookup — so this can't leak another
  // tenant's radar into this brief. getCampaignRadar memoises per
  // tenantId:yyyymmdd, so this either hits that memo or makes, at most, the
  // one metered "marketing" AI call/day the calendar would also trigger —
  // this route adds no new AI framing call of its own. `.catch(() => [])`
  // is belt-and-braces: getCampaignRadar already swallows its own failures
  // internally (a capped/errored/unparseable call falls back to the static
  // catalog angle rather than throwing), so this shouldn't throw today — but
  // the brief must NEVER fail because of the radar, so the call site stays
  // defensive regardless.
  const radar = await getCampaignRadar(tenantId).catch(() => []);

  const data = {
    business,
    date: new Date().toISOString().slice(0, 10),
    activeMembers: gym.activeMembers,
    monthlyRecurringRevenueEur: Math.round(gym.mrrCents / 100),
    classesThisWeek: gym.classesThisWeek,
    attendanceRatePct: gym.attendanceRatePct,
    newLeadsThisMonth: gym.newLeadsThisMonth,
    revenueThisMonthEur: gym.revenueThisMonthEur,
    todaysClasses: gym.todayClasses.map((c) => `${c.time} ${c.name} — ${c.booked}/${c.capacity} booked`),
    needsAttention: attention.map((a) => `${a.count} ${a.label}`),
    // Only present when the radar actually returned something — keeps the
    // system prompt's existing "if a value is 0 or empty, don't dwell on
    // it" rule from ever having to reason about an empty/absent block.
    ...(radar.length > 0
      ? {
          upcomingMarketingOpportunities: radar
            .slice(0, 3)
            .map((r) => `${r.dateName} (in ${r.daysAway} days): ${r.suggestionName} — ${r.suggestionHook}`),
        }
      : {}),
  };

  try {
    // meteredCreate re-checks the cap and records the "brief"/opus spend; the
    // explicit assertAiAllowed above is the fast-path 429 that avoids the Gmail
    // sync + dashboard aggregation for an already-capped tenant.
    const res = await meteredCreate({ tenantId, agentKey: "brief" }, () => ({
      model: MODELS.opus,
      // Up to three short items. Thinking is always on with Opus 5.5 and counts
      // against max_tokens, so leave room; choosing from numbers in hand is `low` work.
      // Set explicitly: Opus 5.5 would otherwise default to `medium`.
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: `You pick TODAY'S PRIORITIES for the owner of ${business}, a ${mode === "timetable" ? "gym/studio" : "clinic"}: what is worth acting on today, shown as cards on their dashboard.
Return ONLY a JSON array of 0 to 3 items, most important first:
[{"kind": "...", "title": "...", "detail": "..."}]
- kind is one of: "leads" (new leads to contact), "messages" (unread or unanswered messages), "schedule" (today's or this week's bookings/classes), "members" (members to check on), "money" (revenue or payments), "campaign" (an upcoming date to promote).
- title: at most 6 words, usually a number and a noun, e.g. "10 new leads", "Bank holiday in 20 days", "3 classes today".
- detail: one plain sentence of at most 8 words that adds something the title doesn't say, e.g. "Not contacted yet.", "Autumn Reset offer is ready to promote." Never restate the title. If there is nothing to add, use "".
- Only include something the owner can act on today. Use only the numbers given; never invent data. Skip anything that is 0 or empty.
- Plain words. No advice phrases ("it's a good time to", "will go a long way", "worth a look"), no exclamation marks, no emoji.
- If nothing needs action, return [].`,
      messages: [{ role: "user", content: `Today's live data:\n${JSON.stringify(data, null, 2)}` }],
    }));
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return Response.json({ items: parseBriefItems(text, mode === "timetable" ? "timetable" : "appointments") });
  } catch {
    return Response.json({ items: [] });
  }
}
