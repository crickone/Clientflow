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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A short AI-written "morning brief" for the dashboard, from live data. */
export async function GET() {
  await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return Response.json({ brief: "" });
  const tenantId = membership.tenant.id;
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ brief: "" });
  }

  // Checked before doing any of the (best-effort) Gmail sync / dashboard
  // aggregation work below — this route runs on every dashboard load, so a
  // blocked tenant (free tranche used up + no AI credits) must fail fast and
  // cleanly rather than paying for all that work only to then also fail the
  // model call. DailyBrief.tsx renders `data.brief` verbatim as the widget's
  // content regardless of HTTP status (it never checks res.ok), so returning
  // AiCapError's own friendly message here IS the clean, non-500 surface.
  try {
    assertAiAllowed(tenantId);
  } catch (e) {
    if (e instanceof AiCapError) {
      return Response.json({ brief: e.message }, { status: 429 });
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
      max_tokens: 500,
      system: `You write a short, friendly MORNING BRIEF for the owner of ${business}, a ${mode === "timetable" ? "gym/studio" : "clinic"}, shown at the top of their dashboard.
- 3 to 5 short bullet points, Irish English.
- Lead with anything that needs ACTION (unanswered messages, new leads), then today's schedule/classes, then a quick members/money line, then (if present) the nearest upcoming marketing opportunity.
- Be specific with the numbers you're given. NEVER invent data. If a value is 0 or empty, don't dwell on it.
- If there's genuinely nothing to flag, say it's a quiet day and suggest one useful thing to do.
- Output ONLY the bullet points (each starting with "- "), no preamble or sign-off.`,
      messages: [{ role: "user", content: `Today's live data:\n${JSON.stringify(data, null, 2)}` }],
    }));
    const brief = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return Response.json({ brief });
  } catch {
    return Response.json({ brief: "" });
  }
}
