/**
 * Post treatments: one overall approach for a WHOLE post, rotated between
 * generations.
 *
 * Opening moves (./openingMoves) vary slide one. They did not stop posts
 * looking alike, because everything after the cover was built from the same
 * small kit every time: a heading top left under a small label, a rule, then a
 * list with hairlines or stacked cards. A treatment names the device the whole
 * set is built around (statements, a numbered sequence, simple diagrams, split
 * screens...), so consecutive posts read as different pieces while the brand's
 * colours, type and grounds stay the same.
 *
 * Like an opening move this is DIRECTION, not a layout to fill in: the model
 * still composes every slide. The photograph policy is the one part that is
 * checked, because a direction the model may ignore is how the covers ended up
 * all the same.
 *
 * Pure: the caller owns reading and writing the recent list.
 */

import { photoSlotsUsed } from "@/lib/design/photoSlots";
import type { OpeningMove } from "./openingMoves";

export type PhotoPolicy = "none" | "one" | "any" | "inset";

export interface PostTreatment {
  key: string;
  /** A noun phrase: what the set is built around. */
  directive: string;
  photos: PhotoPolicy;
}

/** How many recent treatments are kept out of the next pick. */
export const RECENT_TREATMENTS = 4;

export const POST_TREATMENTS: PostTreatment[] = [
  {
    key: "statements",
    directive:
      "statements: each slide after the cover is one short sentence set very large, with at most one supporting line, and no lists or cards anywhere in the set",
    photos: "one",
  },
  {
    key: "numbered",
    directive:
      "a numbered sequence: each slide after the cover carries its own large step numeral as the dominant shape, with the step's copy set beside or beneath it",
    photos: "any",
  },
  {
    key: "diagram",
    directive:
      "simple diagrams drawn with blocks and rules: a scale, a bar, a before-and-after pair, a row of dots for a timeline, so each slide shows its point as a picture made of shapes and type. Diagrams show only facts from the business details, never invented figures",
    photos: "one",
  },
  {
    key: "split",
    directive:
      "split screens: each slide divided into two zones on different grounds, with the proportion changing from slide to slide (a third and two thirds, a half, a narrow band)",
    photos: "any",
  },
  {
    key: "editorial",
    directive:
      "editorial pages: a large headline and a short standfirst, body copy set like a magazine column with generous space, and one slide given over to a single pull quote",
    photos: "any",
  },
  {
    key: "questions",
    directive:
      "questions and answers: each slide leads with a question set large, answered in two or three short lines beneath it",
    photos: "one",
  },
  {
    key: "inset-photos",
    directive:
      "framed photographs: photographs appear only as inset frames, never full-bleed, placed differently on each slide, with the type on flat ground around them",
    photos: "inset",
  },
  {
    key: "type-only",
    directive:
      "type alone: no photographs anywhere in the set; scale, weight, grounds and rules carry every slide",
    photos: "none",
  },
  {
    key: "side-heads",
    directive:
      "side headings: a narrow column of labels down one side of each slide, the content set against them like an index, items marked clearly",
    photos: "one",
  },
  {
    key: "big-words",
    directive:
      "one dominant word or figure per slide, set large enough to be cropped by the canvas edge, with the explanation small beneath it. Figures only where the business details give them; otherwise a word",
    photos: "any",
  },
];

export const POST_TREATMENT_KEYS = POST_TREATMENTS.map((t) => t.key);

export function pickTreatment(
  recent: readonly string[],
  hasPhoto: boolean,
  random: () => number = Math.random,
): PostTreatment {
  const exclude = new Set(recent.slice(0, RECENT_TREATMENTS));
  const usable = POST_TREATMENTS.filter((t) => hasPhoto || t.photos !== "inset");
  const candidates = usable.filter((t) => !exclude.has(t.key));
  const pool = candidates.length > 0 ? candidates : usable;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** The photograph rule for the treatment, in words, for the prompt. */
export function treatmentPhotoLine(t: PostTreatment): string | null {
  switch (t.photos) {
    case "none":
      return "This set uses NO photographs at all: no {{PHOTO}} on any slide.";
    case "one":
      return "At most ONE slide in this set carries a photograph.";
    case "inset":
      return "Every photograph is an inset frame inside the composition, never full-bleed behind the type.";
    default:
      return null;
  }
}

/**
 * Where a set ignored the parts of its direction that matter most: the cover
 * and the photograph policy. Returned as repair notes for the existing single
 * repair call. Kept out of any slide's own violations, since no slide is wrong
 * on its own terms.
 */
export function directionProblems(
  slidesHtml: readonly string[],
  move: OpeningMove,
  treatment: PostTreatment,
): string[] {
  const problems: string[] = [];
  const photoSlides = slidesHtml.map((h, i) => (photoSlotsUsed(h).length > 0 ? i : -1)).filter((i) => i >= 0);
  // A cover meant to be photo-free that comes back with a photograph is the
  // exact failure that made every cover look the same.
  if (!move.needsPhoto && photoSlides.includes(0)) {
    problems.push(
      `Slide 1: the cover was to open on ${move.directive}, with no photograph. It uses one. Redesign slide 1 to that direction, without a photograph.`,
    );
  }
  if (treatment.photos === "none" && photoSlides.length > 0) {
    problems.push(
      `This set was to use no photographs, but slide${photoSlides.length > 1 ? "s" : ""} ${photoSlides.map((i) => i + 1).join(", ")} use${photoSlides.length > 1 ? "" : "s"} one. Remove them and let type and grounds carry those slides.`,
    );
  }
  if (treatment.photos === "one" && photoSlides.length > 1) {
    problems.push(
      `This set was to carry at most one photograph, but slides ${photoSlides.map((i) => i + 1).join(", ")} each use one. Keep the strongest and redesign the others without a photograph.`,
    );
  }
  return problems;
}
