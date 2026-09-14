// Run: npm test -- src/lib/content-studio/designState.test.ts
//
// The first tests this state machine has ever had. It spent its life inside a
// 3,500-line component, so every rule below -- the per-slide undo stacks, the
// poll's once-only handover, the fields the poll must never touch -- was only
// ever verified by clicking around the editor.
//
// Three of these pin a KNOWN DEFECT rather than a guarantee -- the
// redesign-versus-photo-swap race. They are named FLIP 1..3, one per shape the
// fix could take, so that whichever way it lands the pin fails instead of
// passing quietly. See the block they live in for what to do when one fails.
import assert from "node:assert/strict";

import {
  AUTOSAVE_FIELDS,
  POLL_MERGE_FIELDS,
  UNDO_LIMIT,
  autosaveSnapshot,
  designReducer,
  initialDesignState,
  initialSlotFor,
  missingAssetIds,
  planManualBackground,
  planReorder,
  selectActiveSlide,
  selectSlidesInSlot,
  selectUndoDepth,
  selectWriting,
  type DesignSlideLike,
  type DesignState,
} from "./designState";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** A slide with just the fields this machine reads, plus two to watch move. */
interface TestSlide extends DesignSlideLike {
  headingText: string;
  designHtml: string | null;
}

function slide(id: number, over: Partial<TestSlide> = {}): TestSlide {
  return {
    id,
    slotKey: "default",
    caption: "",
    imageStatus: null,
    imageError: null,
    imagePrompt: null,
    backgroundAssetId: null,
    headingText: `heading ${id}`,
    designHtml: null,
    ...over,
  };
}

function stateWith(
  slides: TestSlide[],
  over: Partial<DesignState<TestSlide>> = {},
): DesignState<TestSlide> {
  return { ...initialDesignState(slides), ...over };
}

const reduce = designReducer<TestSlide>;

// ---------------------------------------------------------------------------
//  Selectors and the opening slot
// ---------------------------------------------------------------------------

check(
  "a design holding a carousel opens on the carousel, not on whatever is first",
  initialSlotFor([{ slotKey: "default" }, { slotKey: "carousel-content" }]) ===
    "carousel-content",
);
check(
  "a design with only single posts opens on the default slot",
  initialSlotFor([{ slotKey: "default" }]) === "default",
);
check("an empty design still has a slot to open on", initialSlotFor([]) === "default");

check(
  "the slot on screen is the only one the editor walks",
  selectSlidesInSlot(
    stateWith([slide(1), slide(2, { slotKey: "carousel-content" })], {
      activeSlot: "default",
    }),
  )
    .map((x) => x.id)
    .join() === "1",
);

// ---------------------------------------------------------------------------
//  Undo stacks -- per slide, and they survive switching slides
// ---------------------------------------------------------------------------

{
  let s = stateWith([slide(1, { headingText: "one" }), slide(2, { headingText: "two" })]);
  const original1 = s.slides[0];
  const original2 = s.slides[1];

  // Two structural changes on slide 1.
  s = reduce(s, { type: "snapshotForUndo", slide: original1 });
  s = reduce(s, { type: "patchSlide", slideId: 1, patch: { headingText: "one-b" } });
  s = reduce(s, { type: "snapshotForUndo", slide: s.slides[0] });
  s = reduce(s, { type: "patchSlide", slideId: 1, patch: { headingText: "one-c" } });

  check("the undo stack counts every structural change on this slide", selectUndoDepth(s) === 2);

  // Move to slide 2 and change it once.
  s = reduce(s, { type: "setActiveIndex", index: 1 });
  check("a slide with no history of its own has nothing to undo", selectUndoDepth(s) === 0);
  s = reduce(s, { type: "snapshotForUndo", slide: original2 });
  s = reduce(s, { type: "patchSlide", slideId: 2, patch: { headingText: "two-b" } });
  check("the second slide keeps its own, separate stack", selectUndoDepth(s) === 1);

  // Back to slide 1: its two steps are still there.
  s = reduce(s, { type: "setActiveIndex", index: 0 });
  check(
    "the first slide's stack survived the trip to another slide",
    selectUndoDepth(s) === 2,
  );

  s = reduce(s, { type: "undoSlide", slideId: 1 });
  check("one press walks back exactly one change", s.slides[0].headingText === "one-b");
  check("...and pops exactly one step", selectUndoDepth(s) === 2 - 1);
  check("...and leaves the other slide alone", s.slides[1].headingText === "two-b");

  s = reduce(s, { type: "undoSlide", slideId: 1 });
  check("N changes then N undos is back where you started", s.slides[0].headingText === "one");
  check("an emptied stack is gone, not a zero-length leftover", !(1 in s.undoStacks));

  const settled = reduce(s, { type: "undoSlide", slideId: 1 });
  check("undoing with nothing to undo changes nothing at all", settled === s);
}

