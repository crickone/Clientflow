import { MAX_PHOTO_SLOTS } from "@/lib/design/photoSlots";

/**
 * Which SCENE the design asked for in which slot, as a slide row stores it.
 *
 * Deliberately the same shape as ./photoAssetIds, for the same reason:
 * `image_prompt` is one text column and every designed slide written before
 * two-photograph slides existed uses it. It stays the home of slot 1 -- so an
 * old row needs no migration, and "Make a new photo" on a one-photograph slide
 * briefs exactly as it always did -- and `photo_scenes` carries the whole list
 * once there is more than one.
 *
 * `image_prompt` is NOT where the list goes. The generate path sends that
 * column's string straight to an image model, so a JSON blob there would
 * become the prompt.
 *
 * The column exists because the per-slot scenes were already parsed and then
 * thrown away: designPost.parse.ts populated RawDesign.photos and the only
 * reader took [0]. On this feature's own example -- infrared above, HBOT below
 * -- "Make a new photo" with the second slot targeted was briefed as an
 * infrared bed, and the dialog's "This slide asked for:" hint showed slot 1's
 * scene whatever slot the operator had picked.
 *
 * Every malformed case resolves to something usable rather than throwing: a
 * slide that will not parse is a slide the operator cannot open.
 */
export function parsePhotoScenes(
  stored: string | null,
  imagePrompt: string | null,
): string[] {
  const slotOne = imagePrompt?.trim() ?? "";
  const fallback = slotOne ? [slotOne] : [];
  if (!stored) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) return fallback;
  return parsed
    .slice(0, MAX_PHOTO_SLOTS)
    .map((v) => (typeof v === "string" ? v.trim() : ""));
}

/**
 * The value to store, or null when the list says nothing image_prompt does not
 * already say. Keeping the single-scene case out of the column means the rows
 * that predate this look identical to the ones written after it.
 *
 * A list whose entries are ALL blank stores nothing either: a model that left
 * "photos" empty on both slots has told us nothing worth a column.
 */
export function serialisePhotoScenes(scenes: string[]): string | null {
  const capped = scenes.slice(0, MAX_PHOTO_SLOTS).map((s) => (typeof s === "string" ? s.trim() : ""));
  if (capped.length <= 1) return null;
  if (capped.every((s) => s === "")) return null;
  return JSON.stringify(capped);
}

/**
 * The scene to brief a generation for ONE slot with.
 *
 * Falls back to slot 1's scene rather than to nothing: a slide whose model
 * named only one scene is still better briefed by that scene than by the
 * slide's own copy, which is what the caller falls back to when this is "".
 * Returning "" is how the caller knows to reach for that.
 */
export function sceneForSlot(
  stored: string | null,
  imagePrompt: string | null,
  slot: number,
): string {
  const scenes = parsePhotoScenes(stored, imagePrompt);
  return cleanScene(scenes[slot - 1] ?? "") || cleanScene(scenes[0] ?? "");
}

/**
 * The scene alone, without the model's commentary on it. A slide designed on a
 * flat ground still has to name a photograph, and the model sometimes prefaced
 * it with "Not used on this slide; if a photograph is wanted, ..." -- which the
 * editor then showed as "This slide asked for: Not used on this slide" on a
 * cover, and which went to the image model as part of the prompt.
 */
export function cleanScene(scene: string): string {
  let s = (scene ?? "").trim();
  s = s.replace(/^(?:not used|unused|no photo(?:graph)?|none)\b[^;:]*?(?:[;:]|\.\s|,\s|\s[-\u2013\u2014]\s)\s*/i, "");
  s = s.replace(/^(?:but\s+)?(?:if|should|where)\s+(?:a|one)\s+(?:photo(?:graph)?|picture|image)\s+(?:is|were|be)\s+(?:wanted|needed|added|used)\s*[,:;-]?\s*/i, "");
  return s;
}

/**
 * The briefs to record after a redesign.
 *
 * A redesign keeps the slide's own photograph in slot 1, but the model never
 * sees that picture and writes a fresh brief for slot 1 anyway. Storing that
 * brief left the slide showing one photograph while "This slide asked for"
 * described another: a gardening photograph under a brief for a treatment
 * table, and the next "Make a new photo" briefed from words the picture on
 * screen never matched. When slot 1 still holds the photograph the redesign
 * was given, its own brief (the one it was made from) stays with it. Any
 * other outcome -- a different picture in slot 1, or none -- keeps the
 * model's briefs, since those are the only description of what it asked for.
 */
export function briefsAfterRedesign(input: {
  /** The photograph the redesign was given for slot 1, if any. */
  keptPhotoId: number | null;
  /** What that photograph was made from, if known. */
  keptBrief: string | null;
  /** The ids the redesign rendered, by slot (index 0 is slot 1). */
  slotIds: (number | null)[];
  /** The model's slot 1 brief. */
  photo: string;
  /** The model's briefs by slot. */
  photos: string[];
}): { photo: string; photos: string[] } {
  const brief = cleanScene(input.keptBrief ?? "");
  if (!brief || input.keptPhotoId == null || input.slotIds[0] !== input.keptPhotoId) {
    return { photo: input.photo, photos: input.photos };
  }
  return { photo: brief, photos: input.photos.length > 0 ? [brief, ...input.photos.slice(1)] : [] };
}
