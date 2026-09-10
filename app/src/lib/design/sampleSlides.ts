/**
 * Three fixed sample slides for previewing a design system. Pure: no model
 * call, no DB. The point of a preview is that the operator judges the
 * direction with THEIR colours, as rendered slides, before it starts shaping
 * every post -- numbers on a settings page tell nobody what a headline will
 * look like at feed size.
 *
 * The compositions are deliberately plain so what varies between directions
 * is the direction: the typeface, the scale, the grounds, the accent. They
 * follow the same satori rules the prompt enforces (containers flex, text
 * leaves not, explicit widths, nothing in the top-right logo corner).
 */
import type { DesignSystem, TypeLevel } from "./parse";
import { defaultTypeValue } from "./validate";

const W = 1080;
const H = 1080;

/** The top-right corner the logo is stamped into after rendering -- the
 *  prompt's own rule for real slides is "roughly a quarter of the width and a
 *  tenth of the height" (see DESIGN_RULES). Keeping every text block out of
 *  that x-range entirely means no sample can collide with it whatever the
 *  direction's margin, which is what the old `- 200` guess got wrong for every
 *  direction in the catalogue. */
const LOGO_CORNER_W = Math.round(W / 4);

function css(system: DesignSystem, level: TypeLevel, colour: string): string {
  const t = system.type[level];
  return (
    `font-family:${system.font};font-size:${t.size}px;line-height:${t.leading};` +
    `letter-spacing:${t.tracking}em;font-weight:${t.weight};color:${colour};` +
    (t.upper ? "text-transform:uppercase;" : "")
  );
}

function groundHex(system: DesignSystem, i: number): string {
  const g = system.grounds[i % system.grounds.length];
  return system.values.find((v) => v.key === g.value)!.hex;
}

function typeOn(system: DesignSystem, ground: string): string {
  return defaultTypeValue(system, ground)?.hex ?? "#000000";
}

function accentHex(system: DesignSystem): string {
  return (
    system.values.find((v) => v.role === "accent")?.hex ??
    system.values.find((v) => v.role === "type")?.hex ??
    "#000000"
  );
}

export function sampleSlides(system: DesignSystem): string[] {
  const m = system.grid.margin;
  const textWidth = W - m - LOGO_CORNER_W;
  const g0 = groundHex(system, 0);
  const g1 = groundHex(system, 1);
  const g2 = groundHex(system, 2);
  const accent = accentHex(system);

  // 1. Display heading anchored low, quiet space above.
  const one =
    `<div style="display:flex;flex-direction:column;justify-content:flex-end;position:relative;width:${W}px;height:${H}px;background:${g0};padding:${m}px;">` +
    `<span style="width:${textWidth}px;${css(system, "label", accent)}">Recovery</span>` +
    `<span style="width:${textWidth}px;margin-top:20px;${css(system, "display", typeOn(system, g0))}">The pressure does the work, not the oxygen.</span>` +
    `</div>`;

  // 2. Headline with a rule and body on the second ground.
  const two =
    `<div style="display:flex;flex-direction:column;position:relative;width:${W}px;height:${H}px;background:${g1};padding:${m}px;">` +
    `<span style="width:${textWidth}px;${css(system, "headline", typeOn(system, g1))}">Three sessions a week is not better than two.</span>` +
    `<div style="display:flex;width:120px;height:6px;margin-top:36px;background:${accent};"></div>` +
    `<span style="width:${textWidth}px;margin-top:36px;${css(system, "body", typeOn(system, g1))}">Adaptation needs the gap between sessions. Stack them and the body never gets the chance to respond to the first one before the second arrives.</span>` +
    `</div>`;

  // 3. Subhead list on the third ground (or the first again for a two-ground system).
  const three =
    `<div style="display:flex;flex-direction:column;position:relative;width:${W}px;height:${H}px;background:${g2};padding:${m}px;">` +
    `<span style="width:${textWidth}px;${css(system, "label", typeOn(system, g2))}">What changes</span>` +
    `<span style="width:${textWidth}px;margin-top:32px;${css(system, "subhead", typeOn(system, g2))}">Blood flow to tissue that red cells struggle to reach</span>` +
    `<span style="width:${textWidth}px;margin-top:24px;${css(system, "subhead", typeOn(system, g2))}">Muscle tension, through the nervous system's response to touch</span>` +
    `<span style="width:${textWidth}px;margin-top:24px;${css(system, "subhead", typeOn(system, g2))}">Sleep, which is where most of the recovery actually happens</span>` +
    `</div>`;

  return [one, two, three];
}