{
  // The cap drops the most DISTANT history, not the step about to be undone.
  let s = stateWith([slide(1)]);
  for (let i = 0; i < UNDO_LIMIT + 5; i++) {
    s = reduce(s, { type: "snapshotForUndo", slide: slide(1, { headingText: `v${i}` }) });
  }
  check("the undo stack is capped", selectUndoDepth(s) === UNDO_LIMIT);
  const top = s.undoStacks[1][UNDO_LIMIT - 1];
  check(
    "the cap drops the oldest step, so the newest is still the next undo",
    top.headingText === `v${UNDO_LIMIT + 4}`,
  );
}

// ---------------------------------------------------------------------------
//  The detached generation poll
// ---------------------------------------------------------------------------

{
  // The seed slide the run is about to replace, and the set it replaces it with.
  const seed = [slide(1, { headingText: "seed", slotKey: "carousel-content" })];
  const written = [
    slide(90, { headingText: "written 1", slotKey: "carousel-content" }),
    slide(91, { headingText: "written 2", slotKey: "carousel-content" }),
  ];
  let s = stateWith(seed, { activeSlot: "carousel-content", generationStatus: "writing" });
  check("a design with a run in flight reports as writing", selectWriting(s));

  // Tick 1: still writing. Nothing is handed over. `wasWriting` is what the
  // poll saw when it issued the tick, which is what the component passes.
  s = reduce(s, {
    type: "pollStatus",
    status: "writing",
    error: null,
    stage: "composing",
    serverSlides: written,
    wasWriting: true,
  });
  check(
    "a tick while the run is still writing does NOT take the server's slide set",
    s.slides === seed,
  );
  check("...but it does carry the stage across, so the banner can say where it is", s.generationStage === "composing");

  // Tick 2: the run stopped. This is the writing -> null edge.
  s = reduce(s, {
    type: "pollStatus",
    status: null,
    error: null,
    stage: null,
    serverSlides: written,
    wasWriting: true,
  });
  check(
    "at the writing->null edge the server's slide set is taken WHOLE",
    s.slides === written,
  );
  check(
    "...and the cursor goes to the first of the new slides, which have new ids",
    s.activeIdx === 0,
  );
  check("the active slide is a written one, not the seed", selectActiveSlide(s)?.id === 90);

  // The operator moves on, and a late tick arrives.
  s = reduce(s, { type: "setActiveIndex", index: 1 });
  const laterServerSet = [slide(999, { slotKey: "carousel-content" })];
  s = reduce(s, {
    type: "pollStatus",
    status: null,
    error: null,
    stage: null,
    serverSlides: laterServerSet,
    // Issued after the run stopped, so this tick never saw it writing.
    wasWriting: false,
  });
  check(
    "a tick issued after the run stopped does NOT take the set again",
    s.slides === written,
  );
  check("...so it cannot yank the cursor back to slide one", s.activeIdx === 1);
}

{
  // Two ticks can be in flight at once, and BOTH of them watched the run stop.
  // Both therefore hand over -- the flag is per-tick, not a latch on the
  // machine, because a latch would also swallow the stale-tick case above.
  // Taking the same finished set twice is idempotent bar the cursor reset.
  const written = [slide(90), slide(91)];
  let s = stateWith([slide(1)], { generationStatus: "writing" });
  const tick = {
    type: "pollStatus" as const,
    status: null,
    error: null,
    stage: null,
    serverSlides: written,
    wasWriting: true,
  };
  s = reduce(s, tick);
  s = reduce(s, { type: "setActiveIndex", index: 1 });
  s = reduce(s, tick);
  check(
    "a second tick that also watched the run stop hands over too, cursor and all",
    s.slides === written && s.activeIdx === 0,
  );
}

