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
 * WHY THE SAME IDEAS KEPT COMING BACK. The first version sent a byte-identical
 * prompt on every run: same system text, same one-line user message, no memory
 * of anything it had already proposed. A model answering the same question
 * twice gives near enough the same answer twice — temperature moves the wording,
 * not the idea — so "New ideas" reliably returned the same six angles in a
 * different order, and the ideas library's own comment ("the generator does
 * repeat itself across runs") was papering over it. Two fixes, deliberately
 * belt-and-braces:
 *
 *   1. TELL IT WHAT IT HAS ALREADY SAID. `avoid` carries the hooks already
 *      proposed, saved or used for this tenant (@/lib/content-studio/
 *      ideaLibrary), and the prompt forbids repeating them OR rephrasing them.
 *   2. ASK A DIFFERENT QUESTION EACH TIME. Every run draws a fresh set of
 *      ANGLES (`pickAngles`) and assigns one per idea, so the request itself
 *      differs structurally run to run rather than only in sampling noise.
 *
 * And because a prompt instruction is a request, not a guarantee, the reply is
 * filtered: `dedupeIdeas` drops anything that matches the avoid list or another
 * idea in the same batch, on normalised text AND on content-word overlap (the
 * repeats that annoy an operator are usually a rephrasing, not a copy). The
 * generator asks for a few more than it needs so the filter has slack.
 *
 * EVIDENCE POLICY (the other important part): a language model will happily
 * invent a journal, an author, a year and a precise percentage, and a real gym
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

/**
 * Pull idea objects out of the reply, tolerating a TRUNCATED response.
 *
 * Asking for several in-depth ideas produces a lot of text, and if the model
 * runs out of tokens mid-array the whole JSON.parse fails — throwing away four
 * perfectly good ideas because the fifth was cut in half. So: try the clean
 * parse first, and on failure walk the string collecting balanced {...} blocks
 * and parse them individually, keeping whatever survived.
 */
export function extractIdeaObjects(text: string): Array<Record<string, unknown>> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as IdeasPayload;
      if (Array.isArray(parsed.ideas)) return parsed.ideas;
    } catch {
      // fall through to the salvage pass
    }
  }

  const out: Array<Record<string, unknown>> = [];
  // Skip the outer wrapper so its opening brace isn't treated as an object.
  const from = text.indexOf("[");
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;
  for (let i = from === -1 ? 0 : from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)) as Record<string, unknown>);
        } catch {
          // skip a malformed block rather than losing the rest
        }
        objStart = -1;
      }
    }
  }
  return out;
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

/**
 * The angle catalogue — the STRUCTURE of a post, not its subject.
 *
 * Variety in social content comes from asking a different question, not from
 * a different topic: "explain the mechanism behind X" and "who is X not for"
 * land in genuinely different places even when X is the same service. The
 * list is deliberately venue-neutral so it reads sensibly for a clinic and a
 * gym alike, and long enough that two consecutive runs of six rarely draw the
 * same set.
 */
export const IDEA_ANGLES: readonly string[] = [
  "Explain a mechanism the reader has heard named but could not actually explain.",
  "Correct a common mistake, and say precisely why it is wrong rather than just that it is.",
  "Help the reader choose between two reasonable options, and say what should decide it.",
  "Answer a question clients genuinely ask in the room, in the words they ask it.",
  "Take a widely repeated claim and separate the part that holds up from the part that does not.",
  "Walk through what a first visit or first session actually involves, and why it is structured that way.",
  "Set expectations over a realistic timeline: what changes, when, and what does not change at all.",
  "Name a real trade-off (time, cost, effort, recovery) and give the reader a way to weigh it.",
  "Say who a service is NOT for, and what would suit that person better.",
  "Unpack a number or measure the reader keeps seeing and does not know how to read.",
  "Explain why something that feels like it is working may not be — or the reverse.",
  "Take one small, specific detail of practice and show what it reveals about the whole approach.",
  "Contrast what a beginner should do with what someone experienced should do differently.",
  "Explain the reasoning behind a rule of thumb, so the reader knows when to break it.",
];

/**
 * Draw `n` distinct angles at random.
 *
 * `rand` is injectable purely so the tests can pin the selection; production
 * passes nothing and gets Math.random. When `n` exceeds the catalogue the whole
 * shuffled catalogue comes back rather than repeating entries — asking for the
 * same angle twice would defeat the point.
 */
