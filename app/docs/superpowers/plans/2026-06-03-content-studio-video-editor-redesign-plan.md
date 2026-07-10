# Implementation Plan — Content Studio Video Editor Redesign

**Spec:** `docs/superpowers/specs/2026-06-03-content-studio-video-editor-redesign-design.md`
**Scope:** Replace the stacked-card video editor with a single-screen, CapCut-style editor where the AI builds a first cut and the user fine-tunes live (trim/split/delete/reorder main segments, retime b-roll, fix captions) on a browser-composited preview, exporting via the existing ffmpeg pipeline (upgraded to split→concat for reorder).

**Conventions:** each phase ends `npx tsc --noEmit` clean; pure logic gets a `*.test.ts` run via `npx tsx`; UI verified via the local Playwright screenshot recipe (mint an `auth_sessions` row → cookie `renova_session` → drive system Chrome via `playwright-core` `channel:'chrome'`); deploy only once the slice is whole and `build:prod` is green. Fire-and-forget jobs keep their existing try/catch + status-write pattern.

**Guiding principle:** reuse the AI first-cut pipeline (`transcribe`, `planCut`, captions, music, intro) and the ffmpeg export. This work adds an editing surface + generalizes the main track. The tool stays end-to-end usable after every phase.

---

## Phase 1 — Data model + export engine (no new UI)

The riskiest change first, verified headlessly before any UI depends on it.