{
  // "writing" -> "failed" is the same edge: the run stopped, so whatever it
  // managed to write is what the editor should be showing.
  const written = [slide(90)];
  let s = stateWith([slide(1)], { generationStatus: "writing" });
  s = reduce(s, {
    type: "pollStatus",
    status: "failed",
    error: "the model gave up",
    stage: null,
    serverSlides: written,
    wasWriting: true,
  });
  check("giving up is also an edge -- the set is taken", s.slides === written);
  check("the failure reaches the operator", s.generationError === "the model gave up");
}

{
  // A tick that went out BEFORE the run started must not be mistaken for that
  // run finishing. The poll is already running for a per-slide background, so
  // a GET goes out with nothing writing; its DB snapshot predates the run the
  // operator then starts, so it comes back saying `null`. The edge belongs to
  // the run the TICK observed, not to whatever the editor has learned since.
  const local = [
    slide(1, { headingText: "typed, not yet autosaved", imageStatus: "generating" }),
    slide(2),
  ];
  const stale = [slide(1, { headingText: "what the server last stored" })];
  let s = stateWith(local);
  s = reduce(s, { type: "setActiveIndex", index: 1 });
  // The tick goes out here, with no whole-design run in flight.
  const wasWriting = selectWriting(s);
  // The operator starts one before the GET comes back.
  s = reduce(s, { type: "generationStarted", slotKey: "default" });
  s = reduce(s, { type: "setActiveIndex", index: 1 });
  // ...and now the stale answer lands.
  s = reduce(s, {
    type: "pollStatus",
    status: null,
    error: null,
    stage: null,
    serverSlides: stale,
    wasWriting,
  });
  check(
    "a tick issued before the run started cannot hand over its stale slide set",
    s.slides === local,
  );
  check("...so the operator's unsaved edits are still on screen", s.slides.length === 2);
  check("...and the cursor is left where the operator put it", s.activeIdx === 1);
}

{
  // A design that was NEVER writing must not have its slides replaced by the
  // per-slide background poll, which runs off the same tick.
  const local = [slide(1, { imageStatus: "generating" })];
  const server = [slide(1, { imageStatus: "ready", backgroundAssetId: 7 })];
  let s = stateWith(local);
  s = reduce(s, {
    type: "pollStatus",
    status: null,
    error: null,
    stage: null,
    serverSlides: server,
    wasWriting: false,
  });
  check(
    "with no run in flight, a tick never takes the server's slide set",
    s.slides === local,
  );
}

// ---------------------------------------------------------------------------
//  The poll must not touch what the autosave owns
// ---------------------------------------------------------------------------

{
  // The manifest is only worth asserting about because the reducer BUILDS its
  // merge patch from it. So check the reducer's actual output first: hand it a
  // server slide where every field differs and see exactly which ones move.
  const local = [
    slide(1, {
      headingText: "local heading",
      imageStatus: null,
      imageError: null,
      imagePrompt: null,
      backgroundAssetId: 5,
    }),
  ];
  const server = [
    slide(1, {
      headingText: "server heading",
      imageStatus: "ready",
      imageError: "server error",
      imagePrompt: "server prompt",
      backgroundAssetId: 42,
      designHtml: "<section>server</section>",
    }),
  ];
  const merged = reduce(stateWith(local), { type: "pollMerge", serverSlides: server }).slides[0];
  const moved = (Object.keys(merged) as (keyof typeof merged)[])
    .filter((k) => merged[k] !== local[0][k])
    .sort();
  check(
    "the fields a tick moves onto a settled slide are exactly the manifest, no more and no fewer",
    moved.join() === [...POLL_MERGE_FIELDS].sort().join(),
  );

  const autosaved = new Set<string>(AUTOSAVE_FIELDS);
  check(
    "...and none of them is a field the autosave saves, so a tick cannot fight the debounce",
    moved.every((f) => !autosaved.has(f)),
  );
  check(
    "backgroundAssetId is the deliberate exception: the autosave owns it, so a settled slide keeps the operator's pick",
    autosaved.has("backgroundAssetId") && merged.backgroundAssetId === 5,
  );
}

