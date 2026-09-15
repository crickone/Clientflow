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
  return scenes[slot - 1]?.trim() || scenes[0]?.trim() || "";
}
