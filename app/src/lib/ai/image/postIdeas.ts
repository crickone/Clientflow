import "server-only";

import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreateFailSoft } from "@/lib/ai/metered";
import { getBusinessContext } from "@/lib/ai/businessContext";

/**
 * In-depth post ideas across the account's content pillars.
 *
 * The point is DEPTH — an idea a knowledgeable coach would be happy to put
 * their name to, not "5 tips to stay motivated". Each idea therefore carries
 * what it actually teaches and the established principle it rests on, so the
 * operator can judge it before committing.
 *
 * EVIDENCE POLICY (the important part): a language model will happily invent a
 * journal, an author, a year and a precise percentage, and a real gym
 * publishing a fabricated study is a genuine harm — not a cosmetic one. So the
 * model is asked to ground each idea in WELL-ESTABLISHED, checkable consensus
 * (progressive overload, protein intake ranges, resistance training and bone
 * mineral density, VO2max and all-cause mortality) and is explicitly forbidden
 * from citing specific studies, journals, authors, years or exact statistics.
 * Where a hard number would genuinely strengthen the post, it says so in
 * `needsSource` instead of inventing one — turning a fabrication risk into a
 * task the operator can complete with a real citation.
 */

export interface PostIdea {
  /** Which content pillar this serves (from the Marketing Brain). */
  pillar: string;
  /** The angle, as a line the operator could paste straight into the topic box. */
  hook: string;
  /** What the reader actually learns — the substance, in a sentence or two. */
  teaches: string;
  /** The established principle or mechanism it rests on. */
  basis: string;
  /** A claim that would need a real citation before publishing, if any. */
  needsSource?: string;
}

interface IdeasPayload {
  ideas?: Array<Record<string, unknown>>;
}

function coerce(raw: Record<string, unknown>): PostIdea | null {
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");
  const hook = str("hook");
  const teaches = str("teaches");
  if (!hook || !teaches) return null;
  const needsSource = str("needsSource");
  return {
    pillar: str("pillar") || "General",
    hook: hook.slice(0, 200),
    teaches: teaches.slice(0, 400),
    basis: str("basis").slice(0, 300),
    ...(needsSource ? { needsSource: needsSource.slice(0, 240) } : {}),
  };
}

export async function generatePostIdeas(
  tenantId: number,
  count = 6,
): Promise<PostIdea[]> {
  const n = Math.max(1, Math.min(10, count));
  return meteredCreateFailSoft<PostIdea[]>(
    { tenantId, agentKey: "content" },
    () => ({
      model: CONTENT_MODEL,
      max_tokens: 2000,
      system:
        `${getBusinessContext()}\n\n` +
        "You are proposing social post ideas for this business.\n\n" +
        "DEPTH IS THE POINT. Every idea must teach something a knowledgeable coach " +
        "would be happy to put their name to — a mechanism, a common mistake and why " +
        "it's wrong, a misunderstood principle, a decision the reader has to make. " +
        "Reject anything that reads like filler: no 'stay motivated', no '5 quick " +
        "tips', no 'consistency is key', no listicles with nothing inside them.\n\n" +
        "Spread the ideas ACROSS the content pillars in the marketing brain above. " +
        "If pillars are not stated, infer sensible ones from the business and name them.\n\n" +
        "EVIDENCE RULES — these are strict:\n" +
        "- Ground each idea in WELL-ESTABLISHED, textbook-level consensus (e.g. " +
        "progressive overload, protein intake ranges per kg of bodyweight, resistance " +
        "training and bone mineral density, cardiorespiratory fitness and all-cause " +
        "mortality, sleep and recovery, RPE and proximity to failure).\n" +
        "- NEVER cite a specific study, journal, author, institution or year. NEVER " +
        "invent a statistic or percentage. You do not have reliable citation recall, " +
        "and a fabricated study published by a real gym is a serious harm.\n" +
        "- If a specific figure would genuinely strengthen the post, do NOT guess it: " +
        "put a short note in `needsSource` describing the figure to look up.\n" +
        "- State the mechanism plainly instead of leaning on numbers.\n" +
        "- Stay within what a gym may responsibly claim: no medical treatment claims, " +
        "no cures, no guaranteed outcomes.\n\n" +
        `Return ONLY valid JSON: {"ideas":[{"pillar":"…","hook":"…","teaches":"…","basis":"…","needsSource":"…"}]} ` +
        `with exactly ${n} ideas. "hook" is a single line the operator could use as the ` +
        `post topic. "teaches" is what the reader learns. "basis" is the established ` +
        `principle it rests on. Omit "needsSource" when nothing needs looking up.`,
      messages: [
        {
          role: "user",
          content:
            `Give me ${n} in-depth post ideas, spread across the content pillars. ` +
            "Vary the format: some explain a mechanism, some correct a common mistake, " +
            "some help the reader make a decision.",
        },
      ],
    }),
    (text) => {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end <= start) return [];
      const parsed = JSON.parse(text.slice(start, end + 1)) as IdeasPayload;
      if (!Array.isArray(parsed.ideas)) return [];
      return parsed.ideas
        .map((r) => coerce(r as Record<string, unknown>))
        .filter((x): x is PostIdea => x !== null)
        .slice(0, n);
    },
    [],
    "post-ideas",
  );
}