{
  // The operator is typing. The server still holds the old words.
  const local = [
    slide(1, { headingText: "what the operator just typed", imageStatus: "generating" }),
  ];
  const server = [
    slide(1, {
      headingText: "what the server last stored",
      imageStatus: "ready",
      imageError: null,
      imagePrompt: "a sunlit clinic room",
      backgroundAssetId: 42,
    }),
  ];
  const s = reduce(stateWith(local), { type: "pollMerge", serverSlides: server });
  check(
    "the poll leaves the heading the operator is typing exactly alone",
    s.slides[0].headingText === "what the operator just typed",
  );
  check("the poll does carry the generation status across", s.slides[0].imageStatus === "ready");
  check("...and the prompt it was generated from", s.slides[0].imagePrompt === "a sunlit clinic room");
  check(
    "a slide still generating locally takes the background the run made for it",
    s.slides[0].backgroundAssetId === 42,
  );
}

{
  // A manual pick mid-flight cleared imageStatus. The late AI result must not
  // put its own photograph back on the slide.
  const local = [slide(1, { imageStatus: null, backgroundAssetId: 5 })];
  const server = [slide(1, { imageStatus: "ready", backgroundAssetId: 42 })];
  const s = reduce(stateWith(local), { type: "pollMerge", serverSlides: server });
  check(
    "a manual pick wins: the poll does not put the AI's background back",
    s.slides[0].backgroundAssetId === 5,
  );
}

{
  // The run replaced the slot, so the ids the poll knows about are gone.
  const local = [slide(1)];
  const server = [slide(90, { imageStatus: "ready" })];
  const s = reduce(stateWith(local), { type: "pollMerge", serverSlides: server });
  check(
    "a slide the server has never heard of is left untouched",
    s.slides.length === 1 && s.slides[0].id === 1 && s.slides[0].imageStatus === null,
  );
}

{
  const known = new Set([1, 2]);
  const ids = missingAssetIds(
    [
      { backgroundAssetId: 1 },
      { backgroundAssetId: 9 },
      { backgroundAssetId: 9 },
      { backgroundAssetId: null },
    ],
    known,
  );
  check("only assets the library has never seen are fetched, once each", ids.length === 1 && ids[0] === 9);
}

// ---------------------------------------------------------------------------
//  A late response for the slide the operator has already left
// ---------------------------------------------------------------------------

{
  let s = stateWith([slide(1, { headingText: "A" }), slide(2, { headingText: "B" })]);
  // The operator kicks something off on slide 1, then moves to slide 2 and
  // starts typing there.
  s = reduce(s, { type: "setActiveIndex", index: 1 });
  s = reduce(s, { type: "patchSlide", slideId: 2, patch: { headingText: "B, edited" } });

  // Slide 1's response finally lands.
  const late = slide(1, { headingText: "A, redesigned", designHtml: "<section>A</section>" });
  s = reduce(s, { type: "slideUpdated", slide: late });

  check("the late response lands on the slide it was for", s.slides[0].headingText === "A, redesigned");
  check(
    "...and does not touch the slide the operator has moved on to",
    s.slides[1].headingText === "B, edited",
  );
  check("...and does not drag the cursor back", s.activeIdx === 1);
  check("the operator is still looking at slide B", selectActiveSlide(s)?.id === 2);
}

{
  // The same for the in-flight flag: a late finisher must not unlock a swap
  // that started after it.
  let s = stateWith([slide(1), slide(2)], {
    rephotographing: { slideId: 2, assetId: 8 },
  });
  s = reduce(s, { type: "photoSwapFinished", slideId: 1 });
  check(
    "a finisher for a different slide leaves the in-flight swap in flight",
    s.rephotographing?.slideId === 2,
  );
  s = reduce(s, { type: "photoSwapFinished", slideId: 2 });
  check("its own finisher clears it", s.rephotographing === null);
}

// ---------------------------------------------------------------------------
//  Manual background picks
// ---------------------------------------------------------------------------