export function pickAngles(n: number, rand: () => number = Math.random): string[] {
  const pool = [...IDEA_ANGLES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

/** Words carrying no signal about what an idea is ABOUT — ignored when comparing two hooks. */
const STOPWORDS = new Set(
  ("a an and are as at be been but by can could do does for from has have how i if in into is it its of on or " +
    "should so than that the their them then there these they this to too vs versus was we what when where which " +
    "while who why will with without you your").split(" "),
);

/** Lowercase, strip punctuation, collapse whitespace — the cheap "is this literally the same line" key. */
export function normaliseHook(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(s: string): Set<string> {
  return new Set(normaliseHook(s).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

/**
 * Are two hooks the same idea wearing different words?
 *
 * Jaccard overlap of content words, because the repeat an operator notices is
 * almost never a verbatim copy — it is "Why protein timing matters less than
 * total intake" coming back as "Protein timing vs total daily intake: what
 * actually matters". Those share five content words out of eight; a threshold
 * of 0.55 catches that while leaving two genuinely different protein ideas
 * alone. The three-shared-word floor stops very short hooks ("Sleep and
 * recovery" / "Recovery and sleep debt") tripping the ratio on noise.
 */
export function similarHooks(a: string, b: string): boolean {
  const na = normaliseHook(a);
  const nb = normaliseHook(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size === 0 || wb.size === 0) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  if (shared < 3) return false;
  return shared / (wa.size + wb.size - shared) >= 0.55;
}

/**
 * Keep at most `n` ideas that are new — neither a repeat of something in
 * `avoid` nor of an earlier idea in the same batch.
 *
 * This is the guarantee behind the prompt's request. The prompt asks the model
 * not to repeat itself; this makes sure it didn't. Returning FEWER than `n` is
 * the intended outcome when the model has genuinely run out of new angles: five
 * new ideas is a better answer than six of which two were seen last week.
 */
export function dedupeIdeas(ideas: PostIdea[], avoid: Iterable<string>, n: number): PostIdea[] {
  const seen = [...avoid].map((h) => h.trim()).filter(Boolean);
  const out: PostIdea[] = [];
  for (const idea of ideas) {
    if (out.length >= n) break;
    if (seen.some((h) => similarHooks(h, idea.hook))) continue;
    out.push(idea);
    seen.push(idea.hook);
  }
  return out;
}

/** How many extra ideas to ask for so the dedupe filter has something to spend. */
const OVERDRAW = 3;

export interface IdeaOptions {
  /**
   * Hooks this tenant has already been shown, saved or used. The prompt lists
   * them as off-limits and the reply is filtered against them — see the file
   * header for why both.
   */
  avoid?: readonly string[];
}

export async function generatePostIdeas(
  tenantId: number,
  count = 6,
  opts: IdeaOptions = {},
): Promise<PostIdea[]> {
  const n = Math.max(1, Math.min(10, count));
  // Newest first, and capped: the whole history would crowd the prompt and the
  // oldest hooks are the ones least likely to feel like a repeat today.
  const avoid = (opts.avoid ?? []).map((h) => h.trim()).filter(Boolean).slice(0, 60);
  const ask = Math.min(n + OVERDRAW, 12);
  const angles = pickAngles(ask);

  return meteredCreateFailSoft<PostIdea[]>(
    { tenantId, agentKey: "content" },
    () => ({
      model: CONTENT_MODEL,
      // Several in-depth ideas is a lot of text; 2000 truncated the JSON
      // mid-array and lost every idea. Room to finish the OVERDRAWN batch,
      // plus the salvage pass. A ceiling, not a charge — a typical reply is a
      // fraction of this and is metered on what it actually used.
      max_tokens: 8000,
      system:
        `${getBusinessContext()}\n\n` +
        "You are proposing social post ideas for this business.\n\n" +
        "DEPTH IS THE POINT. Every idea must teach something a knowledgeable coach " +
        "would be happy to put their name to — a mechanism, a common mistake and why " +
        "it's wrong, a misunderstood principle, a decision the reader has to make. " +
        "Reject anything that reads like filler: no 'stay motivated', no '5 quick " +
        "tips', no 'consistency is key', no listicles with nothing inside them.\n\n" +
        "Spread the ideas ACROSS the content pillars in the marketing brain above. " +
        "If pillars are not stated, infer sensible ones from the business and name them. " +
        "No two ideas in this batch may sit in the same pillar unless there are fewer " +
        "pillars than ideas.\n\n" +
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
        `with exactly ${ask} ideas. "hook" is a single line the operator could use as the ` +
        `post topic. "teaches" is what the reader learns. "basis" is the established ` +
        `principle it rests on. Omit "needsSource" when nothing needs looking up.`,
      messages: [
        {
          role: "user",
          content:
            `Give me ${ask} in-depth post ideas, spread across the content pillars.\n\n` +
            "Write one idea for each of these angles, in order. The angle sets the SHAPE " +
            "of the post; you choose the subject:\n" +
            angles.map((a, i) => `${i + 1}. ${a}`).join("\n") +
            (avoid.length
              ? "\n\nALREADY PROPOSED — do not suggest any of these again, and do not " +
                "suggest a rephrasing, a narrower slice or a mirror image of one. If an " +
                "angle only leads you back to something on this list, take the angle " +
                "somewhere genuinely new instead:\n" +
                avoid.map((h) => `- ${h}`).join("\n")
              : ""),
        },
      ],
    }),
    (text) =>
      dedupeIdeas(
        extractIdeaObjects(text)
          .map((r) => coerce(r))
          .filter((x): x is PostIdea => x !== null),
        avoid,
        n,
      ),
    [],
    "post-ideas",
  );
}
