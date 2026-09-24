/**
 * Which photograph fills each photo slot of one designed slide.
 *
 * PURE — no imports, so it loads under the plain-tsx runner. The generator
 * holds the metered call and the library; this holds the rule.
 *
 * The rule has three parts and each one has been got wrong at least once:
 *
 *  1. MADE BEATS TAKEN. A designed slide names the scene it wants. When a
 *     photographer is available the picture is made to that brief; the library
 *     answers only when it declines. The library used to be the only answer,
 *     which was fine while the library was three AI pictures and stopped being
 *     fine the day real photographs went into it — a rotation cannot know
 *     which of 162 pictures suits this slide.
 *  2. POSITIONAL. Index 0 is slot 1, index 1 is slot 2. A slide that writes
 *     only {{PHOTO:2}} must not have slot 2's brief answered with slot 1's
 *     picture — that is how a split-screen comparison ends up showing one
 *     thing twice.
 *  3. THE ROTATION ADVANCES PER SLOT, NOT PER SLIDE. Two photo slides in a set
 *     take two different pictures, and a slide asking for two takes the next
 *     two.
 */

/** Structural, so the generator's PhotoChoice and a library row both fit.
 *  `id` is nullable because a picture can exist on disk without a library row
 *  behind it — the same shape PhotoChoice carries. */
export interface PhotoLike {
  id: number | null;
  path: string;
}

export interface ChoosePhotosInput {
  /** The slots this slide actually uses, 1-based (e.g. [1] or [1, 2]). */
  slots: number[];
  /** Scenes the design wrote, positional: index 0 is slot 1's brief. */
  scenes: string[];
  /** The slide's single scene, for a design that wrote one rather than a list. */
  fallbackScene?: string;
  /** The tenant's library, rotated from `nextPhoto`. */
  library: PhotoLike[];
  /** How far the set has already moved through the library. */
  nextPhoto: number;
  /** Makes a photograph to a brief, or returns null if it cannot. */
  makePhoto?: (scene: string) => Promise<PhotoLike | null>;
  /** Called once per slot that is about to be photographed. */
  onPhotographing?: () => void;
}

export async function choosePhotos(input: ChoosePhotosInput): Promise<{
  /** By slot: index 0 is slot 1. Null means "render this slot without a picture". */
  photos: (PhotoLike | null)[];
  /** The rotation position to carry into the next slide. */
  nextPhoto: number;
}> {
  const { slots, library, makePhoto } = input;
  let nextPhoto = input.nextPhoto;
  const photos: (PhotoLike | null)[] = Array.from(
    { length: slots.length > 0 ? Math.max(...slots) : 0 },
    () => null,
  );

  for (const slot of slots) {
    if (makePhoto) {
      input.onPhotographing?.();
      const scene = (input.scenes[slot - 1] || input.fallbackScene || "").trim();
      photos[slot - 1] = await makePhoto(scene);
    }
    if (!photos[slot - 1] && library.length > 0) {
      photos[slot - 1] = library[nextPhoto++ % library.length]!;
    }
  }

  return { photos, nextPhoto };
}