{
  const s = stateWith([slide(1, { imageStatus: "generating", imageError: null })]);

  const onTemplate = planManualBackground(s, 7, { designed: false });
  check(
    "picking a photo on a template slide patches the slide directly",
    onTemplate.kind === "patch" && onTemplate.patch.backgroundAssetId === 7,
  );
  check(
    "...and resolves the pending AI generation, so the queue's late result is refused",
    onTemplate.kind === "patch" &&
      onTemplate.patch.imageStatus === null &&
      onTemplate.persistClearedGeneration,
  );

  const idle = planManualBackground(stateWith([slide(1)]), 7, { designed: false });
  check(
    "with nothing generating there is nothing to resolve and nothing to persist",
    idle.kind === "patch" && idle.persistClearedGeneration === false,
  );

  const onDesigned = planManualBackground(s, 7, { designed: true });
  check(
    "a designed slide is RE-RENDERED with the photograph rather than patched",
    onDesigned.kind === "rephotograph" && onDesigned.assetId === 7,
  );

  check(
    "clearing the photo on a designed slide does nothing -- there is no background to clear",
    planManualBackground(s, null, { designed: true }).kind === "none",
  );

  const busy = stateWith([slide(1)], { rephotographing: { slideId: 1, assetId: 3 } });
  check(
    "one photo swap at a time: a second pick is refused while one is in flight",
    planManualBackground(busy, 7, { designed: true }).kind === "none",
  );

  check(
    "an empty slot has no slide to put a photo on",
    planManualBackground(stateWith([]), 7, { designed: false }).kind === "none",
  );
}

// ---------------------------------------------------------------------------
//  KNOWN DEFECT -- pinned as it behaves TODAY, not as it should behave
//
//  A photo swap and a redesign of the same slide both end in the same
//  server-side updateSlide and both hand a whole slide row back to the editor.
//  The photo swap is the only one of the two this machine can see; the
//  redesign's in-flight flag lives inside the redesign button. So nothing
//  refuses the overlap, and whichever response lands LAST is the slide the
//  operator is left with.
//
//  Two shapes of fix are open, and the checks below are written so that EITHER
//  of them makes one fail loudly rather than passing quietly:
//
//    FLIP 1 -- the fix at the GATE. Hoist the redesign's in-flight flag into
//      this machine and have planManualBackground refuse a pick while one is
//      running (the fix the comment on planManualBackground predicts). That
//      puts a new field on DesignState, and FLIP 1 reads the field list.
//
//    FLIP 2 / FLIP 3 -- the fix at the WRITE. Make a response that was built
//      from a superseded version of the slide lose to the newer one instead of
//      overwriting it. These two assert the losing outcome in both orders.
//
//  A failure here is the fix ARRIVING, not a regression: rewrite the named
//  check to assert the new behaviour. Do not delete it.
// ---------------------------------------------------------------------------

{
  // FLIP 1 -- the gate. Everything this machine knows it is holding, and the
  // planner's one and only refusal. A photo pick on a designed slide is
  // accepted whenever no other PHOTO SWAP is in flight; a redesign of that
  // same slide cannot make it say no, because there is no field here in which
  // a redesign could be recorded.
  const machine = stateWith([slide(1, { designHtml: "<section>original</section>" })]);
  check(
    "DEFECT PINNED / FLIP 1: the only work in flight this machine can record is a photo swap, so a redesign never reaches the gate",
    Object.keys(machine).sort().join() ===
      "activeIdx,activeSlot,generationError,generationStage,generationStatus,rephotographing,slides,undoStacks" &&
      planManualBackground(machine, 7, { designed: true }).kind === "rephotograph",
  );
}

{
  // FLIP 2 -- the write, redesign first. The operator picks a photo (setup,
  // not a pin: it is the accepted pick that sets the race up), then hits
  // Redesign on the same slide. The redesign answers first, and the photo
  // swap's response -- built from the slide as it was BEFORE the redesign --
  // lands on top of it.
  let s = stateWith([slide(1, { designHtml: "<section>original</section>" })]);
  assert.equal(planManualBackground(s, 7, { designed: true }).kind, "rephotograph");
  s = reduce(s, { type: "photoSwapStarted", slideId: 1, assetId: 7 });
  s = reduce(s, {
    type: "slideUpdated",
    slide: slide(1, { designHtml: "<section>redesigned</section>", backgroundAssetId: 7 }),
  });
  s = reduce(s, {
    type: "slideUpdated",
    slide: slide(1, { designHtml: "<section>original</section>", backgroundAssetId: 7 }),
  });
  s = reduce(s, { type: "photoSwapFinished", slideId: 1 });
  check(
    "DEFECT PINNED / FLIP 2: the redesign is silently thrown away by the slower photo swap, and the editor then reports itself idle",
    s.slides[0].designHtml === "<section>original</section>" && s.rephotographing === null,
  );
}

