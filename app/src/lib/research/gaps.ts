/**
 * Content-gap analysis's pure math: turns each tracked site's topic set
 * (yours + every competitor's, both already-derived — see topics.ts) plus a
 * tenant-provided seed keyword list into a ranked list of CONTENT GAPS —
 * topics/keywords your own site doesn't cover yet. Zero imports, zero
 * framework dependency — importable and testable with plain literals, no
 * shimming, mirroring seo.ts's identical "PURE" contract.
 *
 * Two sources feed the gap list, and both are ranked/merged into ONE list:
 *  - "competitors": a topic that appears in at least one NON-self
 *    competitor's derived topic set but not in your own. Ranked by how many
 *    (non-self) competitors have it, descending — the more of them writing
 *    about it, the more it's worth noticing.
 *  - "keyword": a tenant-provided seed keyword (your own target keyword
 *    list — see keywords.ts) that ISN'T in your own topic set either,
 *    whether or not any competitor happens to cover it too.
 * A topic that qualifies from BOTH sources (a seed keyword that's also a
 * competitor topic) is reported ONCE, tagged `source:"competitors"` — see
 * `computeContentGaps`'s own doc comment for the exact merge rule.
 *
 * Topic comparison is intentionally simple (`normaliseTopic`): lowercase,
 * trim, collapse internal whitespace, and drop one trailing "s" (a loose,
 * non-linguistic singularise — "memberships"/"membership" match,
 * "classes"/"class" doesn't perfectly, "glass"/"glas" is deliberately NOT
 * over-corrected by excluding words ending "ss"). This is a documented
 * simplification, not a real stemmer — good enough for "is this roughly the
 * same topic", which is all a content-gap read needs.
 */

export type ContentGap = {
  topic: string;
  /** How many NON-self tracked competitors have this topic (or, for a keyword-sourced gap, how many happen to cover it — may be 0). */
  competitorCount: number;
  /** The total number of non-self tracked competitors this scan considered — the denominator for a "covered by X of Y competitors" badge. */
  totalCompetitors: number;
  /** Always `false` in practice — a gap is, by definition, something you're NOT covering yet (see computeContentGaps: a topic you already cover is filtered out before it ever becomes a ContentGap). Kept as an explicit field rather than assumed so the type is self-describing wherever it's rendered. */
  coveredByYou: boolean;
  source: "competitors" | "keyword";
  /** One competitor known to cover this topic — omitted for a keyword-sourced gap no tracked competitor happens to cover. */
  exampleCompetitor?: string;
};

export type GapCompetitorInput = {
  name: string;
  isSelf: boolean;
  topics: string[];
};

export type ComputeContentGapsInput = {
  competitors: GapCompetitorInput[];
  seedKeywords: string[];
};

const MAX_GAPS = 40;

/**
 * Loose topic normalisation for comparison purposes only (never used for
 * display — `ContentGap.topic`/`exampleCompetitor` always keep the
 * original, human-written casing/spacing). See this file's own doc comment
 * for the exact rule. Pure, exported for direct unit testing.
 */
export function normaliseTopic(topic: string): string {
  const collapsed = topic.toLowerCase().trim().replace(/\s+/g, " ");
  return collapsed.length > 3 && collapsed.endsWith("s") && !collapsed.endsWith("ss")
    ? collapsed.slice(0, -1)
    : collapsed;
}

type TopicAgg = { displayTopic: string; count: number; exampleCompetitor: string };

/**
 * Pure. Own topics = the (at most one) `isSelf` competitor's topics.
 * Competitor-sourced gaps: every topic any non-self competitor has, minus
 * whatever you already cover, ranked by how many non-self competitors have
 * it (descending; a tie keeps alphabetical order for a stable, deterministic
 * result). Keyword-sourced gaps: every seed keyword you don't already
 * cover, appended — EXCEPT one that normalises to a topic already added as
 * competitor-sourced, which is skipped entirely (that topic is already in
 * the list once, correctly tagged `source:"competitors"` — "source:
 * 'competitors' wins" per the brief). The combined list is then re-sorted
 * by `competitorCount` descending (stable — see the merge-tie-break note
 * below) and capped at `MAX_GAPS` (~40). Empty competitors + empty
 * seedKeywords -> `[]`.
 */
export function computeContentGaps(input: ComputeContentGapsInput): ContentGap[] {
  const selfTopicsNormalised = new Set(
    input.competitors.filter((c) => c.isSelf).flatMap((c) => c.topics.map(normaliseTopic).filter(Boolean)),
  );
  const others = input.competitors.filter((c) => !c.isSelf);

  const byTopic = new Map<string, TopicAgg>();
  for (const comp of others) {
    const seenForThisCompetitor = new Set<string>(); // a competitor's own duplicate/near-duplicate topics count once
    for (const rawTopic of comp.topics) {
      const key = normaliseTopic(rawTopic);
      if (!key || seenForThisCompetitor.has(key)) continue;
      seenForThisCompetitor.add(key);
      const existing = byTopic.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byTopic.set(key, { displayTopic: rawTopic.trim(), count: 1, exampleCompetitor: comp.name });
      }
    }
  }

  const gaps: ContentGap[] = [];
  const includedKeys = new Set<string>();

  const competitorSourced = [...byTopic.entries()]
    .filter(([key]) => !selfTopicsNormalised.has(key))
    .sort((a, b) => b[1].count - a[1].count || a[1].displayTopic.localeCompare(b[1].displayTopic));

  for (const [key, agg] of competitorSourced) {
    gaps.push({
      topic: agg.displayTopic,
      competitorCount: agg.count,
      totalCompetitors: others.length,
      coveredByYou: false,
      source: "competitors",
      exampleCompetitor: agg.exampleCompetitor,
    });
    includedKeys.add(key);
  }

  for (const rawKeyword of input.seedKeywords) {
    const key = normaliseTopic(rawKeyword);
    if (!key) continue;
    if (selfTopicsNormalised.has(key)) continue; // already covered by you — not a gap
    if (includedKeys.has(key)) continue; // merges into the competitors-sourced row already added above
    includedKeys.add(key);
    const matchingCompetitors = others.filter((c) => c.topics.some((t) => normaliseTopic(t) === key));
    gaps.push({
      topic: rawKeyword.trim(),
      competitorCount: matchingCompetitors.length,
      totalCompetitors: others.length,
      coveredByYou: false,
      source: "keyword",
      exampleCompetitor: matchingCompetitors[0]?.name,
    });
  }

  // Final rank across BOTH sources by competitorCount desc. Array#sort is a
  // STABLE sort (guaranteed since ES2019) — a tie keeps insertion order,
  // which is competitor-sourced rows (pushed first, already sorted amongst
  // themselves) ahead of keyword-sourced ones, so "source:'competitors'
  // wins" holds for ranking ties too, not just the dedupe/merge above.
  gaps.sort((a, b) => b.competitorCount - a.competitorCount);

  return gaps.slice(0, MAX_GAPS);
}
