import { requireUser, getCurrentMembership } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getGymDashboard, getNeedsAttention } from "@/lib/dashboard";
import { getSchedulingMode } from "@/lib/settings";
import { isGmailConnected, syncGmailInbox } from "@/lib/gmail";
import { getAnthropic, MODELS } from "@/lib/ai/client";
import { assertUnderCap, recordUsage, AiCapError } from "@/lib/ai/usage";

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
  // capped tenant must fail fast and cleanly rather than paying for all that
  // work only to then also fail the model call. DailyBrief.tsx renders
  // `data.brief` verbatim as the widget's content regardless of HTTP status
  // (it never checks res.ok), so returning AiCapError's own friendly message
  // here IS the clean, non-500 surface — no frontend change needed.
  try {
    assertUnderCap(tenantId);
  } catch (e) {
    if (e instanceof AiCapError) {
      return Response.json({ brief: e.message }, { status: 429 });
    }
    throw e;
  }

  // Pull in any new mail before summarising so getNeedsAttention() reflects
  // the current inbox, not whatever was last synced. This route runs
  // synchronously inside a single request (cookies() is live throughout), so
  // the ambient `db` proxy that syncGmailInbox writes through already
  // resolves to this same tenant via the session cookie — no runWithTenant
  // needed. Best-effort + bounded: never let a Gmail hiccup break the brief,
  // and no-op cleanly when Gmail isn't connected.
  try {
    if (isGmailConnected(membership.tenant.id)) {
      await syncGmailInbox(membership.tenant.id, { days: 7, max: 15 });
    }
  } catch (err) {
    console.error("[assistant/brief] gmail sync failed:", err);
  }

  const business = getBusinessProfile().businessName;
  const mode = getSchedulingMode();
  const gym = getGymDashboard();
  const attention = getNeedsAttention();

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
  };

  try {
    const anthropic = getAnthropic();
    const res = await anthropic.messages.create({
      model: MODELS.opus,
      max_tokens: 500,
      system: `You write a short, friendly MORNING BRIEF for the owner of ${business}, a ${mode === "timetable" ? "gym/studio" : "clinic"}, shown at the top of their dashboard.
- 3 to 5 short bullet points, Irish English.
- Lead with anything that needs ACTION (unanswered messages, new leads), then today's schedule/classes, then a quick members/money line.
- Be specific with the numbers you're given. NEVER invent data. If a value is 0 or empty, don't dwell on it.
- If there's genuinely nothing to flag, say it's a quiet day and suggest one useful thing to do.
- Output ONLY the bullet points (each starting with "- "), no preamble or sign-off.`,
      messages: [{ role: "user", content: `Today's live data:\n${JSON.stringify(data, null, 2)}` }],
    });
    const brief = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    recordUsage(tenantId, "brief", MODELS.opus, {
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheCreateTokens: res.usage.cache_creation_input_tokens ?? 0,
    });
    return Response.json({ brief });
  } catch {
    return Response.json({ brief: "" });
  }
}