{
  // FLIP 3 -- the write, the other way round. Same overlap, reversed replies,
  // and this time it is the operator's chosen photograph that disappears.
  let t = stateWith([slide(1, { designHtml: "<section>original</section>" })]);
  t = reduce(t, { type: "photoSwapStarted", slideId: 1, assetId: 7 });
  t = reduce(t, {
    type: "slideUpdated",
    slide: slide(1, { designHtml: "<section>original</section>", backgroundAssetId: 7 }),
  });
  t = reduce(t, {
    type: "slideUpdated",
    slide: slide(1, { designHtml: "<section>redesigned</section>", backgroundAssetId: null }),
  });
  t = reduce(t, { type: "photoSwapFinished", slideId: 1 });
  check(
    "DEFECT PINNED / FLIP 3: in the other order the chosen photograph is the thing that disappears, with no sign a result was dropped",
    t.slides[0].backgroundAssetId === null && t.rephotographing === null,
  );
}

// ---------------------------------------------------------------------------
//  Slide set housekeeping
// ---------------------------------------------------------------------------

{
  let s = stateWith([slide(1), slide(2, { slotKey: "carousel-content" })], {
    activeSlot: "default",
  });
  s = reduce(s, { type: "slideAdded", slide: slide(3) });
  check("a new slide lands last in its slot", s.slides[2].id === 3);
  check("...and the cursor follows it there, counting only the slot on screen", s.activeIdx === 1);
  check("...so the new slide is the one being edited", selectActiveSlide(s)?.id === 3);
}

{
  // Deleting the last slide in a slot leaves the cursor past the end.
  let s = stateWith([slide(1), slide(2)]);
  s = reduce(s, { type: "setActiveIndex", index: 1 });
  s = reduce(s, { type: "slideDeleted", slideId: 2 });
  check("the cursor is briefly past the end", s.activeIdx === 1 && selectSlidesInSlot(s).length === 1);
  s = reduce(s, { type: "clampActiveIndex" });
  check("clamping pulls it back onto the last slide", s.activeIdx === 0);

  const empty = reduce(stateWith([]), { type: "clampActiveIndex" });
  check("an empty slot clamps to zero rather than to -1", empty.activeIdx === 0);

  const settled = stateWith([slide(1), slide(2)]);
  check("clamping when nothing is out of range is a no-op", reduce(settled, { type: "clampActiveIndex" }) === settled);
}

{
  let s = stateWith([slide(1), slide(2, { slotKey: "carousel-content" })], {
    activeSlot: "default",
  });
  s = reduce(s, { type: "selectSlot", slotKey: "carousel-content" });
  check("switching slot shows that slot's slides", selectActiveSlide(s)?.id === 2);
  check("...from the top", s.activeIdx === 0);
}

{
  let s = stateWith([slide(1)], { generationStatus: null });
  s = reduce(s, { type: "generationStarted", slotKey: "carousel-content" });
  check("starting a run switches to the slot it writes into", s.activeSlot === "carousel-content");
  check("...and turns the poll on at once rather than waiting for a tick", selectWriting(s));
  check("...with no stale error from a previous run", s.generationError === null);
}

// ---------------------------------------------------------------------------
//  Reorder
// ---------------------------------------------------------------------------

{
  const s = stateWith(
    [
      slide(1, { caption: "the post's caption" }),
      slide(2),
      slide(3),
      slide(9, { slotKey: "carousel-content" }),
    ],
    { activeSlot: "default" },
  );
  const plan = planReorder(s, [3, 1, 2]);
  check("a drag reorders the slot", plan !== null && plan.slides.slice(0, 3).map((x) => x.id).join() === "3,1,2");
  check("...and leaves every other slot exactly where it was", plan !== null && plan.slides[3].id === 9);
  check(
    "the caption travels to whatever is now first, so it is not stranded",
    plan !== null && plan.slides[0].caption === "the post's caption" && plan.slides[1].caption === "",
  );
  check(
    "the cursor follows the slide you were editing, not the position it vacated",
    plan !== null && plan.activeIdx === 1,
  );
  check("the previous order is kept for the rollback", plan !== null && plan.previousOrder.join() === "1,2,3");

  check("a stale drag is ignored, and no request goes out", planReorder(s, [1, 2]) === null);
  check("a drag naming a slide from another slot is ignored", planReorder(s, [1, 2, 9]) === null);
}

