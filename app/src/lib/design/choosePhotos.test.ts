// Run: npm test -- src/lib/design/choosePhotos.test.ts
//
// The money and the correctness are both here: each call to makePhoto is 4c,
// and a picture landing in the wrong slot is what makes a split-screen
// comparison show one thing twice.
import assert from "node:assert/strict";

import { choosePhotos, type PhotoLike } from "./choosePhotos";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

const LIB: PhotoLike[] = [
  { id: 10, path: "/a.jpg" },
  { id: 11, path: "/b.jpg" },
  { id: 12, path: "/c.jpg" },
];

/** A photographer that records its briefs and hands back a numbered picture. */
function photographer(briefs: string[]) {
  let n = 0;
  return async (scene: string): Promise<PhotoLike> => {
    briefs.push(scene);
    n++;
    return { id: 900 + n, path: `/made-${n}.jpg` };
  };
}

// The runner transpiles to CJS, where top-level await is not available.
async function main() {
  // ─────────────────────────────────────────────────── made beats taken
  {
    const briefs: string[] = [];
    const out = await choosePhotos({
      slots: [1],
      scenes: ["a quiet treatment room, late afternoon light"],
      library: LIB,
      nextPhoto: 0,
      makePhoto: photographer(briefs),
    });
    check("a made photograph wins over the library", out.photos.map((p) => p?.id), [901]);
    check("it is briefed with the design's own scene", briefs, ["a quiet treatment room, late afternoon light"]);
    check("the library rotation does not advance when nothing was taken", out.nextPhoto, 0);
  }

  // ─────────────────────────────────────────────────── positional slots
  {
    const briefs: string[] = [];
    const out = await choosePhotos({
      slots: [1, 2],
      scenes: ["infrared bed, warm", "hyperbaric chamber, cool"],
      library: LIB,
      nextPhoto: 0,
      makePhoto: photographer(briefs),
    });
    check("both slots are photographed", out.photos.map((p) => p?.id), [901, 902]);
    check("each slot gets its OWN brief, in order", briefs, ["infrared bed, warm", "hyperbaric chamber, cool"]);
  }
  {
    const briefs: string[] = [];
    const out = await choosePhotos({
      slots: [2],
      scenes: ["", "the second thing"],
      library: LIB,
      nextPhoto: 0,
      makePhoto: photographer(briefs),
    });
    check("slot 2 alone leaves slot 1 empty", out.photos.map((p) => p?.id ?? null), [null, 901]);
    check("…and is briefed with slot 2's scene, not slot 1's", briefs, ["the second thing"]);
  }
  {
    const briefs: string[] = [];
    await choosePhotos({
      slots: [1],
      scenes: [],
      fallbackScene: "the slide's one scene",
      library: [],
      nextPhoto: 0,
      makePhoto: photographer(briefs),
    });
    check("a design that wrote one scene rather than a list still briefs it", briefs, ["the slide's one scene"]);
  }

  // ─────────────────────────────────────────────────── the library fallback
  {
    const out = await choosePhotos({ slots: [1], scenes: [], library: LIB, nextPhoto: 0 });
    check("no photographer: the library answers", out.photos.map((p) => p?.id), [10]);
    check("and the rotation advances", out.nextPhoto, 1);
  }
  {
    // The provider declined (a hiccup on one image). Losing the picture is worse
    // than using a shelf one, so the post is still finished.
    const out = await choosePhotos({
      slots: [1, 2],
      scenes: ["x", "y"],
      library: LIB,
      nextPhoto: 1,
      makePhoto: async () => null,
    });
    check("a photographer that declines falls back to the library", out.photos.map((p) => p?.id), [11, 12]);
    check("…rotating from where the set had got to", out.nextPhoto, 3);
  }
  {
    const out = await choosePhotos({ slots: [1, 2], scenes: [], library: [LIB[0]!], nextPhoto: 0 });
    check("a library of one repeats rather than leaving a hole", out.photos.map((p) => p?.id), [10, 10]);
  }
  {
    const out = await choosePhotos({ slots: [], scenes: [], library: LIB, nextPhoto: 2 });
    check("a slide with no photo slot takes no photograph", out.photos, []);
    check("…and does not move the rotation past pictures it never showed", out.nextPhoto, 2);
  }
  {
    const out = await choosePhotos({ slots: [1], scenes: [], library: [], nextPhoto: 0 });
    check("nothing available at all renders the slot empty", out.photos, [null]);
  }

  // ─────────────────────────────────────────────────── spend
  {
    let calls = 0;
    await choosePhotos({
      slots: [1, 2],
      scenes: ["a", "b"],
      library: LIB,
      nextPhoto: 0,
      makePhoto: async () => {
        calls++;
        return { id: 900 + calls, path: "/m.jpg" };
      },
    });
    check("one metered photograph per SLOT, never more", calls, 2);
  }

  console.log(`choosePhotos: ${passed} checks passed.`);
}

main();
