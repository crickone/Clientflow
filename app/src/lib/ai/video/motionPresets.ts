/**
 * Motion presets. The first version's default told the model to "keep the
 * scene, people and equipment exactly as they are" — written to guard against
 * AI weirdness, but it suppressed the very thing b-roll needs, so a photo came
 * back as a static image with a slow zoom.
 *
 * `action` is the default now: it asks the SUBJECTS to move (the point of gym
 * b-roll) while still forbidding the failure modes that make AI video obvious
 * — morphing limbs, extra people, changing faces or equipment.
 *
 * NOTE the hard limit this cannot escape: image-to-video animates what is IN
 * the photo. It cannot add people to an empty room — the picker says so.
 */
export const MOTION_PRESETS = {
  action:
    "Bring this scene to life: the people continue their exercise with natural, " +
    "realistic body movement, weights and equipment moving as they would in real " +
    "footage. Gentle handheld camera drift. Photorealistic documentary style. " +
    "Do not add or remove people, do not change faces, clothing or equipment, " +
    "no morphing or distorted limbs.",
  camera:
    "Hold the scene still and move only the camera: a slow cinematic push-in " +
    "with gentle parallax. Photorealistic, steady, documentary style. Do not add " +
    "or remove people or objects.",
  pan:
    "Slow, steady camera pan across the space, revealing more of the room. " +
    "People and equipment keep their natural motion. Photorealistic documentary " +
    "style. Do not add or remove people, no morphing or distorted limbs.",
} as const;
export type MotionPreset = keyof typeof MOTION_PRESETS;
