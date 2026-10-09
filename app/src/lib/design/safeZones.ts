/**
 * Where Instagram and Facebook cover a post or ad with their own interface,
 * and so where text, buttons and the logo must never go. Pure: the design
 * prompt, the logo stamp and the layout check all read it, so they cannot
 * disagree.
 *
 * - 9:16 (Stories and Reels): the top 14% carries the profile name and the
 *   progress bar; the bottom 35% carries the caption, the call-to-action
 *   button and the like/comment column in Reels (Stories cover less, so the
 *   Reels figure covers both); 6% each side. Meta's own safe-zone guidance.
 * - 4:5 (feed): shown whole in the feed, but Instagram's profile grid crops
 *   it to 3:4, losing about 34px each side on a 1080 canvas; 6% sides keeps
 *   everything clear of that, and 5% top and bottom keeps type off the edge.
 * - 1:1 and anything else: 5% all round.
 *
 * Photographs and grounds may bleed to the edges; only what has to be READ
 * (text, the button, the logo) is held inside.
 */
export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function safeZone(width: number, height: number): SafeZone {
  const ratio = height / width;
  if (ratio >= 1.7) {
    return {
      top: Math.round(height * 0.14),
      bottom: Math.round(height * 0.35),
      left: Math.round(width * 0.06),
      right: Math.round(width * 0.06),
    };
  }
  if (ratio >= 1.2) {
    return {
      top: Math.round(height * 0.05),
      bottom: Math.round(height * 0.05),
      left: Math.round(width * 0.06),
      right: Math.round(width * 0.06),
    };
  }
  const m = Math.round(width * 0.05);
  return { top: m, bottom: m, left: m, right: m };
}

/** The readable area as a box. */
export function safeRect(width: number, height: number): { left: number; top: number; width: number; height: number } {
  const z = safeZone(width, height);
  return { left: z.left, top: z.top, width: width - z.left - z.right, height: height - z.top - z.bottom };
}

/** The design prompt's rule, in exact pixels for this canvas. */
export function safeZoneRule(width: number, height: number): string {
  const z = safeZone(width, height);
  const tall = height / width >= 1.7;
  return (
    `STAY INSIDE THE SAFE ZONE. Instagram and Facebook cover parts of this ${width}x${height} canvas with their own interface` +
    (tall
      ? " (the profile name and progress bar across the top; the caption, the call-to-action button and the like and comment buttons across the bottom)"
      : " (the profile grid trims the sides)") +
    `. Every piece of text and any button must sit entirely inside x=${z.left} to x=${width - z.right} and y=${z.top} to y=${height - z.bottom}. ` +
    `Photographs, grounds and colour bands may run to the edges; only what has to be read stays inside. ` +
    `This is measured after rendering: text found outside is sent back to be moved.`
  );
}

/** The repair loop's words for text outside the safe zone. */
export function safeZoneViolation(texts: string[], width: number, height: number): string {
  const z = safeZone(width, height);
  const first = texts[0].length > 60 ? `${texts[0].slice(0, 57)}...` : texts[0];
  return (
    `Text is outside the safe zone: "${first}"${texts.length > 1 ? ` and ${texts.length - 1} more` : ""} reaches into an area ` +
    `Instagram and Facebook cover with their own interface. Keep all text and buttons inside x=${z.left} to ${width - z.right}, ` +
    `y=${z.top} to ${height - z.bottom}: move the block, or make it narrower.`
  );
}
