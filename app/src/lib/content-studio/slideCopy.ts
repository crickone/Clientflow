/**
 * A slide's words, wherever the slide happens to keep them.
 * ZERO RUNTIME IMPORTS beyond the text-run scanner.
 *
 * THE TWO KINDS OF SLIDE STORE COPY IN DIFFERENT PLACES. A template slide has
 * `headingText` and `bodyText` columns. An AI-DESIGNED slide has neither --
 * it is created with both empty, because its copy lives inside `designHtml`
 * as ordinary text nodes, and the markup is the source of truth.
 *
 * Anything that wants to READ a slide's copy has to know that, and the things
 * that did not have quietly misbehaved: a caption written from a designed
 * carousel was written from "(empty)" repeated five times, and a refresh that
 * filtered designed slides out entirely reported "no slides to refresh" for a
 * set made only of them.
 */
import { findTextRuns } from "@/lib/design/textRuns";

export interface SlideCopy {
  template: string;
  heading: string;
  body: string;
}

export interface SlideLike {
  templateId: string;
  headingText: string | null;
  bodyText: string | null;
  designHtml: string | null;
}

/**
 * The heading and body a prompt should be given for this slide.
 *
 * For a designed slide the FIRST text run is the heading and everything after
 * it is the body, joined with newlines. That is a convention rather than a
 * fact about the markup -- a design can put its label above its heading -- but
 * it is the same convention the rest of the editor uses (the photo route's
 * fallback brief takes the first two runs as the slide's words), and for
 * writing a caption the exact split matters far less than having the words at
 * all.
 */
export function copyOf(slide: SlideLike, designedTemplateId: string): SlideCopy {
  if (slide.templateId !== designedTemplateId || !slide.designHtml) {
    return {
      template: slide.templateId,
      heading: slide.headingText ?? "",
      body: slide.bodyText ?? "",
    };
  }
  const runs = findTextRuns(slide.designHtml)
    .map((r) => r.text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return {
    template: slide.templateId,
    heading: runs[0] ?? "",
    body: runs.slice(1).join("\n"),
  };
}
