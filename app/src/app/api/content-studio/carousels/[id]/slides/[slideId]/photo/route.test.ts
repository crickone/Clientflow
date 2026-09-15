// Run: npm test -- "src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.test.ts"
//
// The photo route's PERSISTENCE contract -- which columns a pick or a redesign
// writes, and which slots it refuses. Every defect this guards has already
// shipped at least once, in three separate routes, and each was a one-line
// regression away from coming back:
//
//   1. a slot-2 pick writing the list and leaving background_asset_id stale
//      (the two columns must always agree: background_asset_id IS slot 1);
//   2. a redesign persisting only background_asset_id, so a two-photograph
//      result lost slot 2 at the next re-render -- and writing that column as
//      `undefined`, which drizzle reads as "leave it", so a result with no
//      slot 1 kept the OLD photograph in the column while the list said null;
//   3. a one-slot slide carrying a stale list forward instead of storing null;
//   4. a slot the markup does not use being written anyway;
//   5. an over-cap slot (photoSlotsUsed REPORTS those on purpose, for the
//      audit) being accepted, rendered, then sliced away by
//      serialisePhotoAssetIds -- on screen and not in the row.
//
// The route is exercised for real; only its ambient dependencies are stubbed,
// because the defects live in the WIRING (which column gets which value) and
// not in the helpers it composes. Same Module._load shim as
// src/lib/exerciseLibrary.test.ts, for the same reason: this plain tsx runner
// has no Next request context, no database and no design system.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

interface SlideRow {
  id: number;
  templateId: string;
  designHtml: string | null;
  aspectRatio: string;
  backgroundAssetId: number | null;
  photoAssetIds: string | null;
  imagePrompt: string | null;
  photoScenes: string | null;
}

const CAROUSEL_ID = 1;
const slides = new Map<number, SlideRow>();
/** Every updateSlide(id, patch) the route made, newest last. */
let writes: { id: number; patch: Record<string, unknown> }[] = [];
/** The photographs the renderer was handed, per slot. */
let renderedPhotos: (string | null)[] = [];
/** What the stubbed model hands back, set per case. */
let redesignResult: unknown = null;
/** The scene the route briefed the image model with, per generate call. */
let briefedScene = "";

function makeSlide(row: Partial<SlideRow> & { id: number }): SlideRow {
  const slide: SlideRow = {
    templateId: "designed",
    designHtml: null,
    aspectRatio: "1:1",
    backgroundAssetId: null,
    photoAssetIds: null,
    imagePrompt: null,
    photoScenes: null,
    ...row,
  };
  slides.set(slide.id, slide);
  return slide;
}

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
const stubs: Record<string, unknown> = {
  "next/server": {
    NextResponse: {
      json: (body: unknown, init?: { status?: number }) => ({
        status: init?.status ?? 200,
        json: async () => body,
      }),
    },
  },
  "@/lib/api/guard": { guard: async () => null },
  "@/lib/auth": { getCurrentMembership: () => ({ tenant: { id: 1 } }) },
  "@/lib/image/carousels": {
    getCarousel: (id: number) =>
      id === CAROUSEL_ID
        ? { id, name: "Test design", showLogo: false, slides: [...slides.values()] }
        : null,
    updateSlide: (id: number, patch: Record<string, unknown>) => {
      writes.push({ id, patch });
      const row = slides.get(id);
      if (row) Object.assign(row, patch);
    },
  },
  // The library holds ids 5..11; photoChoiceFor is deliberately exact here, so
  // a test can tell "slot 2's photograph" from "slot 1's" in what the renderer
  // was given.
  "@/lib/image/library": {
    photoChoices: () => [5, 7, 8, 9, 11].map((id) => ({ id, path: `/photos/${id}.jpg` })),
    photoChoiceFor: (id: number | null) =>
      id == null ? null : { id, path: `/photos/${id}.jpg` },
  },
  "@/lib/image/paintSlide": { DESIGNED_TEMPLATE_ID: "designed" },
  "@/lib/design/system": { getDesignSystem: () => ({ name: "test system" }) },
  "@/lib/design/renderDesignedSlide": {
    renderDesignedSlide: async (input: { photos?: ({ path: string } | null)[] }) => {
      renderedPhotos = (input.photos ?? []).map((p) => p?.path ?? null);
      return { filename: "render.png", width: 1080, height: 1080, overflowPx: 0 };
    },
  },
  "@/lib/ai/designPost": { redesignSlide: async () => redesignResult },
  "@/lib/branding": { resolveLogoPath: () => null },
  "@/lib/ai/usage": { AiCapError: class AiCapError extends Error {} },
  "@/lib/ai/image/generatePostImage": {
    generatePostImage: async () => ({ id: 5, path: "/photos/5.jpg" }),
  },
  "@/lib/ai/image/falClient": { isImageGenConfigured: () => true },
  "@/lib/settings": { getBrandImageStyle: () => null },
  "@/lib/businessProfile": { getBusinessProfile: () => ({ name: "Test" }) },
  "@/lib/ai/image/prompt": {
    buildImagePrompt: (input: { scene: string }) => {
      briefedScene = input.scene;
      return "a prompt";
    },
    defaultImageStyle: () => "a style",
  },
};
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request in stubs) return stubs[request];
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