{
  // The PATCH failed. Revert by ORDER so anything typed meanwhile survives.
  let s = stateWith([slide(1), slide(2), slide(3)]);
  const plan = planReorder(s, [3, 1, 2])!;
  s = reduce(s, { type: "slidesReplaced", slides: plan.slides, activeIdx: plan.activeIdx });
  s = reduce(s, { type: "patchSlide", slideId: 2, patch: { headingText: "typed during the request" } });
  s = reduce(s, {
    type: "reorderRolledBack",
    slotKey: plan.slotKey,
    previousOrder: plan.previousOrder,
    previousIdx: plan.previousIdx,
  });
  check("a failed reorder puts the order back", s.slides.map((x) => x.id).join() === "1,2,3");
  check(
    "...without throwing away what was typed while the request was in flight",
    s.slides[1].headingText === "typed during the request",
  );
  check("...and puts the cursor back too", s.activeIdx === 0);
}

{
  // The rollback belongs to the slot that was DRAGGED. A PATCH can take long
  // enough for the operator to switch slots, and rolling the slot on screen
  // back to an order made of another slot's ids restores nothing at all --
  // leaving the failed order on screen while the database holds the old one.
  let s = stateWith(
    [slide(1), slide(2), slide(3), slide(9, { slotKey: "carousel-content" })],
    { activeSlot: "default" },
  );
  const plan = planReorder(s, [3, 1, 2])!;
  s = reduce(s, { type: "slidesReplaced", slides: plan.slides, activeIdx: plan.activeIdx });
  // The operator moves to the carousel while the PATCH is still in flight.
  s = reduce(s, { type: "selectSlot", slotKey: "carousel-content" });
  s = reduce(s, {
    type: "reorderRolledBack",
    slotKey: plan.slotKey,
    previousOrder: plan.previousOrder,
    previousIdx: plan.previousIdx,
  });
  check(
    "a failed reorder rolls back the slot that was dragged, not the slot now on screen",
    s.slides.slice(0, 3).map((x) => x.id).join() === "1,2,3",
  );
  check(
    "...and the slot the operator switched to is untouched",
    s.slides[3].id === 9,
  );
}

// ---------------------------------------------------------------------------
//  The autosave snapshot
// ---------------------------------------------------------------------------

{
  const row = {
    templateId: "bold-headline",
    aspectRatio: "1:1",
    headingText: "Hello",
    headingScale: 1,
    bodyText: "",
    tagline: null,
    headingFont: null,
    bodyFont: null,
    accentColor: "#2c6ce0",
    backgroundColor: null,
    backgroundAssetId: 7,
    backgroundFit: "cover",
    backgroundOffsetX: 0.5,
    backgroundOffsetY: 0.5,
    backgroundZoom: 1,
    // Fields the autosave must never send: they belong to the generation poll
    // or to the renderer, and PATCHing them from here would fight it.
    imageStatus: "generating",
    designHtml: "<section/>",
  };
  const snapshot = autosaveSnapshot(row);
  check(
    "the snapshot is the PATCH body, in a fixed field order",
    snapshot ===
      '{"templateId":"bold-headline","aspectRatio":"1:1","headingText":"Hello","headingScale":1,"bodyText":"","tagline":null,"headingFont":null,"bodyFont":null,"accentColor":"#2c6ce0","backgroundColor":null,"backgroundAssetId":7,"backgroundFit":"cover","backgroundOffsetX":0.5,"backgroundOffsetY":0.5,"backgroundZoom":1}',
  );
  check("the snapshot carries nothing the generation poll owns", !snapshot.includes("imageStatus"));
  check("...and nothing the renderer owns", !snapshot.includes("designHtml"));
  check(
    "the same row twice is the same string, which is how 'nothing to save' is decided",
    autosaveSnapshot(row) === snapshot,
  );
  check(
    "a changed field changes the string",
    autosaveSnapshot({ ...row, headingText: "Hello there" }) !== snapshot,
  );
}

console.log(`\ndesignState: ${passed} checks passed`);
