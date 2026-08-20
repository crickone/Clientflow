// src/lib/marketing/campaignRadar.ts
// AI-framed campaign suggestions for the nearest upcoming seasonal-calendar
// dates ("the radar"). Memoised once per tenant per day so the dashboard/
// calendar can render this on every load without re-spending. Falls back to
// each date's built-in catalog `angle` (no AI call cost) if the model call is
// capped, errors, or returns unparseable output — see getCampaignRadar.
import "server-only";
import { upcomingDates, type CalDate } from "./seasonalCalendar";
import { meteredCreate } from "@/lib/ai/metered";
import { CONTENT_MODEL } from "@/lib/ai/client";

export interface RadarSuggestion {
  dateId: string;
  dateName: string;
  dateIso: string;
  daysAway: number;
  suggestionName: string;
  suggestionHook: string;
}

/** tenantId:yyyymmdd → that day's framed radar. Only ever populated with a REAL AI framing (see getCampaignRadar) so a capped/errored call retries on the next request instead of sticking a stale fallback for the rest of the day. */
const memo = new Map<string, RadarSuggestion[]>();
const yyyymmdd = (isoDate: string) => isoDate.replaceAll("-", "");

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

/**
 * Pure merge: AI framing (when present) wins per-date, otherwise falls back
 * to that date's catalog `angle`. No AI/DB/I-O — exported so tests can drive
 * it directly without a metered call.
 */
export function buildRadarFromFraming(
  upcoming: CalDate[],
  todayIso: string,
  framed: Record<string, { name: string; hook: string }> | null,
): RadarSuggestion[] {
  return upcoming.map((d) => {
    const f = framed?.[d.id];
    return {
      dateId: d.id,
      dateName: d.name,
      dateIso: d.iso,
      daysAway: daysBetween(todayIso, d.iso),
      suggestionName: f?.name?.trim() || d.name,
      suggestionHook: f?.hook?.trim() || d.angle,
    };
  });
}

/**
 * The nearest ≤5 upcoming catalog dates, AI-framed into a short campaign
 * name + hook each. Metered under agentKey "marketing" and memoised per
 * `tenantId:yyyymmdd` so a tenant is charged at most once per day regardless
 * of how many times the radar is rendered. Any failure — cap (`AiCapError`
 * thrown by `meteredCreate`'s internal `assertAiAllowed`), network error, or
 * unparseable model output — falls back to each date's static catalog
 * `angle` and is deliberately NOT memoised, so the next call retries the AI
 * framing instead of being stuck with the fallback for the rest of the day.
 */
export async function getCampaignRadar(
  tenantId: number,
  opts?: { todayIso?: string },
): Promise<RadarSuggestion[]> {
  const todayIso = opts?.todayIso ?? new Date().toISOString().slice(0, 10);
  const key = `${tenantId}:${yyyymmdd(todayIso)}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const upcoming = upcomingDates(todayIso, 60).slice(0, 5);
  if (upcoming.length === 0) return [];

  let framed: Record<string, { name: string; hook: string }> | null = null;
  try {
    // Dynamic import (not a static top-level one) is deliberate: businessContext.ts
    // pulls in @/lib/db -> db/tenant.ts, which wraps its tenant resolvers in React's
    // cache(). A STATIC import here would make this file's compiled output eagerly
    // require() that whole chain the moment anything imports campaignRadar.ts for
    // buildRadarFromFraming alone (incl. this module's own unit test) -- outside a
    // real Next.js server, requiring "react" under the react-server export condition
    // throws (react/react.shared-subset.js refuses to load standalone). Deferring to
    // here means it only resolves when getCampaignRadar actually runs, which in
    // production is always inside a real request. No behavioural change either way.
    const { getBusinessContext } = await import("@/lib/ai/businessContext");
    const ctx = getBusinessContext();
    const list = upcoming
      .map((d) => `- ${d.id} · ${d.name} (${d.iso}) — angle: ${d.angle}`)
      .join("\n");
    const res = await meteredCreate({ tenantId, agentKey: "marketing" }, () => ({
      model: CONTENT_MODEL,
      max_tokens: 500,
      system:
        "You are a marketing strategist for this business. Using ONLY the business context, " +
        "suggest a short seasonal campaign for each upcoming date. Obey every rule in the context " +
        "(no prices, no guarantees, no invented results). Reply with STRICT JSON only: " +
        '{"<dateId>":{"name":"<=6 words","hook":"one sentence"}}. No prose.',
      messages: [{ role: "user", content: `BUSINESS CONTEXT:\n${ctx}\n\nUPCOMING DATES:\n${list}` }],
    }));
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      framed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch {
    framed = null; // capped / errored / unparseable → static fallback, don't memoise
  }

  const result = buildRadarFromFraming(upcoming, todayIso, framed);
  if (framed) memo.set(key, result); // only cache real framing
  return result;
}
