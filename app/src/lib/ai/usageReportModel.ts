/**
 * The account's AI usage page, as pure data: plain names for each feature
 * that spends AI, and the grouping of individual AI calls into the pieces of
 * work they were for. lib/ai/usageReport.ts reads the rows; this shapes them.
 */

/** ai_usage.agent_key -> what the account knows it as. */
const FEATURES: Record<string, string> = {
  orchestrator: "Adonis",
  sales: "Adonis",
  marketing: "Adonis",
  operations: "Adonis",
  concierge: "Adonis",
  finance: "Adonis",
  assistant: "Adonis",
  carousel: "Post designs",
  content: "Post ideas",
  ads: "Ads",
  video: "Video",
  blog: "Blog posts",
  campaign_draft: "Email drafts",
  brief: "Daily brief",
  research: "Market research",
  brand: "Brand interview",
  triage: "Inbox sorting",
  "jev-triage": "Inbox sorting (Jev trial)",
  inbox: "Inbox replies",
  followup: "Follow-up drafts",
  media: "Image descriptions",
  transcribe: "Voice notes",
  meals: "Meal logging",
};

export function featureOf(agentKey: string): string {
  return FEATURES[agentKey] ?? agentKey.charAt(0).toUpperCase() + agentKey.slice(1).replace(/_/g, " ");
}

export type UsageRow = { at: number; agentKey: string; cents: number; ref: string | null; label: string | null };

export type FeatureTotal = { feature: string; cents: number; calls: number };

export type ActivityGroup = {
  key: string;
  /** What the work was: a campaign, an Adonis chat, a post, or untagged calls of one feature on one day. */
  kind: "campaign" | "chat" | "post" | "other";
  title: string;
  cents: number;
  calls: number;
  firstAt: number;
  lastAt: number;
  /** Where the money went inside it, by feature, biggest first. */
  parts: FeatureTotal[];
};

function dayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function kindOf(ref: string): ActivityGroup["kind"] {
  if (ref.startsWith("campaign:")) return "campaign";
  if (ref.startsWith("chat:")) return "chat";
  if (ref.startsWith("post:")) return "post";
  return "other";
}

function addPart(parts: FeatureTotal[], feature: string, cents: number) {
  const p = parts.find((x) => x.feature === feature);
  if (p) {
    p.cents += cents;
    p.calls++;
  } else parts.push({ feature, cents, calls: 1 });
}

/** Spend by feature, biggest first (several agent keys can share one feature name). */
export function byFeature(rows: UsageRow[]): FeatureTotal[] {
  const out: FeatureTotal[] = [];
  for (const r of rows) addPart(out, featureOf(r.agentKey), r.cents);
  return out.sort((a, b) => b.cents - a.cents);
}

/**
 * One line per piece of work, newest first. Calls tagged with a ref (since
 * the tagging began) group under it, named by the most recent label; older
 * untagged calls group by feature and day.
 */
export function groupActivity(rows: UsageRow[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup & { labelAt: number }>();
  for (const r of rows) {
    const feature = featureOf(r.agentKey);
    const key = r.ref ?? `${feature}|${dayKey(r.at)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        kind: r.ref ? kindOf(r.ref) : "other",
        title: r.ref ? r.label ?? r.ref : feature,
        cents: 0,
        calls: 0,
        firstAt: r.at,
        lastAt: r.at,
        parts: [],
        labelAt: r.label ? r.at : 0,
      };
      groups.set(key, g);
    }
    g.cents += r.cents;
    g.calls++;
    g.firstAt = Math.min(g.firstAt, r.at);
    g.lastAt = Math.max(g.lastAt, r.at);
    if (r.ref && r.label && r.at >= g.labelAt) {
      g.title = r.label;
      g.labelAt = r.at;
    }
    addPart(g.parts, feature, r.cents);
  }
  return [...groups.values()]
    .map(({ labelAt: _labelAt, ...g }) => ({ ...g, parts: g.parts.sort((a, b) => b.cents - a.cents) }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** Euro amount from (fractional) cents: "€2.43", and "under €0.01" for the tiny ones. */
export function formatSpend(cents: number): string {
  if (cents > 0 && cents < 0.5) return "under €0.01";
  return `€${(Math.round(cents) / 100).toFixed(2)}`;
}
