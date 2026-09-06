// Run: npm test -- src/lib/ai/generateCarouselExtract.test.ts
//
// Task 6: extractPayload tolerantly parses the per-slide "image" field the
// carousel generator now asks Sonnet for — present+trimmed when the model
// supplies a string, "" when it's missing or the wrong type (a later task
// falls back to a scene derived from the slide's copy in that case).
//
// generateCarousel.ts -> @/lib/ai/businessContext -> @/lib/db (index.ts) ->
// ./tenant -> `import { cache } from "react"`. Same shim as
// draftFollowup.test.ts / tools.marketing.test.ts / tools.sales.test.ts, for
// the same reason: under the runner's `--conditions=react-server`, npm's
// react "react-server" entry throws on load ("This entry point is not yet
// supported outside of experimental channels"), so `cache` needs stubbing.
// (Empirically this chain doesn't touch next/navigation or next/headers at
// load time, unlike those siblings' chains — only `react` needs a stub
// here.) Installed via a dynamic require (below) rather than a static
// import, since a static `import ... from "./generateCarousel"` would be
// hoisted and evaluated before this shim runs.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { extractPayload } = requireLocal("./generateCarousel") as typeof import("./generateCarousel");

  const withImages = `<slides>{"caption":"cap","slides":[
    {"template":"carousel-cover","heading":"H1","body":"B1","image":"a sunlit gym floor with kettlebells"},
    {"template":"carousel-content","heading":"H2","body":"B2","image":"  close-up of chalked hands  "}
  ]}</slides>`;
  const a = extractPayload(withImages);
  assert.equal(a.slides[0].image, "a sunlit gym floor with kettlebells");
  assert.equal(a.slides[1].image, "close-up of chalked hands", "trimmed");

  // Missing / wrong-typed image → "" (caller falls back to fallbackScene).
  const withoutImages = `<slides>{"caption":"cap","slides":[
    {"template":"carousel-cover","heading":"H1","body":"B1"},
    {"template":"carousel-content","heading":"H2","body":"B2","image":42}
  ]}</slides>`;
  const b = extractPayload(withoutImages);
  assert.equal(b.slides[0].image, "");
  assert.equal(b.slides[1].image, "");

  // The optional per-slide tagline (the stat on carousel-stat, the tip
  // label) — present+trimmed when the model wrote one, undefined when
  // missing/blank/wrong-typed so addSlide's own default applies.
  const withTaglines = `<slides>{"caption":"cap","slides":[
    {"template":"carousel-stat","heading":"H1","body":"B1","image":"i","tagline":" 87% "},
    {"template":"carousel-content","heading":"H2","body":"B2","image":"i"},
    {"template":"carousel-content","heading":"H3","body":"B3","image":"i","tagline":"   "},
    {"template":"carousel-content","heading":"H4","body":"B4","image":"i","tagline":42}
  ]}</slides>`;
  const c = extractPayload(withTaglines);
  assert.equal(c.slides[0].tagline, "87%", "trimmed tagline survives");
  assert.equal(c.slides[1].tagline, undefined, "missing tagline is undefined");
  assert.equal(c.slides[2].tagline, undefined, "blank tagline is undefined");
  assert.equal(c.slides[3].tagline, undefined, "non-string tagline is undefined");

  console.log("generateCarouselExtract.test.ts: all assertions passed");
})();
