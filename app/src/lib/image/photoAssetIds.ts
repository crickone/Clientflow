import { MAX_PHOTO_SLOTS } from "@/lib/design/photoSlots";

/**
 * Which photograph sits in which slot, as a slide row stores it.
 *
 * `background_asset_id` is one integer column and every designed slide written
 * before two-photograph slides existed uses it. It stays the home of slot 1 --
 * so an old row needs no migration and still renders -- and `photo_asset_ids`
 * carries the whole list once there is more than one.
 *
 * Every malformed case resolves to something renderable rather than throwing:
 * a slide that will not parse is a slide the operator cannot open.
 */
export function parsePhotoAssetIds(
  stored: string | null,
  backgroundAssetId: number | null,
): (number | null)[] {
  const fallback = backgroundAssetId == null ? [] : [backgroundAssetId];
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
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}

/**
 * The value to store, or null when the list says nothing background_asset_id
 * does not already say. Keeping the single-photograph case out of the column
 * means the rows that predate this look identical to the ones written after it.
 */
export function serialisePhotoAssetIds(ids: (number | null)[]): string | null {
  if (ids.length <= 1) return null;
  return JSON.stringify(ids.slice(0, MAX_PHOTO_SLOTS));
}
