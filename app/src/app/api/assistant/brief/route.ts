import Anthropic from "@anthropic-ai/sdk";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getGymDashboard, getNeedsAttention } from "@/lib/dashboard";
import { getSchedulingMode } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A short AI-written "morning brief" for the dashboard, from live data. */
export async function GET() {
  await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return Response.json({ brief: "" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ brief: "" });
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
    const anthropic = new Anthropic();
    const res = await anthropic.messages.create({
      model: "claude-opus-4-8",
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
    return Response.json({ brief });
  } catch {
    return Response.json({ brief: "" });
  }
}
