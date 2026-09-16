/**
 * What an operator's sentence about a slide is actually ASKING FOR.
 * ZERO RUNTIME IMPORTS — the metered call that uses this lives in the
 * interpret route; everything here is pure, so the classification can be
 * tested without a network.
 *
 * WHY THIS EXISTS. The redesign dialog grew to three buttons: rewrite the
 * layout, make a different photograph, change the photograph that is there.
 * Three real operations -- but the operator has ALREADY said which one they
 * want, in the sentence they typed. Making them also pick the button is
 * asking them to classify their own request into a taxonomy they have no
 * reason to know, and the cost of getting it wrong is silent: "replace the guy
 * in the photo with a woman" sent to the layout model returns a re-laid-out
 * slide with the same man in it and reports success.
 *
 * So the sentence picks the route. One button, and this decides.
 *
 * THE FALLBACK IS NOT AN AFTERTHOUGHT. A classifier that cannot be reached
 * must not strand the operator, so `guessIntent` answers from the words alone
 * and the route falls back to it. It is deliberately worse than the model and
 * deliberately never worse than nothing.
 */

/** The three things the dialog can do. */
export type SlideIntent =
  /** Rewrite the slide's markup: layout, type, colour, composition. */
  | "design"
  /** Make a DIFFERENT photograph from a description. */
  | "newPhoto"
  /** Change the photograph this slot already has. */
  | "editPhoto";

/**
 * What is actually POSSIBLE for this slide right now. A route the slide
 * cannot take is not a route, however clearly the sentence asks for it --
 * there is nothing to edit on a slide holding no photograph, and nothing to
 * generate without a provider configured.
 */
export interface IntentContext {
  /** The markup has somewhere to put a photograph. */
  hasPhotoSlot: boolean;
  /** The targeted slot is holding one. */
  hasPhotoInSlot: boolean;
  /** Generation is configured (fal). */
  canGenerate: boolean;
  /** Editing is configured (OpenAI). */
  canEdit: boolean;
}

/**
 * The route, reduced to one the slide can actually take.
 *
 * Editing falls back to generating rather than to redesigning: both are
 * "the operator wants a different picture", and answering a picture request
 * with a layout change is the exact failure this module exists to stop.
 */
export function clampIntent(intent: SlideIntent, ctx: IntentContext): SlideIntent {
  if (intent === "editPhoto" && (!ctx.canEdit || !ctx.hasPhotoInSlot)) {
    return ctx.canGenerate ? "newPhoto" : "design";
  }
  if (intent === "newPhoto" && !ctx.canGenerate) return "design";
  return intent;
}

/**
 * The classifier's instructions.
 *
 * Deliberately narrow: three labels, one word out, and the examples are the
 * distinctions that actually get confused -- "change the photo" against
 * "change the heading", and a new picture against an edit of this one.
 */
export function intentPrompt(note: string, ctx: IntentContext): string {
  return [
    `An operator is looking at one slide of a social post and typed a request. Decide which ONE of these it is, and reply with that word alone.`,
    ``,
    `design — they want the SLIDE changed: layout, size, colour, wording, composition, what dominates. Also anything you are unsure about.`,
    `newPhoto — they want a DIFFERENT photograph: a new subject, a different shot, another scene.`,
    `editPhoto — they want THIS photograph altered but kept: change or remove something in it, change the person or an object in the picture, tidy the background.`,
    ``,
    `Examples:`,
    `"make the headline bigger" -> design`,
    `"try it on the dark ground" -> design`,
    `"the text is too cramped" -> design`,
    `"use a photo of the infrared bed instead" -> newPhoto`,
    `"different picture please" -> newPhoto`,
    `"replace the guy in the photo with a woman" -> editPhoto`,
    `"remove the clutter behind him" -> editPhoto`,
    `"make the person in the photo smile" -> editPhoto`,
    ``,
    `This slide ${ctx.hasPhotoSlot ? "has a place for a photograph" : "has no photograph in its design"}, and that place ${ctx.hasPhotoInSlot ? "is holding one" : "is empty"}.`,
    ``,
    `The request: ${note.trim()}`,
    ``,
    `Reply with exactly one word: design, newPhoto, or editPhoto.`,
  ].join("\n");
}

const LABELS: SlideIntent[] = ["design", "newPhoto", "editPhoto"];

/**
 * The model's word, turned into a route.
 *
 * Anything unrecognised becomes "design": it is the cheapest of the three,
 * the only one that changes nothing outside the slide, and the one whose
 * result an operator can see and reject immediately.
 */
export function parseIntent(text: string, ctx: IntentContext): SlideIntent {
  const word = text.trim().toLowerCase().replace(/[^a-z]/g, "");
  const hit = LABELS.find((l) => l.toLowerCase() === word);
  return clampIntent(hit ?? "design", ctx);
}

/** Words that mean the PICTURE, not the slide. */
const PHOTO_WORDS = /\b(photo|photograph|picture|image|shot|pic)\b/i;
/** Words that mean "a different one" rather than "change this one". */
const FRESH_WORDS = /\b(different|another|new|instead|other|fresh|replace it with|swap)\b/i;
/**
 * The route from the words alone, for when the classifier cannot be reached.
 *
 * Crude on purpose. It only tries to answer the one question that matters --
 * is this about the picture or about the slide -- and leans to "design"
 * whenever it cannot tell, because a redesign is cheap, visible and instantly
 * rejectable while a photo call costs real money.
 */
export function guessIntent(note: string, ctx: IntentContext): SlideIntent {
  const text = note.trim();
  if (!text) return "design";
  if (!PHOTO_WORDS.test(text)) return "design";
  // It IS about the picture, so the only question left is whether they want a
  // DIFFERENT one or this one changed. Asking for something fresh is the
  // narrow case and the easy one to name; everything else -- "remove the sign
  // from the photo", "make the person in the photo smile", "the photo is too
  // dark" -- is an alteration of the picture that is there.
  //
  // A list of edit verbs used to sit here and earned nothing: it could only
  // ever agree with this default or fall through to it, and the one sentence
  // it failed to match ("make the person in the photo smile") was routed to a
  // generation for no reason. Where the slot holds nothing to edit, clampIntent
  // turns this back into a generation anyway.
  return clampIntent(FRESH_WORDS.test(text) ? "newPhoto" : "editPhoto", ctx);
}

/**
 * What the dialog says it did, in the operator's terms.
 *
 * The routing is invisible until it is wrong, and then it has to be obvious:
 * a sentence naming what happened is what lets someone see a mis-route
 * immediately rather than after they have looked at the slide twice.
 */
export function intentDescription(intent: SlideIntent): string {
  switch (intent) {
    case "newPhoto":
      return "Made a new photograph.";
    case "editPhoto":
      return "Changed the photograph.";
    default:
      return "Redesigned the slide.";
  }
}
