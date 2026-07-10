import type { CSSProperties } from "react";

/**
 * CSS for a <video> that fills its wrapper the way the renderer fills the
 * output frame: scaled to cover + cropped, brought upright for a 0/90/180/270
 * display rotation. The wrapper is expected to be sized to the OUTPUT aspect
 * (9:16 or 1:1); `wrapperSize` is its measured px size, needed for the
 * quarter-turn cases where the video is pre-sized in pixels then rotated.
 *
 * Mirrors the b-roll preview math in PlanTimelineEditor, but cover (crop) to
 * match `scale=...:force_original_aspect_ratio=increase,crop=...` in render.ts.
 */
export function coverFitStyle(
  rotation: number,
  wrapperSize: { w: number; h: number } | null,
): CSSProperties {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 90 || r === 270) {
    const w = wrapperSize?.w ?? 0;
    const h = wrapperSize?.h ?? 0;
    if (w > 0 && h > 0) {
      // Pre-size in px so width=wrapperHeight, height=wrapperWidth; after the
      // 90/270 rotate it covers the wrapper exactly.
      return {
        position: "absolute",
        top: "50%",
        left: "50%",
        width: `${h}px`,
        height: `${w}px`,
        objectFit: "cover",
        transform: `translate(-50%, -50%) rotate(${r}deg)`,
        transformOrigin: "center center",
      };
    }
    // Not measured yet — hide to avoid a flash of the un-rotated source.
    return { position: "absolute", inset: 0, visibility: "hidden" };
  }
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: r === 180 ? "rotate(180deg)" : undefined,
  };
}
