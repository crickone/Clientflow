/**
 * A design DIRECTION is a design system with the hexes taken out.
 *
 * Everything that makes "Sage Field" feel like Sage Field -- its typeface, its
 * type scale, its grid, how often each ground may appear, its photo grade, its
 * contrast floors -- is structural, and none of it is a colour. The colours
 * are the one part that has to be the tenant's own, or every client on the
 * same direction looks identical, which is the templated look the composed
 * post work exists to escape, moved up a level from layout to brand.
 *
 * So a direction declares named palette SLOTS, each with a role and a default,
 * and the tenant supplies a hex per slot. `composeDesignSystem` fills the
 * slots and returns an ordinary DesignSystem -- the thing the prompt, the
 * audit and the renderer already read. Nothing downstream knows directions
 * exist.
 *
 * ZERO RUNTIME IMPORTS beyond the sibling pure modules (see ./parse.ts): this
 * runs in the pure test runner and in the browser.
 */
import type { DesignSystem, TypeLevel, TypeStep, ValueRole } from "./parse";
import { contrastRatio } from "./validate";

export interface PaletteSlot {
  /** Becomes the value key in the composed system. */
  key: string;
  /** Shown to the operator beside the swatch. Says what the slot is FOR. */
  label: string;
  role: ValueRole;
  /** The hex used until the tenant chooses one -- the direction's own look. */
  defaultHex: string;
  /** Present on slots that may be a slide's background, with the budget. */
  ground?: { share: number; maxRun: number };
}

export interface DesignDirection {
  id: string;
  name: string;
  /** One sentence for the picker. */
  blurb: string;
  /** Must be a family in lib/design/fonts.ts AVAILABLE_FAMILIES. */
  font: string;
  slots: PaletteSlot[];
  type: Record<TypeLevel, TypeStep>;
  grid: DesignSystem["grid"];
  photo: {
    saturate: number;
    contrast: number;
    brightness: number;
    /** A wash in a SLOT's colour, resolved to that tenant's hex at compose time. */
    wash?: { slot: string; alpha: number };
  } | null;
  rules: {
    minContrastBody: number;
    minContrastLarge: number;
    /** Slot keys forbidden as type whatever the maths says. The derived list
     *  (see deriveNeverType) is added on top of this, never instead of it. */
    neverType: string[];
  };
}

/** Slot key -> hex. What the tenant chose. */
export type BrandPalette = Record<string, string>;

/** The direction's own look: every slot at its default. */
export function defaultPalette(direction: DesignDirection): BrandPalette {
  const out: BrandPalette = {};
  for (const s of direction.slots) out[s.key] = s.defaultHex.toLowerCase();
  return out;
}

/**
 * Values that cannot be read on ANY ground: below the large-text floor
 * against every one. A colour like that is not a type colour whatever the
 * author intended, and finding it by arithmetic is what lets a tenant swap in
 * a palette without a designer re-checking every pairing by hand.
 *
 * Reserved values are skipped: they are never type by definition and listing
 * them would be noise.
 */
export function deriveNeverType(
  values: { key: string; hex: string; role: ValueRole }[],
  groundHexes: string[],
  minContrastLarge: number,
): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.role === "reserved") continue;
    const readableSomewhere = groundHexes.some((g) => {
      const r = contrastRatio(v.hex, g);
      return !Number.isNaN(r) && r >= minContrastLarge;
    });
    if (!readableSomewhere) out.push(v.key);
  }
  return out;
}

/**
 * Fill a direction's slots with a palette and return the DesignSystem.
 *
 * Any slot the palette does not name takes the direction's default, so a
 * partial palette is always a complete system. Hexes are lower-cased to
 * match what the parser stores.
 */
export function composeDesignSystem(
  direction: DesignDirection,
  palette: BrandPalette,
): DesignSystem {
  const hexFor = (slot: PaletteSlot): string =>
    (palette[slot.key] ?? slot.defaultHex).trim().toLowerCase();

  const values = direction.slots.map((s) => ({ key: s.key, hex: hexFor(s), role: s.role }));
  const grounds = direction.slots
    .filter((s) => s.ground)
    .map((s) => ({ value: s.key, share: s.ground!.share, maxRun: s.ground!.maxRun }));
  const groundHexes = grounds.map((g) => values.find((v) => v.key === g.value)!.hex);

  let photo: DesignSystem["photo"] = null;
  if (direction.photo) {
    photo = {
      saturate: direction.photo.saturate,
      contrast: direction.photo.contrast,
      brightness: direction.photo.brightness,
    };
    if (direction.photo.wash) {
      const slot = direction.slots.find((s) => s.key === direction.photo!.wash!.slot);
      if (slot) photo.wash = { hex: hexFor(slot), alpha: direction.photo.wash.alpha };
    }
  }

  const derived = deriveNeverType(values, groundHexes, direction.rules.minContrastLarge);
  const neverType = [...direction.rules.neverType];
  for (const key of derived) if (!neverType.includes(key)) neverType.push(key);

  return {
    version: 1,
    font: direction.font,
    values,
    grounds,
    type: direction.type,
    grid: direction.grid,
    photo,
    rules: {
      minContrastBody: direction.rules.minContrastBody,
      minContrastLarge: direction.rules.minContrastLarge,
      neverType,
    },
  };
}
