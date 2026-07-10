# Content Studio — Video Editor Redesign (CapCut-style fine-tuning)

**Date:** 2026-06-03
**Module:** Content Studio → Videos (`/content-studio/videos/[id]`)
**Status:** Design approved, pending spec review

## Problem

The current video editor is an **AI-assisted render pipeline with a clunky editing surface**. After upload, the user configures settings across a tall vertical stack of cards (caption font, music, polish toggles, b-roll plan, transcript), then clicks **Render** and waits for a server-side ffmpeg pass (2–4× clip length) just to *see* the result. Every tweak is another full re-render. The main footage is effectively fixed — only an "auto-trim silences" toggle touches it. The experience does not feel like editing; it feels like filling in a form and waiting.

## Goal

Make it feel like **CapCut**: the user drops in a main video, drops b-roll into a tray, lets the AI build a first cut, then **comes in at the end and fine-tunes on a live timeline** — play/pause, scrub, trim, split, delete, reorder, retime b-roll, fix captions — all on a preview that plays the real composition in real time, with no ffmpeg until export.

### Non-goals (v1)
- Multi-clip stitching of several main recordings (single main video only).
- Per-segment speed control (deferred — "add later").
- Manual caption repositioning per video (caption position/font stays a per-project style).
- Transitions, filters, stickers, effects.
- Making fire-and-forget jobs multi-user-robust (pre-existing caveat, unchanged).

## Workflow (unchanged start, new finish)

1. Create project → drop in **main video** → drop **b-roll** clips into the tray.
2. **AI first cut** (existing pipeline): transcribe → captions → place b-roll → trim dead air → music/intro.
3. User lands in **the editor** with the AI's first cut already laid out, and **fine-tunes CapCut-style** on a live timeline.
4. **Export** → existing ffmpeg pipeline produces the exact final MP4.

## Core model

### Two phases, one screen
Project creation + AI first cut are unchanged. The difference is the landing surface: instead of a stack of setting cards, the user lands in a single editor screen (preview + inspector + multi-track timeline) with the first cut pre-loaded.

### Live preview = browser compositing (not rendering)
On play, the editor composites the result live in the browser:
- **Main video** plays, seeking across the user's cut/reordered segments.
- **Active b-roll** shows as an overlaid `<video>` at the right moment (mechanism already exists in `PlanTimelineEditor`).
- **Captions** draw as a styled text/canvas overlay synced to playback.
- **Music** plays underneath via a browser audio element.
- A single shared playhead + play/pause drives all of it.

Edits update the timeline state instantly; the preview reflects them on next playback of that region. **No ffmpeg until export.**

### Fidelity contract (agreed)
The live preview is a faithful **approximation**, not pixel-identical to the export. Browser draws captions with web fonts/CSS; ffmpeg burns them with libass. They look very close but not byte-identical, and a seam at a cut may stutter a frame while scrubbing. **Export remains the master** via the existing ffmpeg pipeline. (This mirrors how CapCut itself works — preview engine ≠ export encoder.)

## Data model

### New: `timelineJson` on `video_projects`
A single edit document (TEXT column, additive, self-healing on boot like other migrations):

```jsonc
{
  "mainSegments": [          // ordered slices of the main video = "the cut"
    { "sourceStart": 0.0, "sourceEnd": 12.4 },
    { "sourceStart": 15.1, "sourceEnd": 23.0 }
  ],
  "brollInserts": [          // same shape as today's plan, in OUTPUT-timeline coords
    { "startSec": 11.0, "endSec": 15.0, "brollAssetId": 7, "brollStartSec": 2.3 }
  ]
}
```

- **`mainSegments`** is the editable main track. One full-length segment = untouched clip. Split adds a boundary; delete removes a segment (gap closes); reorder changes array order; trim moves a segment's in/out points.
- **`brollInserts`** moves from `planJson` into `timelineJson` (always output-timeline coordinates).

### Captions stay sourced from `transcriptJson`
The word-level transcript (already editable) remains the caption source. Words are re-timed through the segment map (source-time → output-time) at preview and at render, so cutting a sentence on the main track automatically drops its captions.

### "Auto-trim" becomes baked, visible cuts
Instead of a render-time toggle that silently removes silence, the **AI first cut bakes the silence-trim into `mainSegments`** as real, visible segments the user can see and undo. `autoTrimSilence` is no longer a render-time behavior; it (and the existing silence-detection in `lib/video/trim.ts`) becomes the generator of the *initial* segment list.