- **Schema:** add `videoProjects.timelineJson` (TEXT, nullable) in `schema.ts`; self-healing `ALTER TABLE video_projects ADD COLUMN timeline_json` in `lib/db/index.ts` (PRAGMA-guarded, like existing migrations).
- **Types + helpers:** `lib/video/timeline.ts` — `TimelineDoc` type (`{ mainSegments: {sourceStart,sourceEnd}[], brollInserts: PlanInsert[] }`); `synthesizeTimeline(project, transcript)` (single full-length segment, or `computeKeepRanges` from `trim.ts` if `autoTrimSilence` was on, + `planJson` inserts); `outputDuration(segments)`; `mapSourceToOutput(segments, t)` / `mapOutputToSource(segments, t)` (per-segment offset mapping that tolerates **reordered** segments — generalizes `buildTimeRemap`); `remapWordsThroughSegments(words, segments)` (drops words outside kept ranges, re-times survivors).
- **Renderer upgrade (`render.ts`):** accept `mainSegments` in `RenderInput`. When present, replace the single `select`/`aselect` keep-range approach with **split→concat**: build per-segment trimmed video+audio pairs (`trim=start:end,setpts=PTS-STARTPTS` / `atrim,asetpts`) in **timeline order**, `concat=n=N:v=1:a=1` into `[main]`/`[main_audio]`, then the existing downstream stages (scale/crop, b-roll overlay, ASS captions, music mix, logo intro, encode) run unchanged. Caption/b-roll times come pre-mapped to output coords via `timeline.ts`. Keep the legacy keep-range path as the fallback when `timelineJson`/`mainSegments` is absent (back-compat for old projects until they're opened+migrated).
- **Render route:** `POST /api/content-studio/projects/[id]/render` reads `timelineJson` (synthesizing + persisting one if missing), passes `mainSegments` + output-coord b-roll + remapped words to `renderProject`.
- **Verify:**
  - `lib/video/timeline.test.ts` (`npx tsx`): segment duration math; source↔output mapping round-trips; mapping correct under a reordered segment list; word remap drops cut words and re-times kept ones; synthesize produces full-length segment when no trim, keep-ranges when trim on.
  - Headless render check: take a seeded project, write a `timelineJson` with a **deleted middle segment** and a **reordered** pair, hit the render route, confirm the output MP4 duration ≈ summed segment lengths and (eyeball one frame) order is correct.

## Phase 2 — Live preview engine (browser compositing)

A self-contained component that plays a `TimelineDoc` live. Built from the existing `PlanTimelineEditor` preview logic (b-roll overlay + rotation handling already solved there).

- `components/content-studio/editor/PreviewStage.tsx` — props: `projectId`, `timeline`, `assets`, `transcript`, `aspectRatio`, `captionStyle`, `musicSrc`/`musicVolume`, plus controlled `playheadSec` + `onPlayheadChange` + `playing` + `onPlayingChange`.
  - **Main playback:** one `<video>` of the main asset. A scheduler maps the **output** playhead → `(segmentIndex, sourceTime)` via `timeline.ts`; on play it seeks to the current segment's source time and, at each segment boundary, jumps the video's `currentTime` to the next segment's `sourceStart` (segment may be non-contiguous / reordered). `requestAnimationFrame` loop advances the output playhead from the video's `currentTime` while inside a segment.
  - **B-roll overlay:** reuse the active-insert + overlaid muted `<video>` mechanism from `PlanTimelineEditor` (incl. `rotationStyle`), keyed off the output playhead.
  - **Captions overlay:** absolutely-positioned styled `<div>` (web-font, matches `captionFont` family) showing the active word(s) from `remapWordsThroughSegments`, synced to output playhead. Approximation by design (see spec fidelity contract).
  - **Music:** hidden `<audio>` started/stopped/seeked with the main playhead, gained to `musicVolume`.
  - **Transport:** play/pause/skip + `current/total`; spacebar toggles. Single shared playhead is the source of truth.
- **Verify:** screenshot recipe — open a project, programmatically set a `timelineJson` (with a b-roll insert + a cut), confirm: preview renders, play advances the playhead, a frame inside a b-roll window shows the overlay, a caption word shows at the right time. Confirm pause/seek hold.

## Phase 3 — Editor screen (Layout B) replacing the card stack

- `components/content-studio/editor/VideoEditor.tsx` — top-level, owns `timeline` state (+ undo stack) and autosaves `timelineJson` (debounced PATCH, mirroring `patchProject`). Replaces the `ProjectDetail` body for `status === transcribed | rendered | failed-with-transcript`. The pre-first-cut states (queued/transcribing/planning/rendering) keep the existing status panel + poller.
  - **Top bar:** project name · `Re-caption` · `Re-suggest b-roll` (Phase 4) · **Undo** · **Export MP4**.
  - **Left:** `<PreviewStage>` (Phase 2).
  - **Right:** `Inspector.tsx` — switches on current selection (`mainSegment` | `broll` | `captionWord` | none): segment → split-at-playhead / delete; b-roll → source clip picker + start-in-main + length + source-trim + remove (port `InsertDetailPanel`); caption word → text fix (writes back to transcript); none → AI actions + music/intro controls + export.
  - **Bottom:** `Timeline.tsx` — four lanes (Main / B-roll / Captions / Music) sharing an x-scale + one orange playhead. **Main lane:** segment blocks; drag-move to reorder, drag-edges to trim, split button at playhead, delete on selected; gaps closed by construction. **B-roll lane:** insert blocks (move/trim) — port drag logic from `PlanTimelineEditor`. **Captions lane:** word ticks, click → select word. **Music lane:** bed label + volume. Click empty area to scrub.
  - **B-roll tray:** docked under the timeline — upload + list b-roll assets (reuse existing asset endpoints); drag a chip onto the B-roll lane to add an insert.
- **Main-track edit ops (`lib/video/timeline.ts`, pure):** `splitSegment(doc, atOutputSec)`, `deleteSegment(doc, idx)`, `reorderSegment(doc, from, to)`, `trimSegment(doc, idx, newSourceStart, newSourceEnd)` — each returns a new `TimelineDoc` and re-derives b-roll/caption timing where needed. Unit-tested.
- **Caption edits:** clicking a word edits `transcriptJson` (reuse existing `reTokenizeSegmentWords` + transcript PATCH); preview re-derives.
- **Retire** the stacked `Section` cards in `ProjectDetail` (font/music/polish/plan/transcript) — their controls move into the Inspector; keep the Output/download block accessible post-export.
- **Verify:** `timeline.test.ts` extended for split/delete/reorder/trim invariants (no overlaps, duration conserved minus deletions, b-roll stays in-bounds). Screenshot the editor: first-cut layout, a selected b-roll showing the inspector, a split applied, a reorder applied; confirm autosave persists `timelineJson`.

## Phase 4 — AI actions + export wiring

- **Re-caption** → existing transcribe route; on completion preview re-derives captions.
- **Re-suggest b-roll** → existing `planCut` route, but write results into `timelineJson.brollInserts` (output coords) instead of `planJson`; warn that it replaces current cutaways (Undo covers it).
- **Export MP4** → render route (Phase 1) using the live `timelineJson`; reuse the existing poller + Output player/download. Disable while rendering.
- **First-cut bake:** after transcription/planning completes, synthesize + persist `timelineJson` (incl. baked silence-trim segments when `autoTrimSilence` was chosen at create) so the user lands on a real editable cut.
- **Verify:** full happy path on a seeded project — upload main + b-roll → first cut → land in editor → trim + reorder + retime a b-roll + fix a caption word → Export → download → spot-check the MP4 reflects the edits (order, cut, b-roll timing). `tsc` + `build:prod` green.

## Phase 5 — Polish + deploy

- Empty/edge states: no b-roll, single segment, very short clip, missing/deleted asset referenced by an insert.
- Confirm old projects (no `timelineJson`) open, synthesize on entry, and still render.
- Add `/content-studio/videos/[id]` to `tests/smoke.py`.
- `tsc` + `build:prod` green → deploy via `railway up` (expect possible Metal-builder flake; retry) → smoke-check the editor loads and an export completes in prod.

---

## Notes / out of scope
Per-segment speed control · multi-clip main track · manual per-video caption repositioning · transitions/filters/stickers · making fire-and-forget transcription/render multi-user-robust · WebCodecs/frame-accurate preview seeking (RAF + seek approximation is v1; preload-next-segment is the later mitigation if seams bother in practice).

## Risks carried from spec
Seam stutter across cuts in preview (export is exact) · in-browser weight for many-segment timelines (fine for <60s reels) · pre-existing fire-and-forget robustness.
