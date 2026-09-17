/**
 * Numbers on a slide, checked against the numbers the business actually has.
 * ZERO RUNTIME IMPORTS (see lib/design/parse.ts).
 *
 * WHY A CHECK AND NOT A RULE. "NEVER invent a price, a session length, an
 * opening time, a statistic or a testimonial. Take durations and prices ONLY
 * from the connected service list" has been in the prompt all along, and the
 * list itself carries the real numbers -- "Infrared Therapy (15 minutes,
 * €65)". A carousel still came back saying fifteen minutes on one slide and
 * TWELVE on another, contradicting itself about the same session inside the
 * same post. The instruction was right there and the model drifted anyway.
 *
 * The renderer already says this better than the prompt does: "a constraint
 * the machine can enforce should never be left to wording". A duration is a
 * number, the real durations are a list of numbers, and comparing two lists of
 * numbers is not a judgement call. So it stops being advice and becomes a
 * violation, which the repair pass already knows how to act on.
 *
 * DELIBERATELY NARROW. It only flags a number that is stated as a DURATION or
 * a PRICE and does not match one the business has configured. It says nothing
 * about statistics, dates, percentages or any other number, because there is
 * nothing to check those against and a checker that guesses is worse than one
 * that is quiet.
 */

/** Written-out numbers a copywriter actually uses for a session length. */
const WORD_NUMBERS: Record<string, number> = {
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  "twenty-five": 25, thirty: 30, "thirty-five": 35, forty: 40,
  "forty-five": 45, fifty: 50, sixty: 60, ninety: 90,
};

const WORD_ALTERNATION = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length) // "twenty-five" before "twenty"
  .join("|");

/**
 * Every duration in minutes the text states, digits or words.
 *
 * Matches "15 minutes", "15-minute", "fifteen minutes" and "fifteen-minute".
 * An hour is counted too -- "sixty minutes" and "an hour" are the same claim
 * about the same session, and a set that says both is not contradicting
 * itself.
 */
export function statedDurations(text: string): number[] {
  const out: number[] = [];
  const digits = /(\d{1,3})\s*[-\s]?\s*(?:minute|minutes|min\b|mins\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = digits.exec(text)) !== null) out.push(Number(m[1]));

  const words = new RegExp(
    `\\b(${WORD_ALTERNATION})\\s*[-\\s]?\\s*(?:minute|minutes|min\\b|mins\\b)`,
    "gi",
  );
  while ((m = words.exec(text)) !== null) {
    const n = WORD_NUMBERS[m[1].toLowerCase()];
    if (n !== undefined) out.push(n);
  }

  const hours = /\b(?:an|one|1)\s+hour\b/gi;
  while ((m = hours.exec(text)) !== null) out.push(60);
  return out;
}

/** Every euro price the text states. */
export function statedPrices(text: string): number[] {
  const out: number[] = [];
  const re = /(?:€|EUR\s*)(\d{1,5})(?:\.(\d{2}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[2] ? Number(`${m[1]}.${m[2]}`) : Number(m[1]));
  }
  return out;
}

export interface ConfiguredFacts {
  /** Durations in minutes, from the tenant's own services. */
  durations: number[];
  /** Prices in euro, from the tenant's own services. */
  prices: number[];
}

/**
 * The numbers this text claims that the business does not have.
 *
 * Returns sentences for the repair pass, not booleans -- it is read by a model
 * that has to fix the slide, so it names the number, says where the real ones
 * are, and gives the alternative (drop it) that is always available.
 *
 * With nothing configured it reports NOTHING. An account that has not set its
 * services up has no list to check against, and inventing violations for it
 * would send every generation round the repair loop for no reason.
 */
export function unsupportedNumbers(
  text: string,
  facts: ConfiguredFacts,
): string[] {
  const out: string[] = [];

  if (facts.durations.length > 0) {
    const bad = [...new Set(statedDurations(text))].filter(
      (n) => !facts.durations.includes(n),
    );
    for (const n of bad) {
      out.push(
        `This says a session is ${n} minutes. No service is ${n} minutes long -- the real ones are ${facts.durations.join(", ")}. Use the right number for the therapy you are describing, or write the sentence without a length.`,
      );
    }
  }

  if (facts.prices.length > 0) {
    const bad = [...new Set(statedPrices(text))].filter(
      (n) => !facts.prices.includes(n),
    );
    for (const n of bad) {
      out.push(
        `This states a price of €${n}. No service costs €${n} -- the real ones are ${facts.prices.map((p) => `€${p}`).join(", ")}. Use the right price, or write the sentence without one.`,
      );
    }
  }

  return out;
}