### Music / intro
Unchanged project columns: `musicFilename`, `musicVolume`, `showIntroOutro`, `introDurationSec`. Relocated into the inspector UI.

### Migration / back-compat
Existing projects have no `timelineJson`. On open, synthesize one: a single full-length `mainSegment` (or, if `autoTrimSilence` was on, the computed keep-ranges) + their saved `planJson` b-roll inserts. Nothing breaks; new columns are additive.

## Editor screen (Layout B)

- **Top bar:** project name · AI actions (**Re-caption**, **Re-suggest b-roll**) · **Undo** · **Export MP4** (orange; only thing that triggers ffmpeg).
- **Preview (left):** 9:16 (or 1:1) video playing the real composition with caption + b-roll overlays. Transport: skip-back / play-pause / skip-forward + `current / total` readout. Spacebar toggles play/pause.
- **Inspector (right):** context-sensitive, shows only what is relevant to the current selection:
  - Main segment selected → split / delete / (speed deferred).
  - B-roll block selected → source clip, start-in-main, length, source-trim, remove.
  - Caption word selected → fix text.
  - Nothing selected → quick AI actions + export.
- **Timeline (bottom), four tracks:** **Main** (editable segments: split/delete/drag-reorder/trim), **B-roll** (cutaway blocks: move/trim), **Captions** (word-by-word; click a word to fix), **Music** (bed + volume). One orange playhead scrubs all tracks together. Click to scrub, drag to move, drag edges to trim.
- **B-roll tray:** docked under the timeline; drop new clips here, drag onto the B-roll track.

Autosave `timelineJson` on edit (debounced), matching the app's existing PATCH-project pattern.

## Editing capabilities (v1)

**Main track:** trim edges · split at playhead · delete (gap closes) · reorder by drag. (Speed deferred.)
**B-roll:** drag from tray → track · move/trim on timeline · choose source slice · remove.
**Captions:** auto-generated · click word to fix typo · cuts drop their captions automatically.
**Music / intro:** pick bed + volume · logo-intro toggle + length.

## Export engine change (the one real engine change)

Today `render.ts` removes silence with a single ordered `select` expression — which **cannot express reordering** (select preserves source order). For the new model, export must:

1. Split the main video into the `mainSegments`.
2. **Concatenate them in timeline order** (trim + concat), producing the main stream.
3. Then overlay b-roll, burn captions, mix music, apply logo intro, encode — **all downstream stages unchanged**.

The caption + b-roll time-remap generalizes from "ordered keep-ranges" (current `buildTimeRemap` / `remapWords` in `lib/video/trim.ts`) to "ordered segment list" (segments may be reordered, so the mapping is per-segment source→output offset rather than a monotonic remap).

## Build phases (each independently testable; tool works end-to-end after each)

1. **Data + engine** — add `timelineJson`, synthesize for existing projects, upgrade `render.ts` to split→concat segments in order with generalized time-remap. Verify by rendering a reordered timeline correctly (no UI yet).
2. **Live preview engine** — browser component that plays the composition (main `<video>` seeking across segments + overlaid b-roll + caption overlay + music audio + shared play/pause + playhead).
3. **Editor screen (Layout B)** — preview + inspector + multi-track timeline + b-roll tray, wired to `timelineJson` with autosave, replacing the stack of cards in `ProjectDetail`.
4. **AI actions + export** — re-caption / re-suggest-b-roll buttons; Export runs the upgraded renderer.

## Risks

- **Seam stutter** seeking across a cut in preview — acceptable for fine-tuning (export is smooth); mitigate later by preloading the next segment if needed.
- **Long videos** — many segments × tracks get heavy in-browser; fine for <60s reels, not optimizing for hour-long footage.
- **Fire-and-forget jobs** — transcription/render robustness is a pre-existing caveat, unchanged here.

## Key existing files

- `src/components/content-studio/ProjectDetail.tsx` — current stacked-card editor (to be replaced by Layout B).
- `src/components/content-studio/PlanTimelineEditor.tsx` — existing single-track b-roll timeline + live b-roll overlay preview (the seed of the new preview engine).
- `src/lib/video/render.ts` — ffmpeg export pipeline (gets the split→concat upgrade).
- `src/lib/video/trim.ts` — silence keep-ranges + word remap (generalized to segment list).
- `src/lib/ai/{transcribe,planCut}.ts` — AI first-cut steps (reused).
- `src/lib/db/schema.ts` — `videoProjects` / `videoAssets` (add `timelineJson`).
- `src/app/api/content-studio/projects/[id]/*` — project PATCH + render routes.
