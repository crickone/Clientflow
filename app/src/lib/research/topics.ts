import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";

/**
 * Content-gap analysis's ONE AI step: `deriveSiteTopics` turns a crawled
 * site's page titles/H1s into a short list of the topics/keywords that site
 * covers — the per-site input `lib/research/gaps.ts`'s pure
 * `computeContentGaps` compares across competitors. Exactly ONE metered
 * `meteredCreate({agentKey:"research"})` call per site per scan (called
 * once per tracked competitor by `lib/research/contentScan.ts`'s
 * `scanCompetitorContent`) — the SAME agentKey/cap `lib/research/summary.ts`
 * already uses, and the SAME fail-soft contract (read summary.ts's own doc
 * comment first): over cap (`AiCapError`), a missing/misconfigured API key,
 * a network error, or unparseable model output all land in the same catch
 * block and resolve to `[]` — NEVER throw, NEVER fabricate. Unlike
 * summary.ts's two helpers (which fall back to a locally-computed STRING),
 * this one's natural "nothing to say" value is the empty array: a site with
 * no derivable topics contributes nothing to the gap computation, which
 * already treats an empty topic list as a normal, valid input (see
 * gaps.test.ts's empty-inputs cases) — there's no equivalent "connect AI for
 * a fuller read" placeholder to compute here since topics genuinely can't be
 * approximated without the model.
 *
 * No fabrication: the prompt hands the model ONLY the page titles/H1s this
 * scan actually crawled and instructs it to name topics reasonably implied
 * by that text alone — never to draw on outside knowledge of the business.
 */

const AGENT_KEY = "research";
const MAX_TOPICS = 15;
// Mirrors crawl.ts's own MAX_PAGES_PER_SITE — a scan can never hand this
// more pages than that anyway; kept as an explicit, independent cap here so
// this file's prompt-size guarantee doesn't silently depend on crawl.ts's
// constant never changing.
const MAX_PAGES_IN_PROMPT = 40;

export type SiteTopicsPageInput = {
  title: string | null;
  h1: string | null;
};

function buildTopicsSystemPrompt(): string {
  return [
    "You read a list of page titles and H1 headings crawled from one business's website and identify the main topics, services, or keywords that site's content covers, for an operator comparing their own site's coverage against competitors'.",
    "House rule: base every topic strictly on the titles/headings supplied in the next message — never invent a topic, service, or keyword that isn't reasonably implied by that text, and never draw on outside knowledge of this or any business.",
    'Reply with ONLY a JSON array of short noun-phrase strings, e.g. ["sports massage","deep tissue massage","sports injury clinic"] — no prose, no markdown code fencing, no object wrapper, just the array.',
  ].join("\n\n");
}

function buildTopicsUserPrompt(siteName: string, pages: SiteTopicsPageInput[]): string {
  const lines = pages
    .slice(0, MAX_PAGES_IN_PROMPT)
    .map((p, i) => `${i + 1}. title: ${p.title ?? "(none)"} | h1: ${p.h1 ?? "(none)"}`);
  return [
    `Website: ${siteName}`,
    "Crawled pages:",
    ...lines,
    "",
    `List up to ${MAX_TOPICS} short, deduped topics/keywords this site's content covers (noun phrases, roughly 1-4 words each). Reply with the JSON array only.`,
  ].join("\n");
}

/**
 * Tolerant JSON-array-of-strings parse: strips a leading/trailing ```
 * (optionally ```json) fence if the model added one despite being asked not
 * to, parses, keeps only non-empty trimmed strings, dedupes
 * case-insensitively (first-seen casing wins), caps at `MAX_TOPICS`. Never
 * throws — malformed JSON, a non-array, or a fully-empty result all -> `[]`.
 * Pure, exported for direct unit testing with plain string literals (no
 * network/AI needed).
 */
export function parseTopicsResponse(raw: string): string[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/**
 * One metered "research" call deriving a site's main topics from its
 * crawled page titles/H1s. No pages -> `[]` with NO model call (nothing to
 * read, mirrors summary.ts's competitorThemes/adAngle "nothing captured
 * yet" short-circuits). Any failure along the way — over cap, AI
 * unavailable, network error, or a reply that doesn't parse — falls back to
 * `[]`, never throws, matching summary.ts's exact fail-soft shape (see this
 * file's own doc comment above).
 *
 * `tenantId` is an explicit parameter (not internally derived via
 * `getCurrentTenant()` the way summary.ts's helpers do) so this module has
 * NO dependency on the ambient tenant/cookie machinery at all — it only
 * ever touches `@/lib/ai/client`/`@/lib/ai/metered` (which are themselves
 * plain, explicit-tenantId, control-plane-only chokepoints) — keeping this
 * file a leaf module the same way places.ts is: importable and testable
 * with zero shimming.
 */
export async function deriveSiteTopics(
  tenantId: number,
  siteName: string,
  pages: SiteTopicsPageInput[],
): Promise<string[]> {
  if (pages.length === 0) return [];

  try {
    const message = await meteredCreate({ tenantId, agentKey: AGENT_KEY }, () => ({
      model: CONTENT_MODEL,
      max_tokens: 500,
      system: buildTopicsSystemPrompt(),
      messages: [{ role: "user", content: buildTopicsUserPrompt(siteName, pages) }],
    }));

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return parseTopicsResponse(text);
  } catch (err) {
    console.error(`[research/topics] deriveSiteTopics(${siteName}) fallback:`, err);
    return [];
  }
}
