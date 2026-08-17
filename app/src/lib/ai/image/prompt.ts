/**
 * Pure prompt/dimension helpers for AI post imagery. Deliberately NO
 * `server-only` and zero imports so the plain tsx test runner executes this
 * file directly (same reasoning as lib/humanName.ts).
 */

export type ImageAspect = "1:1" | "9:16" | "4:5";

/**
 * fal FLUX 1.1 Pro bills $0.04 per rounded-up megapixel — every size here
 * stays under 1,000,000 px so one image is always exactly one 4¢ unit
 * (IMAGE_COST_CENTS in falClient.ts). Dimensions must be multiples of 32
 * (fal constraint). Ratio drift from the true aspect is ≤0.8% — invisible
 * under the designer's cover-fit background cropping.
 */
export const ASPECT_DIMS: Record<ImageAspect, { width: number; height: number }> = {
  "1:1": { width: 992, height: 992 },
  "4:5": { width: 864, height: 1088 },
  "9:16": { width: 736, height: 1312 },
};

/**
 * The fallback house style when the tenant hasn't set `brand_image_style`
 * (Settings → Branding). Derived from the business profile so it's on-brand
 * out of the box.
 */
export function defaultImageStyle(profile: {
  businessName?: string;
  tagline?: string;
  location?: string;
}): string {
  const what = profile.tagline?.trim() || "a premium local business";
  const where = profile.location?.trim() ? ` in ${profile.location.trim()}` : "";
  return `Warm, calming lifestyle and interior photography for ${what}${where}: soft natural light, neutral tones with subtle warm accents, real-feeling spaces and people, aspirational but authentic`;
}

/** Scene used when a slide has no AI-written image brief (manual slides). */
export function fallbackScene(slide: {
  heading?: string | null;
  body?: string | null;
}): string {
  const heading = slide.heading?.trim() ?? "";
  const body = slide.body?.trim() ?? "";
  const joined = [heading, body].filter(Boolean).join(" — ");
  return joined || "an atmospheric scene that fits the brand";
}

/**
 * Compose the final FLUX prompt: scene, then house style, then fixed quality
 * + no-text suffixes. FLUX has no negative prompts, so "no text…" must live
 * in the prompt — the templates draw all copy themselves and a background
 * with baked-in lettering is unusable.
 */
export function buildImagePrompt(input: { houseStyle: string; scene: string }): string {
  const scene = input.scene.trim().replace(/\.+$/, "");
  const style = input.houseStyle.trim().replace(/\.+$/, "");
  return `${scene}. ${style}. Editorial photography, natural light, shallow depth of field, premium quality, photorealistic, high detail. Clean background with no text, no words, no lettering, no logos, no watermarks.`;
}