let checks = 0;
function check(fn: () => void) {
  fn();
  checks++;
}

(async () => {
  const { POST } = requireLocal("./route") as typeof import("./route");

  const post = async (slideId: number, body: unknown) => {
    writes = [];
    renderedPhotos = [];
    briefedScene = "";
    const res = await POST({ json: async () => body } as unknown as Request, {
      params: { id: String(CAROUSEL_ID), slideId: String(slideId) },
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  // 1. A slot-2 pick writes BOTH columns, in agreement: the list gains the new
  //    photograph at index 1 and background_asset_id still carries slot 1's.
  const two = makeSlide({
    id: 1,
    designHtml: '<img src="{{PHOTO}}" /><img src="{{PHOTO:2}}" />',
    backgroundAssetId: 7,
    photoAssetIds: "[7,8]",
  });
  {
    const { status } = await post(two.id, { assetId: 9, slot: 2 });
    check(() => assert.equal(status, 200, "a slot-2 pick on a two-slot slide is accepted"));
    check(() =>
      assert.deepEqual(
        renderedPhotos,
        ["/photos/7.jpg", "/photos/9.jpg"],
        "the re-render keeps slot 1's photograph and takes the new one for slot 2",
      ),
    );
    const patch = writes.at(-1)?.patch ?? {};
    check(() =>
      assert.equal(patch.photoAssetIds, "[7,9]", "the list records the pick at slot 2"),
    );
    check(() =>
      assert.equal(
        patch.backgroundAssetId,
        7,
        "background_asset_id still equals slot 1's id -- the columns agree",
      ),
    );
  }

  // 1b. A slot-2 pick on a slide whose slot 1 has never held a photograph
  //     (background_asset_id AND the list both null) still writes
  //     background_asset_id as an explicit null, not an absent key. Case 1
  //     above only ever exercises a POPULATED slot 1, so `nextIds[0]` and
  //     `nextIds[0] ?? null` are indistinguishable there; this pins the
  //     never-photographed shape too, so a future change to how nextIds is
  //     built (the padding, the truncation, parsePhotoAssetIds' fallback)
  //     that stops leaving index 0 densely populated is caught here instead
  //     of surfacing as a stale column in production.
  const neverPhotographed = makeSlide({
    id: 5,
    designHtml: '<img src="{{PHOTO}}" /><img src="{{PHOTO:2}}" />',
    backgroundAssetId: null,
    photoAssetIds: null,
  });
  {
    const { status } = await post(neverPhotographed.id, { assetId: 9, slot: 2 });
    check(() =>
      assert.equal(status, 200, "a slot-2 pick on a never-photographed slide is accepted"),
    );
    const patch = writes.at(-1)?.patch ?? {};
    check(() =>
      assert.equal(
        patch.backgroundAssetId,
        null,
        "slot 1 stays null -- the pick was for slot 2 alone",
      ),
    );
    check(() =>
      assert.equal(
        patch.photoAssetIds,
        "[null,9]",
        "the list records null for the empty slot 1 and the pick at slot 2",
      ),
    );
  }

  // 2. A redesign persists the slot list it came back with, and writes slot 1's
  //    column EXPLICITLY -- `undefined` there means "leave the column" and left
  //    a stale photograph beside a list that says slot 1 is empty.
  const flat = makeSlide({
    id: 2,
    designHtml: "<div>no photograph here</div>",
    backgroundAssetId: 7,
  });
  {
    redesignResult = {
      slide: {
        html: '<img src="{{PHOTO:2}}" />',
        renderFilename: "redesigned.png",
        photo: "a scene",
        photoScenes: ["a scene"],
        photoAssetId: null,
        photoAssetIds: [null, 5],
        violations: [],
      },
      usage: {},
    };
    const { status } = await post(flat.id, { generate: true });
    check(() => assert.equal(status, 200, "a redesign around a new photograph is accepted"));
    const patch = writes.at(-1)?.patch ?? {};
    check(() =>
      assert.equal(
        patch.photoAssetIds,
        "[null,5]",
        "the redesign's slot list is persisted, slot 2 included",
      ),
    );
    check(() =>
      // `?? undefined` would also leave the key present -- with an undefined
      // value, which drizzle reads as "leave the column" -- so `"key" in
      // patch` alone passes under that bug too. The value has to be checked,
      // not just the key's presence.
      assert.notEqual(
        patch.backgroundAssetId,
        undefined,
        "slot 1's column is written, not skipped -- undefined leaves the stale id",
      ),
    );
    check(() =>
      assert.equal(
        patch.backgroundAssetId,
        null,
        "a redesign with no slot 1 clears background_asset_id rather than keeping the old photograph",
      ),
    );
  }

  // 3. A one-slot slide stores null, even when it is carrying a stale list from
  //    the markup a redesign replaced.
  const one = makeSlide({
    id: 3,
    designHtml: '<img src="{{PHOTO}}" />',
    backgroundAssetId: 7,
    photoAssetIds: "[7,9]",
  });
  {
    const { status } = await post(one.id, { assetId: 11 });
    check(() => assert.equal(status, 200, "a pick with no slot means slot 1"));
    check(() =>
      assert.deepEqual(
        renderedPhotos,
        ["/photos/11.jpg"],
        "a one-slot slide renders exactly one photograph",
      ),
    );
    const patch = writes.at(-1)?.patch ?? {};
    check(() =>
      assert.equal(
        patch.photoAssetIds,
        null,
        "a one-photograph slide stores no list -- the stale second entry is dropped",
      ),
    );
    check(() =>
      assert.equal(patch.backgroundAssetId, 11, "background_asset_id carries the new photograph"),
    );
  }

  // 4. A slot the markup does not use is refused rather than stored -- this is
  //    also what a panel holding a slot a redesign removed would send.
  {
    const { status, body } = await post(one.id, { assetId: 11, slot: 2 });
    check(() => assert.equal(status, 400, "slot 2 on a one-slot slide is refused"));
    check(() =>
      assert.match(String(body.error), /no photo slot 2/, "the refusal names the missing slot"),
    );
    check(() => assert.equal(writes.length, 0, "a refused slot writes nothing"));
  }

  // 5. An over-cap slot is refused. photoSlotsUsed REPORTS slot 3 so the audit
  //    can see it; accepting it here rendered the photograph and then stored a
  //    list sliced back to two -- on screen, and not in the row.
  const overCap = makeSlide({
    id: 4,
    designHtml: '<img src="{{PHOTO}}" /><img src="{{PHOTO:3}}" />',
    backgroundAssetId: 7,
  });
  {
    const { status, body } = await post(overCap.id, { assetId: 9, slot: 3 });
    check(() => assert.equal(status, 400, "a slot past MAX_PHOTO_SLOTS is refused"));
    check(() =>
      assert.match(String(body.error), /no photo slot 3/, "the refusal names the over-cap slot"),
    );
    check(() => assert.equal(writes.length, 0, "an over-cap slot writes nothing"));
  }

  // 6. A malformed slot is an error rather than a surprise write to slot 1.
  for (const bad of [0, -1, true, {}, "2"]) {
    const { status } = await post(two.id, { assetId: 9, slot: bad });
    check(() =>
      assert.equal(status, 400, `slot ${JSON.stringify(bad)} is refused rather than coerced`),
    );
    check(() => assert.equal(writes.length, 0, `slot ${JSON.stringify(bad)} writes nothing`));
  }

  // 7. "Make a new photo" is briefed with the TARGETED slot's scene.
  //
  //    The design named a scene per slot and only slot 1's was ever read, so
  //    on this feature's own example -- infrared above, HBOT below -- pressing
  //    Make a new photo with Second selected generated a second infrared bed
  //    and reported nothing wrong.
  const compared = makeSlide({
    id: 6,
    designHtml: '<img src="{{PHOTO}}" /><img src="{{PHOTO:2}}" />',
    imagePrompt: "an infrared bed in a treatment room",
    photoScenes: '["an infrared bed in a treatment room","a hyperbaric chamber, daylight"]',
  });
  {
    await post(compared.id, { generate: true, onlyGenerate: true, slot: 2 });
    check(() =>
      assert.equal(
        briefedScene,
        "a hyperbaric chamber, daylight",
        "slot 2 is briefed with slot 2's scene, not slot 1's",
      ),
    );
    await post(compared.id, { generate: true, onlyGenerate: true, slot: 1 });
    check(() =>
      assert.equal(
        briefedScene,
        "an infrared bed in a treatment room",
        "slot 1 is still briefed with slot 1's scene",
      ),
    );
  }

  // 8. A slide with one scene briefs BOTH slots with it -- the fallback that
  //    keeps every slide designed before the column existed working exactly as
  //    it did, since image_prompt is all such a row has.
  const oneScene = makeSlide({
    id: 7,
    designHtml: '<img src="{{PHOTO}}" /><img src="{{PHOTO:2}}" />',
    imagePrompt: "a quiet treatment room",
  });
  {
    await post(oneScene.id, { generate: true, onlyGenerate: true, slot: 2 });
    check(() =>
      assert.equal(
        briefedScene,
        "a quiet treatment room",
        "a slide with only slot 1's scene falls back to it for slot 2",
      ),
    );
  }

  // 9. The redesign persists the scene list, so the NEXT generation on either
  //    slot is briefed against the markup the slide actually has.
  //
  //    Its own flat slide, not the one case 2 used: the stub writes patches
  //    back onto the row, so that slide now HAS a photo slot and would take
  //    the swap path instead of the redesign one.
  const flatAgain = makeSlide({ id: 8, designHtml: "<div>no photograph here</div>" });
  {
    redesignResult = {
      slide: {
        html: '<img src="{{PHOTO}}" /><img src="{{PHOTO:2}}" />',
        renderFilename: "redesigned.png",
        photo: "an infrared bed",
        photoScenes: ["an infrared bed", "a hyperbaric chamber"],
        photoAssetId: 5,
        photoAssetIds: [5, 5],
        violations: [],
      },
      usage: {},
    };
    await post(flatAgain.id, { generate: true });
    const patch = writes.at(-1)?.patch ?? {};
    check(() =>
      assert.equal(
        patch.photoScenes,
        '["an infrared bed","a hyperbaric chamber"]',
        "a two-scene redesign persists both scenes",
      ),
    );
    check(() =>
      assert.equal(
        patch.imagePrompt,
        "an infrared bed",
        "and image_prompt still holds slot 1's scene alone -- never the list",
      ),
    );
  }

  // 10. A one-scene result stores null, the same as a one-photograph slide
  //     stores no id list -- that is what keeps an old row byte-identical.
  const flatOnce = makeSlide({ id: 9, designHtml: "<div>no photograph here</div>" });
  {
    redesignResult = {
      slide: {
        html: '<img src="{{PHOTO}}" />',
        renderFilename: "redesigned.png",
        photo: "a quiet treatment room",
        photoScenes: ["a quiet treatment room"],
        photoAssetId: 5,
        photoAssetIds: [5],
        violations: [],
      },
      usage: {},
    };
    await post(flatOnce.id, { generate: true });
    const patch = writes.at(-1)?.patch ?? {};
    check(() =>
      assert.equal(patch.photoScenes, null, "a one-scene redesign stores no list"),
    );
  }

  console.log(`photo/route.test.ts: all ${checks} assertions passed`);
})();
